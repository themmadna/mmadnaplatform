"""
backfill_rfs_fight_url.py — One-time backfill of round_fight_stats.fight_url.

Context: 2026-05-16 Supabase audit S-P1-5. The April FK migration backfilled
fight_url on every existing rfs row, but the live Phase 4 scraper insert wasn't
writing fight_url on new events. 270 rows across 5 recent events have
fight_url IS NULL.

Scraper fix already landed in `master file for data update.py` (Phase 4
upsert now stamps fight_url from the task). This script clears the 270 rows
of historical drift.

Join strategy: rfs → fights on event_name + bout, handling both bout orderings
(Convention #1 / #9: fights.bout and rfs.bout can be reversed). This matches
the SQL the audit recommended in 99-followups.md §5.

Pre-flight aborts if 0 NULL rows (already clean) or if any event has rfs rows
that don't map to a fights row at all.

Run once:
    python supabase/backfill_rfs_fight_url.py
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
URL = f"https://api.supabase.com/v1/projects/{project_ref}/database/query"
HEADERS = {"Authorization": f"Bearer {mgmt_key}", "Content-Type": "application/json"}


def run_sql(sql: str):
    r = requests.post(URL, headers=HEADERS, json={"query": sql}, timeout=30)
    if not r.ok:
        print(f"❌ {r.status_code}: {r.text}")
        sys.exit(1)
    return r.json()


# ---------------------------------------------------------------
# Pre-flight: count NULL rows + show breakdown
# ---------------------------------------------------------------
print("Pre-flight: scanning round_fight_stats for NULL fight_url...")

PRE_SQL = """
SELECT event_name, COUNT(*) AS null_rows
FROM round_fight_stats
WHERE fight_url IS NULL
GROUP BY event_name
ORDER BY null_rows DESC;
"""

pre = run_sql(PRE_SQL)
total_null = sum(r['null_rows'] for r in pre)

if total_null == 0:
    print("✅ Nothing to do — every rfs row already has fight_url set.")
    sys.exit(0)

print(f"\nFound {total_null} NULL rows across {len(pre)} event(s):")
for r in pre:
    print(f"  {r['null_rows']:>4}  {r['event_name']}")

# Sanity-check: every NULL row's (event_name, bout) should match at least
# one fights row (under either bout ordering). If any are unmatched, the
# UPDATE will leave them NULL — surface that now.
UNMATCHED_SQL = """
SELECT DISTINCT rfs.event_name, rfs.bout
FROM round_fight_stats rfs
LEFT JOIN fights f
  ON rfs.event_name = f.event_name
 AND (rfs.bout = f.bout
      OR rfs.bout = TRIM(SPLIT_PART(f.bout,' vs ',2)) || ' vs ' || TRIM(SPLIT_PART(f.bout,' vs ',1)))
WHERE rfs.fight_url IS NULL
  AND f.id IS NULL;
"""
unmatched = run_sql(UNMATCHED_SQL)
if unmatched:
    print(f"\n⚠️  {len(unmatched)} (event, bout) combinations have no matching fights row:")
    for u in unmatched:
        print(f"  {u['event_name']!r}  |  {u['bout']!r}")
    print("\nAbort — these would stay NULL after the UPDATE. Investigate before re-running.")
    sys.exit(1)

print("\n✅ Every NULL row maps to a fights row. Proceeding with UPDATE.\n")


# ---------------------------------------------------------------
# Update
# ---------------------------------------------------------------
UPDATE_SQL = """
UPDATE round_fight_stats rfs
SET fight_url = f.fight_url
FROM fights f
WHERE rfs.event_name = f.event_name
  AND (rfs.bout = f.bout
       OR rfs.bout = TRIM(SPLIT_PART(f.bout,' vs ',2)) || ' vs ' || TRIM(SPLIT_PART(f.bout,' vs ',1)))
  AND rfs.fight_url IS NULL
RETURNING rfs.id;
"""

updated = run_sql(UPDATE_SQL)
print(f"Updated {len(updated)} rows.")


# ---------------------------------------------------------------
# Verify
# ---------------------------------------------------------------
post = run_sql(PRE_SQL)
remaining = sum(r['null_rows'] for r in post)

if remaining == 0:
    print("\n✅ All rfs rows now have fight_url set.")
else:
    print(f"\n❌ {remaining} rows still NULL after UPDATE:")
    for r in post:
        print(f"  {r['null_rows']:>4}  {r['event_name']}")
    sys.exit(1)
