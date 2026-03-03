"""
Diagnostic: find decision fights where judge_scores rows are missing or incomplete.
Three checks:
  1. Decision fights with ZERO judge_score rows for their event date
  2. Decision fights where the fighter name match fails (rows exist but 0 matched)
  3. Decision fights where row count is lower than expected (rounds * 2 fighters * 3 judges)
"""
import sys, re, requests
from pathlib import Path
from dotenv import load_dotenv
import os

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

load_dotenv(Path(__file__).parent / '.env')

PROJECT_REF = 'hyvyzuzlmnekzvtlauwi'
MGMT_KEY    = os.environ['SUPABASE_MANAGEMENT_KEY']
URL         = f'https://api.supabase.com/v1/projects/{PROJECT_REF}/database/query'
HEADERS     = {'Authorization': f'Bearer {MGMT_KEY}', 'Content-Type': 'application/json'}

def sql(query):
    r = requests.post(URL, headers=HEADERS, json={'query': query})
    r.raise_for_status()
    return r.json()

# ── 1. Which event dates have NO rows in judge_scores? ──────────────────────
# Uses ±1 day window to handle international events (Australia, Abu Dhabi, Fight Island)
# where judge_scores.date is +1 day vs ufc_events.event_date
print("\n=== CHECK 1: Event dates for decision fights with ZERO judge_scores rows ===")
rows = sql("""
SELECT
    ue.event_date,
    ue.event_name,
    COUNT(DISTINCT fmd.fight_url) AS decision_fights,
    COUNT(js.id) AS score_rows
FROM fight_meta_details fmd
JOIN ufc_events ue ON fmd.event_name = ue.event_name
LEFT JOIN judge_scores js
    ON js.date BETWEEN ue.event_date - INTERVAL '1 day' AND ue.event_date + INTERVAL '1 day'
WHERE fmd.method ILIKE '%decision%'
GROUP BY ue.event_date, ue.event_name
HAVING COUNT(js.id) = 0
ORDER BY ue.event_date DESC
LIMIT 30;
""")
if not rows:
    print("  None — all decision-fight dates have at least some judge_scores rows.")
else:
    print(f"  {'Date':<14} {'Decision Fights':<18} Event")
    for r in rows:
        print(f"  {r['event_date']:<14} {r['decision_fights']:<18} {r['event_name']}")

# ── 2. Per-fight: expected vs actual rows (by date join only, no name filter) ──
# Uses ±1 day window for international events
print("\n=== CHECK 2: Per-fight row count (date join, no name filter) ===")
rows = sql("""
SELECT
    ue.event_date,
    fmd.event_name,
    fmd.fighter1_name,
    fmd.fighter2_name,
    fmd.method,
    fmd.round  AS rounds_fought,
    CAST(SUBSTRING(fmd.round FROM 1 FOR 1) AS INTEGER) * 6 AS expected_rows,
    COUNT(js.id) AS total_rows_on_date
FROM fight_meta_details fmd
JOIN ufc_events ue ON fmd.event_name = ue.event_name
LEFT JOIN judge_scores js
    ON js.date BETWEEN ue.event_date - INTERVAL '1 day' AND ue.event_date + INTERVAL '1 day'
WHERE fmd.method ILIKE '%decision%'
  AND fmd.round ~ '^[0-9]'
GROUP BY ue.event_date, fmd.event_name, fmd.fighter1_name, fmd.fighter2_name, fmd.method, fmd.round
HAVING COUNT(js.id) < CAST(SUBSTRING(fmd.round FROM 1 FOR 1) AS INTEGER) * 6
ORDER BY ue.event_date DESC
LIMIT 40;
""")
if not rows:
    print("  All decision fights appear to have sufficient rows on their date.")
else:
    print(f"  {'Date':<14} {'Expected':<10} {'Got':<8} {'Method':<25} Fight")
    for r in rows:
        print(f"  {str(r['event_date']):<14} {r['expected_rows']:<10} {r['total_rows_on_date']:<8} {r['method']:<25} {r['fighter1_name']} vs {r['fighter2_name']}")

