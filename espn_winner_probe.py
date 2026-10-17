"""
espn_winner_probe.py — read-only probe: can ESPN tell us the winner live?

WHY THIS EXISTS
---------------
Today the winner of a fight only lands in the DB when the post-event scraper runs,
hours after the card ends. The live path (frontend poll in src/App.js + the
poll-live-fights / record-fight-status Edge Functions) reads ONLY
`competitions[].status.type.name`, so the app knows a fight is FINAL but not who won.

ESPN's scoreboard payload does carry the result — each competitor has a boolean
`winner` flag once the bout reaches STATUS_FINAL. This script proves whether that
flag is reliable enough to grade on, BEFORE anything is wired into the live path.

Run it during/after a card. It writes one JSONL row per observation so the run can
be audited later against what the scraper eventually wrote.

SAFETY
------
This script NEVER writes to Supabase. It only SELECTs, so it is safe to run
alongside a live event and alongside the real scrapers.

USAGE
-----
    # watch tonight's card until every bout is final
    python espn_winner_probe.py

    # single pass, no loop
    python espn_winner_probe.py --once

    # replay a past card to sanity-check matching (ESPN keeps history)
    python espn_winner_probe.py --date 20260912 --once

    # ESPN only, don't touch Supabase at all
    python espn_winner_probe.py --date 20260912 --once --no-db

EXIT CODES
----------
    0  ran to completion (or all bouts final)
    1  configuration / network problem
"""

import os
import sys
import json
import time
import argparse
from datetime import datetime, timezone
from pathlib import Path

import requests

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

ESPN_SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard"
LOG_DIR = Path(__file__).parent / "espn_probe_logs"


# ---------------------------------------------------------------- name matching
# normName + matchesFighter mirror supabase/functions/poll-live-fights/index.ts
# and src/components/FightDetailView.js exactly. If you change one copy, change
# all of them — cross-source name matching is never an exact string compare
# (CLAUDE.md convention #8).

import unicodedata
import re


def norm_name(name):
    s = unicodedata.normalize('NFD', name or '')
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r'[^a-z0-9\s]', '', s)
    s = re.sub(r'\s+', ' ', s)
    return s.strip()


def matches_fighter(js_name, meta_name):
    a = norm_name(js_name)
    b = norm_name(meta_name)
    if not a or not b:
        return False
    if a == b:
        return True

    a_col = a.replace(' ', '')
    b_col = b.replace(' ', '')
    if a_col == b_col:
        return True

    # Same characters, different order (Chinese name transliterations)
    if len(a_col) >= 5 and len(a_col) == len(b_col):
        if sorted(a_col) == sorted(b_col):
            return True

    a_words = a.split(' ')
    b_words = b.split(' ')
    a_last, b_last = a_words[-1], b_words[-1]
    if a_last == b_last and len(a_last) > 3:
        return True

    shorter, longer = (a_words, b_words) if len(a_words) <= len(b_words) else (b_words, a_words)
    return all(w in longer for w in shorter if len(w) > 1)


def bout_matches_comp(bout, comp):
    parts = re.split(r' vs ', bout or '', flags=re.IGNORECASE)
    if len(parts) < 2:
        return False
    names = [(c.get('athlete') or {}).get('displayName', '') for c in comp.get('competitors', [])]
    return (any(matches_fighter(n, parts[0]) for n in names)
            and any(matches_fighter(n, parts[1]) for n in names))


# ---------------------------------------------------------------- data sources

def fetch_espn(date_str):
    """date_str is YYYYMMDD. Returns the list of UFC events for that date."""
    r = requests.get(ESPN_SCOREBOARD, params={"dates": date_str}, timeout=20)
    r.raise_for_status()
    events = (r.json() or {}).get('events') or []
    return [e for e in events if 'UFC' in (e.get('name') or '').upper()]


def load_db_fights(date_iso):
    """Read-only. Returns [] if Supabase isn't reachable — the probe still works."""
    try:
        from dotenv import load_dotenv
        from supabase import create_client
    except ImportError:
        print("  ! supabase/dotenv not installed — running ESPN-only")
        return []

    load_dotenv(dotenv_path=Path(__file__).parent / '.env')
    url = os.environ.get("REACT_APP_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_KEY")
    if not url or not key:
        print("  ! REACT_APP_SUPABASE_URL / SUPABASE_SERVICE_KEY missing — running ESPN-only")
        return []

    sb = create_client(url, key)
    events = sb.table('ufc_events').select('event_name').eq('event_date', date_iso).execute().data or []
    if not events:
        print("  ! no ufc_events row for %s — running ESPN-only" % date_iso)
        return []

    names = [e['event_name'] for e in events]
    fights = sb.table('fights').select(
        'id, bout, event_name, status, winner, fight_started_at, fight_ended_at, '
        'espn_competition_id, card_position'
    ).in_('event_name', names).order('card_position', desc=False).execute().data or []
    return fights


# ---------------------------------------------------------------- the probe

def espn_winner_of(comp):
    """Returns (winner_name, loser_name, is_decided).

    A FINAL bout where nobody carries winner=True is a draw or no-contest —
    that is the signal the nullable `winner` column alone can never give us."""
    winner = loser = None
    for c in comp.get('competitors', []):
        nm = (c.get('athlete') or {}).get('displayName') or ''
        if c.get('winner') is True:
            winner = nm
        else:
            loser = nm
    return winner, loser, winner is not None


