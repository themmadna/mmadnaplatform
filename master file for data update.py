import os
import sys
import time
import subprocess
import argparse
from typing import Optional
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
from datetime import datetime, timezone, timedelta
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from supabase import create_client, Client
from dateutil import parser
from pathlib import Path

# --- 1. INITIALIZATION ---
# This forces the script to look for .env in the same folder as the script file
env_path = Path(__file__).parent / '.env'
load_dotenv(dotenv_path=env_path)

url = os.environ.get("REACT_APP_SUPABASE_URL")
key = os.environ.get("SUPABASE_SERVICE_KEY")

# Simple check to stop the script immediately if keys are missing
if not url or not key:
    raise ValueError(f"❌ Error: .env file not loaded correctly.\nLooking at: {env_path}\nMake sure SUPABASE_URL and SUPABASE_SERVICE_KEY are inside.")

supabase_db: Client = create_client(url, key)


# Track what we add today
stats_summary = {
    "new_events": 0,
    "new_fights": 0,
    "updated_fights": 0,
    "new_metadata": 0,
    "new_round_rows": 0
}

def is_post_event_window():
    """Return (True, event_name, msg) if in the post-event processing window, else (False, None, msg).

    Window: start_time + 5h  →  start_time + 48h
    - Lower bound covers even long cards/overruns before mmadecisions posts scorecards.
    - Upper bound gives 2 days for late scorecard uploads.
    - start_time must be populated (Phase 5 prerequisite) — fails safe if NULL.
    - Uses a 3-day lookback so events that cross UTC midnight are still found.
    """
    now_utc = datetime.now(timezone.utc)
    three_days_ago = (now_utc - timedelta(days=3)).date().isoformat()
    today_utc = now_utc.date().isoformat()

    result = (
        supabase_db.table("ufc_events")
        .select("id, event_name, start_time, event_date")
        .gte("event_date", three_days_ago)
        .lte("event_date", today_utc)
        .order("event_date", desc=True)
        .limit(1)
        .execute()
    )

    if not result.data:
        return False, None, "No event in last 3 days"

    event = result.data[0]
    start_str = event.get("start_time")

    if not start_str:
        return False, None, f"start_time not set for {event['event_name']} — run Phase 5 first"

    start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
    window_open  = start_dt + timedelta(hours=5)
    window_close = start_dt + timedelta(hours=48)

    if now_utc < window_open:
        hrs = round((window_open - now_utc).total_seconds() / 3600, 1)
        return False, None, f"Post-event window opens in {hrs}h ({event['event_name']})"

    if now_utc > window_close:
        return False, None, f"Post-event window expired ({event['event_name']})"

    return True, event["event_name"], event["event_name"]


def is_live_window():
    """Return (True, event_name, msg) if in the active live-event window, else (False, None, msg)."""
    today_utc     = datetime.now(timezone.utc).date().isoformat()
    yesterday_utc = (datetime.now(timezone.utc) - timedelta(days=1)).date().isoformat()

    # 2-day window mirrors poll-live-fights Edge Function — handles events that
    # start late US time and cross UTC midnight (e.g. Saturday 11pm ET = Sunday UTC)
    result = (
        supabase_db.table("ufc_events")
        .select("id, event_name, start_time, event_date")
        .gte("event_date", yesterday_utc)
        .lte("event_date", today_utc)
        .order("event_date", desc=True)
        .limit(1)
        .execute()
    )
    if not result.data:
        return False, None, "No event today or yesterday (UTC)"

    event = result.data[0]
    start_str = event.get("start_time")

    # Fail-safe: if Phase 5 hasn't run, start_time is NULL — do not proceed
    if not start_str:
        return False, None, f"start_time not set for {event['event_name']} — run full pipeline first (Phase 5)"

    start_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
    now_utc  = datetime.now(timezone.utc)
    window_open = start_dt + timedelta(minutes=20)

    if now_utc < window_open:
        mins = int((window_open - now_utc).total_seconds() / 60)
        return False, None, f"Window opens in {mins} min ({event['event_name']})"

    # Upper bound: check if any fight is still open (fight_ended_at IS NULL)
    open_fights = (
        supabase_db.table("fights")
        .select("id")
        .eq("event_name", event["event_name"])
        .is_("fight_ended_at", "null")
        .execute()
    )
    if not open_fights.data:
        return False, None, f"All fights concluded for {event['event_name']}"

    return True, event["event_name"], event["event_name"]

