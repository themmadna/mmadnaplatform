"""
migrate_event_ended_at.py — Add ufc_events.ended_at + backfill.

Background:
  The frontend `isLiveEvent()` had no "event is over" signal — it showed the LIVE
  badge for the whole calendar day once start_time passed, even after the main event
  ended hours earlier. This adds a real ended-at timestamp that the poll-live-fights
  Edge Function stamps when the main event reaches STATUS_FINAL. The events list is
  loaded with `select('*')`, so the new column flows through with no query change.

  Backfill rule: an event's main event is the fight with the lowest card_position
  (== 1 once ESPN has synced), falling back to the lowest id (Convention #4: lowest id
  = main event for pre-live-tracking events). If that fight has fight_ended_at set, the
  event is over and we stamp ufc_events.ended_at with it. Historical events that were
  never live-tracked have no fight_ended_at on any fight, so they stay NULL — harmless,
  since isLiveEvent only ever evaluates today's event.

Run once:
    python supabase/migrate_event_ended_at.py

Idempotent: ADD COLUMN IF NOT EXISTS; backfill only writes rows where ended_at IS NULL.
"""

import sys
import os
import requests
from pathlib import Path
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

load_dotenv(dotenv_path=Path(__file__).parent.parent / '.env')

supabase_url = os.environ.get("REACT_APP_SUPABASE_URL", "")
mgmt_key = os.environ.get("SUPABASE_MANAGEMENT_KEY", "")

if not supabase_url or not mgmt_key:
    raise SystemExit("Missing REACT_APP_SUPABASE_URL or SUPABASE_MANAGEMENT_KEY in .env")

project_ref = supabase_url.replace("https://", "").split(".")[0]
MGMT_QUERY_URL = f"https://api.supabase.com/v1/projects/{project_ref}/database/query"
HEADERS = {"Authorization": f"Bearer {mgmt_key}", "Content-Type": "application/json"}


def run_sql(sql: str):
    r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": sql}, timeout=30)
    if not r.ok:
        print(f"FAIL query {r.status_code}: {r.text}")
        sys.exit(1)
    return r.json()


# ---------------------------------------------------------------
# 1. Add column (idempotent)
# ---------------------------------------------------------------
print("Adding ufc_events.ended_at (if not present)...")
run_sql("ALTER TABLE public.ufc_events ADD COLUMN IF NOT EXISTS ended_at timestamptz;")

# ---------------------------------------------------------------
# 2. Backfill from each event's main event
# ---------------------------------------------------------------
print("Backfilling ended_at from main-event fight_ended_at...")
BACKFILL_SQL = """
WITH main_events AS (
  SELECT DISTINCT ON (event_name)
         event_name, fight_ended_at
  FROM fights
  ORDER BY event_name, card_position ASC NULLS LAST, id ASC
)
UPDATE public.ufc_events e
SET ended_at = m.fight_ended_at
FROM main_events m
WHERE e.event_name = m.event_name
  AND m.fight_ended_at IS NOT NULL
  AND e.ended_at IS NULL
RETURNING e.event_name, e.ended_at;
"""
updated = run_sql(BACKFILL_SQL)
print(f"  stamped ended_at on {len(updated)} event(s)")
for row in updated[:10]:
    print(f"    {row['event_name']}  ->  {row['ended_at']}")
if len(updated) > 10:
    print(f"    ... and {len(updated) - 10} more")

# ---------------------------------------------------------------
# 3. Verify the current (today's) live event specifically
# ---------------------------------------------------------------
print("\nVerify — recent events with ended_at state:")
VERIFY_SQL = """
SELECT event_name, event_date, start_time, ended_at
FROM public.ufc_events
ORDER BY event_date DESC
LIMIT 5;
"""
for row in run_sql(VERIFY_SQL):
    print(f"  {row['event_date']}  {row['event_name']:<48}  ended_at={row['ended_at']}")

print("\nOK migration complete.")