def probe_once(date_str, db_fights):
    """One pass. Returns a list of observation dicts."""
    seen = []
    for ev in fetch_espn(date_str):
        for comp in ev.get('competitions', []):
            status = ((comp.get('status') or {}).get('type') or {}).get('name')
            names = [(c.get('athlete') or {}).get('displayName', '') for c in comp.get('competitors', [])]
            winner, loser, decided = espn_winner_of(comp)

            # Match back to our row so we can compare against what we already store
            match = None
            for f in db_fights:
                if f.get('espn_competition_id') and str(f['espn_competition_id']) == str(comp.get('id')):
                    match = f
                    break
                if bout_matches_comp(f.get('bout'), comp):
                    match = f
                    break

            seen.append({
                "observed_at": datetime.now(timezone.utc).isoformat(),
                "espn_event": ev.get('name'),
                "espn_competition_id": str(comp.get('id')),
                "espn_fighters": names,
                "espn_status": status,
                "espn_winner": winner,
                "espn_loser": loser,
                "espn_decided": decided,
                "db_fight_id": (match or {}).get('id'),
                "db_bout": (match or {}).get('bout'),
                "db_status": (match or {}).get('status'),
                "db_winner": (match or {}).get('winner'),
                "db_ended_at": (match or {}).get('fight_ended_at'),
                "matched": match is not None,
            })
    return seen


def verdict(o):
    """One-line judgement for the console."""
    if o['espn_status'] != 'STATUS_FINAL':
        return "…", "not final yet"
    if not o['espn_decided']:
        return "=", "FINAL, no winner flag → draw / NC"
    if not o['matched']:
        return "?", "ESPN has a winner, no DB row matched"
    if o['db_winner'] is None:
        return "+", "ESPN has it, DB does not (this is the gap we'd close)"
    # matches_fighter, NOT equality: ESPN and ufcstats spell the same fighter
    # differently ("Matthieu Letho Duclos" vs "Matthieu Duclos"). Any live grading
    # against ESPN's winner has to match the same way (CLAUDE.md convention #8).
    if matches_fighter(o['db_winner'], o['espn_winner']):
        return "OK", "agrees with DB"
    return "!!", "DISAGREES with DB — ESPN=%s DB=%s" % (o['espn_winner'], o['db_winner'])


def main():
    ap = argparse.ArgumentParser(description="Read-only probe of ESPN's live winner flag.")
    ap.add_argument('--date', help="YYYYMMDD (default: today, local)")
    ap.add_argument('--once', action='store_true', help="single pass, no polling loop")
    ap.add_argument('--interval', type=int, default=60, help="seconds between polls (default 60)")
    ap.add_argument('--no-db', action='store_true', help="skip Supabase entirely")
    args = ap.parse_args()

    now = datetime.now()
    date_str = args.date or now.strftime('%Y%m%d')
    date_iso = "%s-%s-%s" % (date_str[0:4], date_str[4:6], date_str[6:8])

    LOG_DIR.mkdir(exist_ok=True)
    log_path = LOG_DIR / ("espn_winners_%s.jsonl" % date_str)

    print("ESPN winner probe — %s" % date_iso)
    print("read-only: this script never writes to Supabase")
    print("log: %s" % log_path)
    print("-" * 78)

    db_fights = [] if args.no_db else load_db_fights(date_iso)
    print("DB fights loaded: %d" % len(db_fights))
    print("-" * 78)

    poll = 0
    try:
        while True:
            poll += 1
            try:
                observations = probe_once(date_str, db_fights)
            except requests.RequestException as e:
                print("[poll %d] ESPN fetch failed: %s" % (poll, e))
                if args.once:
                    return 1
                time.sleep(args.interval)
                continue

            if not observations:
                print("[poll %d] no UFC card on ESPN for %s" % (poll, date_iso))
                if args.once:
                    return 0
                time.sleep(args.interval)
                continue

            with log_path.open('a', encoding='utf-8') as fh:
                for o in observations:
                    fh.write(json.dumps(o, ensure_ascii=False) + "\n")

            print("[poll %d] %s" % (poll, datetime.now().strftime('%H:%M:%S')))
            for o in observations:
                tag, note = verdict(o)
                bout = " vs ".join(o['espn_fighters']) if o['espn_fighters'] else "?"
                print("  %-3s %-42s %s" % (tag, bout[:42], note))

            finals = [o for o in observations if o['espn_status'] == 'STATUS_FINAL']
            decided = [o for o in finals if o['espn_decided']]
            print("  -- %d/%d final, %d with a winner flag"
                  % (len(finals), len(observations), len(decided)))

            if args.once:
                return 0
            if finals and len(finals) == len(observations):
                print("\nAll bouts final. Probe complete.")
                print("Compare later against the scraper with:")
                print("  python espn_winner_probe.py --date %s --once" % date_str)
                return 0

            time.sleep(args.interval)

    except KeyboardInterrupt:
        print("\nStopped. %d polls written to %s" % (poll, log_path))
        return 0


if __name__ == '__main__':
    sys.exit(main())