# --- 2. UTILITY FUNCTIONS ---
def get_texts(td): 
    return [p.get_text(strip=True) for p in td.find_all('p')]

def time_to_seconds(time_str):
    if not time_str or ":" not in time_str: return 0
    try:
        m, s = map(int, time_str.strip().split(":"))
        return m * 60 + s
    except: return 0

def safe_split(text):
    try:
        l, a = text.split(' of ')
        return int(l), int(a)
    except: return 0, 0

def clean_bout_name(text):
    if not text: return text
    # Standardizes 'vs.' to 'vs' and removes invisible non-breaking spaces (\xa0)
    return text.replace(' vs. ', ' vs ').replace('\xa0', ' ').strip()

# --- 3. CORE PARSING LOGIC ---

import re as _re

def parse_weight_class(raw):
    """Return (weight_class_clean, is_title_fight, is_interim_title) from raw scraped weight_class."""
    if not raw:
        return None, False, False
    is_title    = bool(_re.search(r'title|championship', raw, _re.I))
    is_interim  = bool(_re.search(r'interim', raw, _re.I))
    clean = raw
    clean = _re.sub(r'\s*Bout\s*$',            '', clean, flags=_re.I)
    clean = _re.sub(r'\s*(Title|Championship)\s*$', '', clean, flags=_re.I)
    clean = _re.sub(r'\s*Title\s*',             ' ', clean, flags=_re.I)
    clean = _re.sub(r'^UFC\s+Interim\s+',       '',  clean, flags=_re.I)
    clean = _re.sub(r'^UFC\s+',                 '',  clean, flags=_re.I)
    return clean.strip(), is_title, is_interim

def parse_fight_meta_details(fight_url):
    try:
        res = requests.get(fight_url, timeout=10)
        soup = BeautifulSoup(res.text, 'html.parser')
        fighters = soup.select('div.b-fight-details__person')
        if len(fighters) < 2: return None

        f1_name = fighters[0].select_one('h3.b-fight-details__person-name').text.strip()
        f2_name = fighters[1].select_one('h3.b-fight-details__person-name').text.strip()
        r1 = fighters[0].select_one('i.b-fight-details__person-status').text.strip().upper()
        r2 = fighters[1].select_one('i.b-fight-details__person-status').text.strip().upper()

        f1_nick_el = fighters[0].select_one('p.b-fight-details__person-title')
        f2_nick_el = fighters[1].select_one('p.b-fight-details__person-title')
        f1_nickname = f1_nick_el.text.strip().strip('"') if f1_nick_el else None
        f2_nickname = f2_nick_el.text.strip().strip('"') if f2_nick_el else None

        winner = f1_name if r1 == "W" else (f2_name if r2 == "W" else None)
        details_div = soup.select_one("div.b-fight-details__fight")
        labels = details_div.select("i.b-fight-details__label")
        content = details_div.select("i.b-fight-details__text-item, i.b-fight-details__text-item_first")
        details = {l.text.strip().rstrip(":").lower().replace(" ", "_"): v.text.replace(l.text, "").strip() for l, v in zip(labels, content)}

        raw_event_name = soup.select_one("body > section > div > h2 > a").text.strip()
        cleaned_event_name = clean_bout_name(raw_event_name)

        raw_weight_class = details_div.select_one("i.b-fight-details__fight-title").text.strip()
        wc_clean, is_title, is_interim = parse_weight_class(raw_weight_class)

        return {
            "event_name": cleaned_event_name,
            "bout": f"{clean_bout_name(f1_name)} vs {clean_bout_name(f2_name)}",
            "fighter1_name": clean_bout_name(f1_name),
            "fighter1_nickname": f1_nickname if f1_nickname else None,
            "fighter2_name": clean_bout_name(f2_name),
            "fighter2_nickname": f2_nickname if f2_nickname else None,
            "winner": clean_bout_name(winner) if winner else None,
            "result": "win" if (r1 == "W" or r2 == "W") else "draw",
            "weight_class": raw_weight_class,
            "weight_class_clean": wc_clean,
            "is_title_fight": is_title,
            "is_interim_title": is_interim,
            "method": details.get("method", ""),
            "method_details": details.get("details", None),
            "round": details.get("round", ""),
            "time": details.get("time", ""),
            "time_format": details.get("time_format", ""),
            "referee": details.get("referee", ""),
            "fight_url": fight_url,
        }
    except Exception as e:
        print(f"⚠️  parse_fight_meta_details failed for {fight_url}: {e}")
        return None