# ── 3. Distinct fighter names in judge_scores vs fight_meta_details ──────────
# Show cases where normName approach MIGHT fail
print("\n=== CHECK 3: Sample of judge_scores fighter names that may fail normName match ===")
rows = sql("""
SELECT DISTINCT js.fighter, js.event_name AS js_event
FROM judge_scores js
WHERE NOT EXISTS (
    SELECT 1 FROM fight_meta_details fmd
    WHERE (
        LOWER(REGEXP_REPLACE(js.fighter,    '[^a-z0-9 ]', '', 'gi')) =
        LOWER(REGEXP_REPLACE(fmd.fighter1_name, '[^a-z0-9 ]', '', 'gi'))
        OR
        LOWER(REGEXP_REPLACE(js.fighter,    '[^a-z0-9 ]', '', 'gi')) =
        LOWER(REGEXP_REPLACE(fmd.fighter2_name, '[^a-z0-9 ]', '', 'gi'))
    )
)
ORDER BY js.fighter
LIMIT 60;
""")
if not rows:
    print("  All judge_scores fighters match at least one fight_meta_details fighter (exact norm match).")
else:
    print(f"  {len(rows)} fighter names in judge_scores have no exact norm-match in fight_meta_details:")
    for r in rows:
        print(f"    judge_scores: \"{r['fighter']}\"  (event: {r['js_event']})")

# ── 4. Specific fights: row count filtered to matched fighters ───────────────
print("\n=== CHECK 4: Recent decision fights — matched row count vs expected ===")
rows = sql("""
SELECT
    ue.event_date,
    fmd.event_name,
    fmd.fighter1_name,
    fmd.fighter2_name,
    fmd.round AS rounds_fought,
    CAST(SUBSTRING(fmd.round FROM 1 FOR 1) AS INTEGER) * 6 AS expected,
    SUM(CASE WHEN
        LOWER(REGEXP_REPLACE(js.fighter, '[^a-z0-9 ]', '', 'gi')) IN (
            LOWER(REGEXP_REPLACE(fmd.fighter1_name, '[^a-z0-9 ]', '', 'gi')),
            LOWER(REGEXP_REPLACE(fmd.fighter2_name, '[^a-z0-9 ]', '', 'gi'))
        )
    THEN 1 ELSE 0 END) AS matched_rows
FROM fight_meta_details fmd
JOIN ufc_events ue ON fmd.event_name = ue.event_name
LEFT JOIN judge_scores js ON js.date = ue.event_date
WHERE fmd.method ILIKE '%decision%'
  AND fmd.round ~ '^[0-9]'
  AND ue.event_date >= '2024-01-01'
GROUP BY ue.event_date, fmd.event_name, fmd.fighter1_name, fmd.fighter2_name, fmd.round
HAVING SUM(CASE WHEN
        LOWER(REGEXP_REPLACE(js.fighter, '[^a-z0-9 ]', '', 'gi')) IN (
            LOWER(REGEXP_REPLACE(fmd.fighter1_name, '[^a-z0-9 ]', '', 'gi')),
            LOWER(REGEXP_REPLACE(fmd.fighter2_name, '[^a-z0-9 ]', '', 'gi'))
        )
    THEN 1 ELSE 0 END) < CAST(SUBSTRING(fmd.round FROM 1 FOR 1) AS INTEGER) * 6
ORDER BY ue.event_date DESC
LIMIT 50;
""")
if not rows:
    print("  All 2024+ decision fights have correct matched row counts.")
else:
    print(f"  {'Date':<14} {'Exp':<6} {'Got':<6} Fight")
    for r in rows:
        print(f"  {str(r['event_date']):<14} {r['expected']:<6} {r['matched_rows']:<6} {r['fighter1_name']} vs {r['fighter2_name']}  [{r['event_name']}]")
