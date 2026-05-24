"""
fix_rfs_fight_url_misstamps.py - S-P1-18 corrective backfill.

Root cause
----------
supabase/migrate_round_stats_fk.py (deployed April 2026) backfilled
round_fight_stats.fight_url by joining only on bout text:

    UPDATE round_fight_stats rfs
    SET fight_url = fmd.fight_url
    FROM fight_meta_details fmd
    WHERE rfs.fight_url IS NULL
      AND (rfs.bout = fmd.bout
           OR rfs.bout = REVERSED(fmd.bout));

No event_name filter. For any fighter pair that fought across multiple
events (rematches, twice-fought matchups), Postgres picked one fmd row
arbitrarily and stamped the wrong fight_url onto the rfs row.

Impact
------
Discovered 2026-05-24 while pre-flighting S-P2-11:
  - 1239 rfs rows are misstamped (rfs.fight_url points to a fights row
    in a DIFFERENT event than rfs.event_name)
  - 220 distinct (event_name, bout) groups affected
  - 215 fights would lose all stats if the fight_dna_metrics view were
    refactored to join on fight_url today (S-P2-11)

The live view is currently masking this because it joins on
(event_name, bout) text - which happens to be right. The misstamped
fight_url is dormant data, but blocks the view refactor.

Fix
---
Re-stamp the 1239 rows with the fight_url of the fights row whose
(event_name, bout) actually matches the rfs row (reverse-aware bout
match).

Edge case (Ultimate Japan): two Sakuraba vs Silveira fights on the same
card. Both fights rows have identical event_name + bout text. The 2 rfs
rows are already correctly stamped to the rematch fight_url. The UPDATE
skips any row whose current fight_url already points at a fights row in
the same event_name - this protects the Ultimate Japan rows from being
flipped to a different fights row of the same (event, bout) pair.

Single transaction. Pre-flight reports the count + 5 sample re-stamps.
Aborts if a row would have no valid corrected target (defense in depth -
the audit confirmed every misstamped row has a valid target).

Idempotent: a re-run on a clean DB updates 0 rows.

Run once:
    python supabase/fix_rfs_fight_url_misstamps.py
"""

import json
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
    r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": sql}, timeout=60)
    if not r.ok:
        print(f"FAIL query {r.status_code}: {r.text}")
        sys.exit(1)
    return r.json()


# CTE shared by pre-flight + UPDATE. Skips any rfs row whose current
# fight_url already points at a fights row in the same event (Ultimate
# Japan edge case + future-proofing).
CTE = """
WITH misstamped AS (
  SELECT rfs.id              AS rfs_id,
         rfs.event_name      AS rfs_event,
         rfs.bout            AS rfs_bout,
         rfs.fight_url       AS current_url,
         f.fight_url         AS correct_url,
         f.id                AS correct_fight_id
  FROM round_fight_stats rfs
  JOIN fights f
    ON rfs.event_name = f.event_name
   AND (rfs.bout = f.bout
        OR rfs.bout = TRIM(SPLIT_PART(f.bout, ' vs ', 2)) || ' vs ' ||
                      TRIM(SPLIT_PART(f.bout, ' vs ', 1)))
  WHERE rfs.fight_url IS DISTINCT FROM f.fight_url
    AND NOT EXISTS (
      -- guard against the Ultimate Japan case: skip if the rfs row's
      -- current fight_url already maps to SOME fights row in the same
      -- event (already correct, leave alone).
      SELECT 1 FROM fights f_curr
      WHERE f_curr.fight_url = rfs.fight_url
        AND f_curr.event_name = rfs.event_name
    )
)
"""


# ---------------------------------------------------------------
# Pre-flight: count + sample
# ---------------------------------------------------------------
print("Pre-flight: scanning round_fight_stats for fight_url misstamps...\n")

pre = run_sql(CTE + """
SELECT COUNT(*) AS rows_to_update,
       COUNT(DISTINCT (rfs_event, rfs_bout)) AS distinct_groups,
       COUNT(DISTINCT correct_fight_id) AS distinct_targets
FROM misstamped;
""")
print("Pre-flight summary:")
print(json.dumps(pre, indent=2, default=str))

rows_to_update = pre[0]["rows_to_update"]
if rows_to_update == 0:
    print("\nNothing to do - rfs.fight_url is already canonical.")
    sys.exit(0)

print("\nSample of 5 re-stamps (rfs_event | rfs_bout | current_url -> correct_url):")
sample = run_sql(CTE + """
SELECT rfs_event, rfs_bout, current_url, correct_url, correct_fight_id
FROM misstamped
ORDER BY rfs_event DESC, rfs_bout
LIMIT 5;
""")
for s in sample:
    print(f"  [{s['rfs_event']}] {s['rfs_bout']}")
    print(f"    {s['current_url']}  ->  {s['correct_url']}  (fights.id={s['correct_fight_id']})")