def parse_base_stats_table(table, event_name, fight_name):
    tbody = table.find('tbody')
    rows = tbody.find_all(['thead', 'tr'], recursive=False)
    stats, round_num, i = [], 0, 0
    while i < len(rows):
        if rows[i].name == 'thead' and 'Round' in rows[i].text:
            round_num += 1
            i += 1
            tds = rows[i].find_all('td')
            if len(tds) == 10:
                # Extract raw text
                f1_raw = [td.find_all('p')[0].text.strip() for td in tds]
                f2_raw = [td.find_all('p')[1].text.strip() for td in tds]
                
                for f in [f1_raw, f2_raw]:
                    l_sig, a_sig = safe_split(f[2])
                    l_tot, a_tot = safe_split(f[4])
                    l_td, a_td = safe_split(f[5])
                    
                    # --- CLEANING STATION ---
                    stats.append({
                        "event_name": clean_bout_name(event_name),
                        "bout": clean_bout_name(fight_name),
                        "round": round_num,
                        "fighter_name": clean_bout_name(f[0]),
                        "kd": int(f[1]) if f[1].isdigit() else 0,
                        "sig_strikes_landed": l_sig,
                        "sig_strikes_attempted": a_sig,
                        "sig_strike_pct": round(l_sig / a_sig, 3) if a_sig > 0 else None,
                        "total_strikes_landed": l_tot,
                        "total_strikes_attempted": a_tot,
                        "takedowns_landed": l_td,
                        "takedowns_attempted": a_td,
                        "takedown_pct": round(l_td / a_td, 3) if a_td > 0 else None,
                        "sub_attempts": int(f[7]) if f[7].isdigit() else 0,
                        "reversals": int(f[8]) if f[8].isdigit() else 0,
                        "control_time": f[9],
                        "control_time_sec": time_to_seconds(f[9])
                    })
        i += 1
    return stats

def parse_zone_stats_table(table, event_name, fight_name):
    tbody = table.find('tbody')
    rows = tbody.find_all(['thead', 'tr'], recursive=False)
    stats, round_num, i = [], 0, 0
    while i < len(rows):
        if rows[i].name == 'thead' and 'Round' in rows[i].text:
            round_num += 1
            i += 1
            tds = rows[i].find_all('td')
            if len(tds) >= 9:
                f1 = {
                    "bout": fight_name, 
                    "fighter_name": clean_bout_name(tds[0].find_all("p")[0].text.strip()), 
                    "round": round_num
                }
                f2 = {
                    "bout": fight_name, 
                    "fighter_name": clean_bout_name(tds[0].find_all("p")[1].text.strip()), 
                    "round": round_num
                }
                
                keys = ["sig_strikes_head", "sig_strikes_body", "sig_strikes_leg", "sig_strikes_distance", "sig_strikes_clinch", "sig_strikes_ground"]
                for offset, key in enumerate(keys, start=3):
                    l1, a1 = safe_split(tds[offset].find_all("p")[0].text.strip())
                    l2, a2 = safe_split(tds[offset].find_all("p")[1].text.strip())
                    f1[f"{key}_landed"], f1[f"{key}_attempted"], f2[f"{key}_landed"], f2[f"{key}_attempted"] = l1, a1, l2, a2
                
                stats.extend([f1, f2])
        i += 1
    return stats

# --- 4. NEW: UPCOMING SCRAPERS ---

def sync_upcoming_events():
    print("🔮 Phase 0: Syncing Upcoming Events (Next Event Only)...")
    res = requests.get("http://ufcstats.com/statistics/events/upcoming", timeout=15)
    soup = BeautifulSoup(res.text, 'html.parser')
    rows = soup.find('table', class_='b-statistics__table-events').find_all('tr', class_='b-statistics__table-row')
    
    # LOGIC CHANGE: Only process the FIRST valid row (The next event)
    # The first row is usually the header, so we look for the first one with a link
    
    found_next_event = False
    
    for row in rows:
        if found_next_event: break # Stop after finding the first one
        
        if not row.find('a'): continue 
        
        tds = row.find_all('td')
        e_name = clean_bout_name(tds[0].find('a').text.strip())
        e_url = tds[0].find('a')['href']
        e_date = tds[0].find('span', class_='b-statistics__date').text.strip()
        
        try:
            iso_date = datetime.strptime(e_date, "%B %d, %Y").date().isoformat()
        except:
            iso_date = None

        # Check if exists
        if supabase_db.table("ufc_events").select("id").eq("event_url", e_url).execute().data: 
            found_next_event = True # Mark found so we stop looping
            continue 
            
        print(f"📅 New Upcoming Event: {e_name}")
        supabase_db.table("ufc_events").insert({
            "event_name": e_name, 
            "event_url": e_url, 
            "event_date": iso_date, 
            "event_location": tds[1].text.strip()
        }).execute()
        stats_summary["new_events"] += 1
        found_next_event = True # Stop after inserting the one event

