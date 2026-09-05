"""Data freshness / completeness check for the scraper pipeline.

Exists because the pipeline can die silently. On 2026-08-09 GitHub auto-disabled both
scraper crons for 60-day repo inactivity and nobody noticed for a month — the DB simply
stopped at the 2026-08-08 card while four events went unscraped. Nothing in the stack
complains when scraping stops; it just stops.

Two checks, both of which would have caught that outage within days:

  1. FRESHNESS   — the newest fully-scraped past event must be within STALE_AFTER_DAYS.
                   Catches "scraping stopped entirely."
  2. COMPLETENESS— no past event inside COMPLETENESS_WINDOW_DAYS may still have fights
                   stuck `upcoming` or missing a winner. Catches "scraping died partway
                   through a card," which is what the mid-cron disable actually did.

Exits non-zero when either fails, so the GitHub Actions run goes red and emails.

    python supabase/check_data_freshness.py
"""
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

from dotenv import load_dotenv
from supabase import create_client

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# UFC runs most weekends, but genuine two-week gaps happen (December especially).
# 14 days tolerates a real gap while still catching an outage far sooner than the
# month the 2026-08 one took. A noisy check gets ignored, which is worse than none.
STALE_AFTER_DAYS = 14
# Only look back this far for half-scraped cards — older gaps are historical data
# quality, not a live pipeline failure, and shouldn't fail the build every run.
COMPLETENESS_WINDOW_DAYS = 30

load_dotenv(dotenv_path=Path(__file__).parent.parent / '.env')
url = os.environ.get("REACT_APP_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")
if not url or not key:
    print("❌ REACT_APP_SUPABASE_URL / SUPABASE_SERVICE_KEY not set")
    sys.exit(2)

sb = create_client(url, key)
today = date.today()
failures = []

print(f"🔎 Data freshness check — {datetime.utcnow().isoformat(timespec='seconds')}Z")
print(f"   stale_after={STALE_AFTER_DAYS}d  completeness_window={COMPLETENESS_WINDOW_DAYS}d\n")

events = (sb.table("ufc_events")
          .select("event_name,event_date")
          .lte("event_date", today.isoformat())
          .order("event_date", desc=True)
          .limit(40).execute().data or [])

if not events:
    print("❌ No past events in ufc_events at all.")
    sys.exit(1)


def card(event_name):
    """(total, completed, with_winner) for one event."""
    rows = (sb.table("fights").select("status,winner")
            .eq("event_name", event_name).execute().data or [])
    return (len(rows),
            sum(1 for r in rows if r["status"] == "completed"),
            sum(1 for r in rows if r["winner"]))


# --- 1. FRESHNESS ---------------------------------------------------------------
newest = None
for e in events:
    total, completed, winners = card(e["event_name"])
    if total and winners:                      # event has real scraped results
        newest = (e, total, completed, winners)
        break

if not newest:
    failures.append("No past event has any scraped results — pipeline looks dead.")
else:
    e, total, completed, winners = newest
    age = (today - date.fromisoformat(e["event_date"])).days
    line = f"{e['event_name']} ({e['event_date']}, {age}d ago) — {winners}/{total} winners"
    if age > STALE_AFTER_DAYS:
        failures.append(f"Newest scraped event is {age}d old (limit {STALE_AFTER_DAYS}d): {line}")
        print(f"   ❌ FRESHNESS  {line}")
    else:
        print(f"   ✅ FRESHNESS  {line}")

# --- 2. COMPLETENESS ------------------------------------------------------------
cutoff = (today - timedelta(days=COMPLETENESS_WINDOW_DAYS)).isoformat()
incomplete = []
for e in events:
    if e["event_date"] < cutoff:
        break
    total, completed, winners = card(e["event_name"])
    if total and (completed < total or winners < total):
        incomplete.append(
            f"{e['event_name']} ({e['event_date']}): {total} fights, "
            f"{completed} completed, {winners} with winners")

if incomplete:
    for line in incomplete:
        print(f"   ❌ INCOMPLETE {line}")
    failures.append(f"{len(incomplete)} recent event(s) only partly scraped.")
else:
    print(f"   ✅ COMPLETE   all past events since {cutoff} fully scraped")

# --- verdict --------------------------------------------------------------------
print()
if failures:
    print("=" * 60)
    for f in failures:
        print(f"❌ {f}")
    print("=" * 60)
    print("\nLikely causes, in order:")
    print("  1. Scheduled workflows auto-disabled for 60-day repo inactivity —")
    print("     curl -s https://api.github.com/repos/themmadna/mmadnaplatform/actions/workflows")
    print("     A \"state\": \"disabled_inactivity\" is conclusive. Re-enable in the Actions tab.")
    print("  2. ufcstats changed its proof-of-work challenge — see context/scrapers.md.")
    print("  3. Supabase key rotated / secrets stale.")
    sys.exit(1)

print("✅ Data pipeline looks healthy.")