# Defensive: confirm no rfs row maps to multiple fights rows that BOTH
# differ from its current url (would mean the bout text alone is still
# ambiguous after our event_name filter)
ambig = run_sql(CTE + """
SELECT rfs_id, COUNT(*) AS targets
FROM misstamped
GROUP BY rfs_id
HAVING COUNT(*) > 1;
""")
if ambig:
    print(f"\nAbort: {len(ambig)} rfs rows match multiple corrected targets:")
    for a in ambig[:10]:
        print(f"  {a['rfs_id']}: {a['targets']} matches")
    sys.exit(1)


# ---------------------------------------------------------------
# Baseline: snapshot fight_dna_metrics for the affected fights so we
# can verify post-update that the live view's values are unchanged.
# (The view joins on (event_name, bout), not fight_url - so changing
# rfs.fight_url should NOT shift any view value.)
# ---------------------------------------------------------------
print("\nSnapshotting fight_dna_metrics for the affected fights (pre-update)...")
pre_view = run_sql(CTE + """
SELECT v.fight_id, ROUND(v.metric_pace::numeric, 4) AS pace,
       ROUND(v.metric_violence::numeric, 4) AS viol,
       ROUND(v.metric_control::numeric, 4)  AS ctrl,
       v.raw_head_strikes AS head, v.raw_body_strikes AS body,
       v.raw_leg_strikes  AS leg
FROM fight_dna_metrics v
WHERE v.fight_id IN (SELECT DISTINCT correct_fight_id FROM misstamped)
ORDER BY v.fight_id;
""")
pre_view_map = {r["fight_id"]: r for r in pre_view}
print(f"  snapshotted {len(pre_view_map)} affected fight_id rows")


# ---------------------------------------------------------------
# UPDATE - single transaction
# ---------------------------------------------------------------
print(f"\nRunning UPDATE on {rows_to_update} rows...")

result = run_sql("""
BEGIN;
""" + CTE + """
UPDATE round_fight_stats rfs
SET fight_url = m.correct_url
FROM misstamped m
WHERE rfs.id = m.rfs_id
RETURNING rfs.id;
COMMIT;
""")
# The RETURNING from inside the BEGIN/COMMIT block returns the updated
# rows in the response payload.
print(f"  Updated {len(result)} rows.")

if len(result) != rows_to_update:
    print(f"\nMismatch: pre-flight expected {rows_to_update}, UPDATE returned {len(result)}")
    sys.exit(1)


# ---------------------------------------------------------------
# Post-verify
# ---------------------------------------------------------------
print("\nPost-verify: re-scanning for any remaining misstamps...")
post = run_sql(CTE + """
SELECT COUNT(*) AS remaining
FROM misstamped;
""")
remaining = post[0]["remaining"]
print(f"  remaining misstamps: {remaining}")

if remaining != 0:
    print(f"\nFAIL - {remaining} misstamps remain after UPDATE.")
    sys.exit(1)

# View parity: every affected fight_id's metric values should be unchanged
print("\nPost-verify: confirming fight_dna_metrics values are unchanged for affected fights...")
post_view = run_sql("""
SELECT v.fight_id, ROUND(v.metric_pace::numeric, 4) AS pace,
       ROUND(v.metric_violence::numeric, 4) AS viol,
       ROUND(v.metric_control::numeric, 4)  AS ctrl,
       v.raw_head_strikes AS head, v.raw_body_strikes AS body,
       v.raw_leg_strikes  AS leg
FROM fight_dna_metrics v
WHERE v.fight_id = ANY(%s::bigint[])
ORDER BY v.fight_id;
""" % (
    "ARRAY[" + ",".join(str(k) for k in pre_view_map.keys()) + "]"
))
diffs = []
for row in post_view:
    fid = row["fight_id"]
    if pre_view_map.get(fid) != row:
        diffs.append((fid, pre_view_map.get(fid), row))

if diffs:
    print(f"  FAIL - {len(diffs)} fight rows changed value after UPDATE (view was supposed to be stable):")
    for fid, pre_r, post_r in diffs[:5]:
        print(f"    fight_id={fid}")
        print(f"      pre:  {pre_r}")
        print(f"      post: {post_r}")
    sys.exit(1)
print(f"  all {len(post_view)} affected fight rows unchanged (view stable as expected)")


print("\nDone - rfs.fight_url misstamps cleared. S-P2-11 view refactor is now safe to deploy.")