def sync_upcoming_fights():
    print("🔮 Phase 0.5: Syncing Upcoming Fights (Next Event Only)...")
    
    today = datetime.now().date().isoformat()
    
    # FETCH ONLY THE 1 NEAREST EVENT
    events = supabase_db.table("ufc_events")\
        .select("event_name, event_url, event_date")\
        .filter("event_date", "gte", today)\
        .order("event_date", desc=False)\
        .limit(1)\
        .execute()
    
    for event in events.data:
        print(f"Processing Next Event: {event['event_name']}")

        # Build a set of bouts already in DB for this event (per-fight check)
        existing = supabase_db.table("fights").select("bout").eq("event_name", event['event_name']).execute().data
        existing_bouts = [f['bout'] for f in existing]

        res = requests.get(event['event_url'], timeout=15)
        soup = BeautifulSoup(res.text, 'html.parser')
        tbody = soup.find('tbody')
        if not tbody: continue

        rows = tbody.find_all('tr', class_='b-fight-details__table-row')
        for row in rows:
            cols = row.find_all('td')
            if len(cols) < 2: continue

            fighters = get_texts(cols[1])
            if len(fighters) < 2: continue

            # Check Col 1 for link first, then Col 0
            link_tag = cols[1].find('a')
            if not link_tag:
                 link_tag = cols[0].find('a')

            fight_url = link_tag['href'] if link_tag else None

            f1 = clean_bout_name(fighters[0])
            f2 = clean_bout_name(fighters[1])
            standardized_bout = f"{f1} vs {f2}"

            if standardized_bout in existing_bouts or any(_bout_matches(f1, f2, b) for b in existing_bouts):
                print(f"  ⏭️  Skipping existing: {standardized_bout}")
                continue

            print(f"⚔️  Upcoming Fight: {standardized_bout}")

            raw_wc = cols[6].get_text(strip=True) if len(cols) > 6 else None

            supabase_db.table("fights").insert({
                'event_name': event['event_name'],
                'bout': standardized_bout,
                'fight_url': fight_url,
                'status': 'upcoming',
                'weight_class': raw_wc or None,
            }).execute()
            stats_summary["new_fights"] += 1


# --- 5. UPDATED: MAIN SCRAPERS ---

def sync_events():
    print("🚀 Phase 1: Syncing Completed Events...")
    res = requests.get("http://ufcstats.com/statistics/events/completed?page=all", timeout=15)
    soup = BeautifulSoup(res.text, 'html.parser')
    rows = soup.find('table', class_='b-statistics__table-events').find_all('tr', class_='b-statistics__table-row')
    consecutive_existing = 0
    STOP_AFTER = 5  # Stop once we've seen this many already-in-DB events in a row
    for row in rows:
        if not row.find('a') or row.find('img'): continue
        e_name = clean_bout_name(row.find_all('td')[0].find('a').text.strip())
        e_url = row.find_all('td')[0].find('a')['href']
        e_date = row.find_all('td')[0].find('span', class_='b-statistics__date').text.strip()
        iso_date = datetime.strptime(e_date, "%B %d, %Y").date().isoformat()

        if supabase_db.table("ufc_events").select("id").eq("event_url", e_url).execute().data:
            consecutive_existing += 1
            if consecutive_existing >= STOP_AFTER:
                break
            continue

        consecutive_existing = 0  # Reset — found a gap
        print(f"🏟️ New Completed Event: {e_name}")
        supabase_db.table("ufc_events").insert({"event_name": e_name, "event_url": e_url, "event_date": iso_date, "event_location": row.find_all('td')[1].text.strip()}).execute()
        stats_summary["new_events"] += 1

def sync_fights():
    print("🚀 Phase 2: Syncing Completed Fights...")
    # Fetch recent events
    events = supabase_db.table("ufc_events").select("event_name, event_url, event_date").order("event_date", desc=True).limit(10).execute()
    
    for event in events.data:
        # 1. Fetch ALL existing fights for this event
        existing_fights = supabase_db.table("fights").select("id, bout, status").eq("event_name", event['event_name']).execute().data
        
        # 2. Create a lookup map
        existing_map = {}
        for f in existing_fights:
            existing_map[f['bout']] = f
            if " vs " in f['bout']:
                p1, p2 = f['bout'].split(" vs ")
                existing_map[f"{p2} vs {p1}"] = f

        scraped_ids = []
        any_newly_completed = False

        try:
            res = requests.get(event['event_url'], timeout=30)
            res.raise_for_status()
        except Exception as e:
            print(f"   ⚠️  Phase 2: could not fetch {event['event_url']}: {e} — skipping event")
            continue
        soup = BeautifulSoup(res.text, 'html.parser')
        tbody = soup.find('tbody')

        # Only parse rows if tbody exists
        if tbody:
            rows = tbody.find_all('tr', class_='b-fight-details__table-row')
            for row in rows:
                cols = row.find_all('td')
                if len(cols) < 10: continue

                fighters = get_texts(cols[1])
                if len(fighters) < 2: continue

                link_tag = cols[0].find('a')
                if not link_tag: continue

                f1 = clean_bout_name(fighters[0])
                f2 = clean_bout_name(fighters[1])
                standardized_bout = f"{f1} vs {f2}"
                fight_url = link_tag['href']

                # 3. Check map (exact first, then alias-aware fallback)
                if standardized_bout in existing_map:
                    fight_record = existing_map[standardized_bout]
                    scraped_ids.append(fight_record['id'])

                    if fight_record.get('status') == 'upcoming':
                        print(f"🔄 Updating Status (Upcoming -> Completed): {standardized_bout}")
                        supabase_db.table("fights").update({
                            "status": "completed",
                            "fight_url": fight_url,
                            "bout": standardized_bout
                        }).eq("id", fight_record['id']).execute()
                        stats_summary["updated_fights"] += 1
                        any_newly_completed = True
                else:
                    # Alias-aware fallback: catches fighters known by different names
                    # across scrape sources (e.g. "Patricio Pitbull" vs "Patricio Freire")
                    parts = standardized_bout.split(' vs ', 1)
                    alias_match = next(
                        (f for f in existing_fights if len(parts) == 2 and _bout_matches(parts[0], parts[1], f['bout'])),
                        None
                    )
                    if alias_match:
                        scraped_ids.append(alias_match['id'])
                        if alias_match.get('status') == 'upcoming':
                            print(f"🔄 Updating Status (Upcoming -> Completed, alias): {alias_match['bout']} ← {standardized_bout}")
                            supabase_db.table("fights").update({
                                "status": "completed",
                                "fight_url": fight_url,
                            }).eq("id", alias_match['id']).execute()
                            stats_summary["updated_fights"] += 1
                            any_newly_completed = True
                    else:
                        print(f"➕ Inserting New Completed: {standardized_bout}")
                        supabase_db.table("fights").insert({
                            'event_name': event['event_name'],
                            'bout': standardized_bout,
                            'fight_url': fight_url,
                            'status': 'completed'
                        }).execute()
                        stats_summary["new_fights"] += 1

        # 4. AUTO-DELETE LOGIC
        # Only delete if: fights found on ufcstats AND nothing newly completed this
        # run AND event is safely in the past (UTC datetime + 34-hour buffer).
        # The 34-hour buffer covers UTC-8 events plus a 2-hour card overrun,
        # preventing false deletions on GitHub Actions runners where date.today()
        # is UTC rather than local time.
        event_date_str = event.get('event_date', '')
        if event_date_str:
            event_day_end_utc = datetime(
                *[int(x) for x in event_date_str.split('-')],
                tzinfo=timezone.utc
            ) + timedelta(days=1, hours=10)
            event_is_past = datetime.now(timezone.utc) > event_day_end_utc
        else:
            event_is_past = False
        if len(scraped_ids) > 0 and not any_newly_completed and event_is_past:
            for f in existing_fights:
                if f['status'] == 'upcoming' and f['id'] not in scraped_ids:
                    print(f"🚫 Deleting Cancelled Fight: {f['bout']}")
                    supabase_db.table("user_votes").delete().eq("fight_id", f['id']).execute()
                    supabase_db.table("fights").delete().eq("id", f['id']).execute()

def sync_meta(event_name: Optional[str] = None):
    if event_name:
        print(f"🚀 Phase 3: Syncing Metadata & Winners for event: {event_name}...")
        fights = (
            supabase_db.table("fights")
            .select("bout, fight_url")
            .eq("status", "completed")
            .eq("event_name", event_name)
            .order("id", desc=True)
            .execute()
        )
    else:
        print("🚀 Phase 3: Syncing Metadata & Winners...")
        # Fetch ALL completed fights — per-fight URL check skips already-processed ones
        fights = supabase_db.table("fights").select("bout, fight_url").eq("status", "completed").order("id", desc=True).execute()

    for f in fights.data:
        # Check if meta already exists to avoid duplicates
        if supabase_db.table("fight_meta_details").select("id").eq("fight_url", f['fight_url']).execute().data:
            continue

        data = parse_fight_meta_details(f['fight_url'])
        if data:
            data['bout'] = clean_bout_name(data.get('bout', ''))

            # --- THE FIX ---
            # Remove 'status' from the dictionary because the fight_meta_details table
            # doesn't have a 'status' column. (It only exists on the parent 'fights' table).
            data.pop('status', None)

            # 1. Insert the detailed metadata
            supabase_db.table("fight_meta_details").insert(data).execute()

            # 2. Update the main 'fights' table with winner + weight_class
            fights_update = {}
            if data.get('winner'):
                fights_update['winner'] = data['winner']
            if data.get('weight_class'):
                fights_update['weight_class'] = data['weight_class']
            if fights_update:
                if data.get('winner'):
                    print(f"🏆 Updating Winner for {data['bout']}: {data['winner']}")
                supabase_db.table("fights").update(fights_update).eq("fight_url", f['fight_url']).execute()

            stats_summary["new_metadata"] += 1
            time.sleep(1)

    # Re-scrape pass — catches fights whose first scrape ran while ufcstats
    # hadn't published the W/L status yet (winner came back None, fmd was
    # inserted with winner=NULL and result='draw' by mistake). Filter excludes
    # confirmed draws (result='draw') only once a re-scrape has corroborated
    # them; on first re-scrape these still match and either get a real winner
    # set or get reaffirmed as a draw.
    rescrape_null_winner_decisions(event_name)


def rescrape_null_winner_decisions(event_name: Optional[str] = None):
    """Re-scrape fmd rows where winner is NULL on a completed Decision fight.
    Updates fmd + fights.winner if the page now exposes a winner; leaves rows
    untouched if the parse still returns winner=None (a real draw).
    """
    q = (
        supabase_db.table("fight_meta_details")
        .select("id, fight_url, method")
        .is_("winner", "null")
        .ilike("method", "Decision%")
    )
    stale = q.execute().data or []
    if not stale:
        return

    if event_name:
        event_urls = {
            f['fight_url'] for f in (
                supabase_db.table("fights")
                .select("fight_url")
                .eq("event_name", event_name)
                .eq("status", "completed")
                .execute().data or []
            )
        }
        stale = [s for s in stale if s['fight_url'] in event_urls]
        if not stale:
            return

    print(f"🔁 Phase 3 rescrape: {len(stale)} null-winner decision row(s) to re-check")
    for s in stale:
        data = parse_fight_meta_details(s['fight_url'])
        if not data or not data.get('winner'):
            time.sleep(1)
            continue
        supabase_db.table("fight_meta_details").update({
            "winner": data['winner'],
            "result": data.get('result', 'win'),
        }).eq("id", s['id']).execute()
        supabase_db.table("fights").update({"winner": data['winner']}).eq("fight_url", s['fight_url']).execute()
        print(f"   🏆 Re-scrape filled winner for {s['fight_url']}: {data['winner']}")
        time.sleep(1)

def sync_round_stats():
    print("🚀 Phase 4: Syncing Round Stats...")
    # Fetch tasks from your view or manually check missing stats
    # For simplicity, we use the View if you have it, or just check recent fights
    # Assuming 'fight_scraping_status' view exists:
    try:
        tasks = supabase_db.table("fight_scraping_status").select("bout, event_name, fight_url").filter("fight_status", "in", '("❌ MISSING", "⚠️ PARTIAL")').execute()
        
        for task in tasks.data:
            res = requests.get(task['fight_url'])
            if res.status_code != 200:
                print(f"   ⚠️  Phase 4: HTTP {res.status_code} for {task['fight_url']} — skipping")
                time.sleep(1)
                continue
            soup = BeautifulSoup(res.text, 'html.parser')
            tables = soup.find_all('table', class_='b-fight-details__table js-fight-table')
            if len(tables) < 2: continue

            cleaned_bout = clean_bout_name(task['bout'])
            main = parse_base_stats_table(tables[0], task['event_name'], cleaned_bout)
            zone = parse_zone_stats_table(tables[1], task['event_name'], cleaned_bout)

            z_map = {(z["fighter_name"], z["round"]): z for z in zone}
            merged = [{**m, **z_map.get((m["fighter_name"], m["round"]), {})} for m in main]

            supabase_db.table("round_fight_stats").upsert(merged, on_conflict="event_name,bout,round,fighter_name").execute()
            stats_summary["new_round_rows"] += len(merged)
            time.sleep(1)
    except Exception as e:
        print(f"Skipping Round Stats (View might be missing): {e}")



# --- ADD THIS FUNCTION WITH YOUR OTHER SCRAPERS ---
def _norm_name(s):
    """Lowercase + strip non-alphanumeric except spaces. Mirrors frontend normName()."""
    import re, unicodedata
    # Transliterate characters that NFD won't decompose (ł→l, ø→o, ð→d, þ→th, ß→ss, æ→ae, œ→oe)
    _xlat = str.maketrans({
        'ł': 'l', 'Ł': 'l', 'ø': 'o', 'Ø': 'o',
        'ð': 'd', 'Ð': 'd', 'þ': 'th', 'Þ': 'th',
        'ß': 'ss', 'æ': 'ae', 'Æ': 'ae', 'œ': 'oe', 'Œ': 'oe',
    })
    s = s.translate(_xlat)
    return re.sub(r'[^a-z0-9 ]', '', unicodedata.normalize('NFD', s).lower()).strip()

# Fighters whose ESPN name differs from their UFC Stats name (normalized → normalized).
# Add entries when ESPN uses a nickname or alternate spelling as the display name.
_FIGHTER_ALIASES = {
    'patricio pitbull': 'patricio freire',
}

def _resolve_alias(n):
    return _FIGHTER_ALIASES.get(n, n)

def _names_match(a, b):
    """True if two fighter names refer to the same person (order-insensitive)."""
    na, nb = _resolve_alias(_norm_name(a)), _resolve_alias(_norm_name(b))
    if na == nb:
        return True
    # Space-collapse (handles "Rong Zhu" / "Rongzhu")
    if na.replace(' ', '') == nb.replace(' ', ''):
        return True
    # Last-name match (last word, length > 3)
    la, lb = na.split()[-1], nb.split()[-1]
    if len(la) > 3 and la == lb:
        return True
    return False

def _bout_matches(espn_a, espn_b, db_bout):
    """True if ESPN fighters {espn_a, espn_b} match the DB bout string."""
    if ' vs ' not in db_bout:
        return False
    db_a, db_b = db_bout.split(' vs ', 1)
    return (
        (_names_match(espn_a, db_a) and _names_match(espn_b, db_b)) or
        (_names_match(espn_a, db_b) and _names_match(espn_b, db_a))
    )

def sync_event_times():
    print("⏰ Phase 5: Syncing Event Times + ESPN Competition IDs (Future Focused)...")

    # 1. Get today's date
    today = datetime.now().date().isoformat()

    # 2. Fetch ONLY future/upcoming events from your DB
    upcoming_events = supabase_db.table("ufc_events")\
        .select("*")\
        .gte("event_date", today)\
        .order("event_date", desc=False)\
        .execute()

    if not upcoming_events.data:
        print("   No upcoming events found in DB to sync.")
        return

    base_url = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard"

    for db_event in upcoming_events.data:
        # Convert DB date (YYYY-MM-DD) to ESPN format (YYYYMMDD)
        date_param = db_event['event_date'].replace("-", "")

        print(f"   🔍 Querying ESPN for {db_event['event_name']} (Date: {db_event['event_date']})...")

        try:
            # 3. Ask ESPN specifically for THIS date
            res = requests.get(f"{base_url}?dates={date_param}").json()
            events = res.get('events', [])

            match_found = False
            for espn_event in events:
                # Guard: only match UFC events — skip boxing or other combat sports on same date
                if 'UFC' not in espn_event.get('name', '').upper(): continue

                # 4a. Update event start time
                espn_time_str = espn_event.get('date', '')
                if espn_time_str:
                    print(f"      Found match! Updating start time to: {espn_time_str}")
                    supabase_db.table("ufc_events").update({
                        "start_time": espn_time_str
                    }).eq("id", db_event['id']).execute()

                # 4b. Populate fights.espn_competition_id for each competition
                db_fights = supabase_db.table("fights")\
                    .select("id, bout, espn_competition_id, scheduled_rounds, card_position")\
                    .eq("event_name", db_event['event_name'])\
                    .eq("status", "upcoming")\
                    .execute().data

                competitions = espn_event.get('competitions', [])
                total_comps = len(competitions)
                matched_ids, unmatched = [], []

                for comp_index, comp in enumerate(competitions):
                    comp_id = str(comp['id'])
                    athletes = [c.get('athlete', {}).get('displayName', '') for c in comp.get('competitors', [])]
                    if len(athletes) < 2:
                        continue
                    espn_a, espn_b = athletes[0], athletes[1]

                    db_match = next(
                        (f for f in db_fights if _bout_matches(espn_a, espn_b, f['bout'])),
                        None
                    )
                    if db_match:
                        matched_ids.append(db_match['id'])
                        updates = {}
                        if db_match['espn_competition_id'] != comp_id:
                            updates['espn_competition_id'] = comp_id
                            print(f"      🔗 {db_match['bout']} → competition_id={comp_id}")
                        # Persist scheduled rounds (3 or 5) so frontend knows round count before event
                        scheduled = comp.get('format', {}).get('regulation', {}).get('periods')
                        if scheduled and db_match.get('scheduled_rounds') != scheduled:
                            updates['scheduled_rounds'] = scheduled
                        # Sync card_position from ESPN order (main event = 1, first fight = highest)
                        espn_card_pos = total_comps - comp_index
                        if db_match.get('card_position') != espn_card_pos:
                            updates['card_position'] = espn_card_pos
                        if updates:
                            supabase_db.table("fights").update(updates).eq("id", db_match['id']).execute()
                    else:
                        unmatched.append(f"{espn_a} vs {espn_b}")

                no_espn = [f['bout'] for f in db_fights if f['id'] not in matched_ids]
                if unmatched:
                    print(f"      ⚠️  ESPN comps not matched to DB: {unmatched}")
                if no_espn:
                    print(f"      ⚠️  DB fights with no ESPN match: {no_espn}")

                match_found = True
                break # Move to next DB event

            if not match_found:
                print(f"      ⚠️ No scheduled data found on ESPN yet for this date.")

        except Exception as e:
            print(f"      ❌ Error syncing time: {e}")

def sync_judge_scores():
    print("⚖️  Phase 6: Syncing Judge Scores (mmadecisions.com)...")
    scraper = Path(__file__).parent / "scrape_mmadecisions.py"
    result = subprocess.run([sys.executable, str(scraper), "--yes"], text=True)
    if result.returncode != 0:
        print(f"   ⚠️  scrape_mmadecisions.py exited with code {result.returncode}")
    else:
        print("   ✅ Judge scores sync complete.")


# --- 6. EXECUTION ---
if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true",
                        help="Live-event mode: Phases 2-4 only, guarded by start_time check")
    parser.add_argument("--post-event", action="store_true",
                        help="Post-event mode: Phases 0/0.5/1/5/6, window start_time+5h to +48h")
    args = parser.parse_args()

    start_time = time.time()

    if args.live:
        in_window, event_name, detail = is_live_window()
        if not in_window:
            print(f"⏸  Live mode: skipping — {detail}")
            sys.exit(0)
        print(f"⚡ Live mode active — {detail}")
        sync_fights()
        sync_meta(event_name=event_name)
        sync_round_stats()
    elif args.post_event:
        in_window, event_name, detail = is_post_event_window()
        if not in_window:
            print(f"⏸  Post-event mode: skipping — {detail}")
            sys.exit(0)
        print(f"🔧 Post-event mode active — {detail}")
        sync_upcoming_events()
        sync_upcoming_fights()
        sync_events()
        sync_fights()
        sync_meta(event_name=event_name)
        sync_round_stats()
        sync_event_times()
        sync_judge_scores()
    else:
        # 1. Upcoming First
        sync_upcoming_events()
        sync_upcoming_fights()

        # 2. Completed/Updates Second
        sync_events()
        sync_fights()
        sync_meta()
        sync_round_stats()
        sync_judge_scores()
        sync_event_times()

    duration = round(time.time() - start_time, 2)
    print("\n" + "="*30)
    print(f"📊 SCRAPE SUMMARY ({duration}s)")
    print(f"📅  New Events:     {stats_summary['new_events']}")
    print(f"🥊  New Fights:     {stats_summary['new_fights']}")
    print(f"🔄  Updated Fights: {stats_summary['updated_fights']}")
    print(f"📝  Meta Added:     {stats_summary['new_metadata']}")
    print(f"🔢  Round Rows:     {stats_summary['new_round_rows']}")
    print("="*30)
    print("🏁 Master Sync Complete.")