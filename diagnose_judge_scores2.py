"""
Checks 3 & 4 — simplified to avoid Management API timeout.
"""
import sys, requests
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

# ── Which event dates DO have judge_scores rows? ─────────────────────────────
print("\n=== Dates WITH judge_scores data ===")
rows = sql("""
SELECT date, COUNT(DISTINCT fighter) as fighters, COUNT(*) as rows
FROM judge_scores
GROUP BY date
ORDER BY date DESC
LIMIT 20;
""")
print(f"  {'Date':<14} {'Fighters':<12} Rows")
for r in rows:
    print(f"  {str(r['date']):<14} {r['fighters']:<12} {r['rows']}")

# ── Check 3 simplified: fighter names in judge_scores that don't match ────────
# Uses ±1 day date window to handle international events (Australia, Singapore, Abu Dhabi)
print("\n=== CHECK 3 (simplified): judge_scores fighters vs fight_meta_details ===")
rows = sql("""
SELECT DISTINCT js.date, js.fighter
FROM judge_scores js
WHERE NOT EXISTS (
    SELECT 1 FROM fight_meta_details fmd
    JOIN ufc_events ue ON fmd.event_name = ue.event_name
    WHERE js.date BETWEEN ue.event_date - INTERVAL '1 day' AND ue.event_date + INTERVAL '1 day'
      AND (
        LOWER(REGEXP_REPLACE(js.fighter, '[^a-z0-9 ]', '', 'gi'))
            = LOWER(REGEXP_REPLACE(fmd.fighter1_name, '[^a-z0-9 ]', '', 'gi'))
        OR
        LOWER(REGEXP_REPLACE(js.fighter, '[^a-z0-9 ]', '', 'gi'))
            = LOWER(REGEXP_REPLACE(fmd.fighter2_name, '[^a-z0-9 ]', '', 'gi'))
      )
)
ORDER BY js.date DESC, js.fighter
LIMIT 50;
""")
if not rows:
    print("  All judge_scores fighters have an exact norm-match in fight_meta_details.")
else:
    print(f"  {len(rows)} unmatched fighters found:")
    for r in rows:
        print(f"    {str(r['date']):<14} \"{r['fighter']}\"")

# ── Check 4: 2024+ decision fights — matched row count vs expected ────────────
# Uses ±1 day date window to handle international events
print("\n=== CHECK 4: 2024+ decision fights — matched row count vs expected ===")
rows = sql("""
SELECT
    ue.event_date,
    fmd.event_name,
    fmd.fighter1_name,
    fmd.fighter2_name,
    fmd.round AS rounds_fought,
    CAST(SUBSTRING(fmd.round FROM 1 FOR 1) AS INTEGER) * 6 AS expected,
    COALESCE(js_counts.matched, 0) AS matched_rows
FROM fight_meta_details fmd
JOIN ufc_events ue ON fmd.event_name = ue.event_name
LEFT JOIN (
    SELECT ue2.event_date AS ufc_date,
           fmd2.fight_url,
           COUNT(*) AS matched
    FROM judge_scores js
    JOIN fight_meta_details fmd2 ON fmd2.fight_url IS NOT NULL
    JOIN ufc_events ue2 ON fmd2.event_name = ue2.event_name
    WHERE js.date BETWEEN ue2.event_date - INTERVAL '1 day' AND ue2.event_date + INTERVAL '1 day'
      AND (
        LOWER(REGEXP_REPLACE(js.fighter, '[^a-z0-9 ]', '', 'gi'))
            = LOWER(REGEXP_REPLACE(fmd2.fighter1_name, '[^a-z0-9 ]', '', 'gi'))
        OR
        LOWER(REGEXP_REPLACE(js.fighter, '[^a-z0-9 ]', '', 'gi'))
            = LOWER(REGEXP_REPLACE(fmd2.fighter2_name, '[^a-z0-9 ]', '', 'gi'))
      )
    GROUP BY ue2.event_date, fmd2.fight_url
) js_counts ON js_counts.ufc_date = ue.event_date AND js_counts.fight_url = fmd.fight_url
WHERE fmd.method ILIKE '%%decision%%'
  AND fmd.round ~ '^[0-9]'
  AND ue.event_date >= '2024-01-01'
  AND COALESCE(js_counts.matched, 0) < CAST(SUBSTRING(fmd.round FROM 1 FOR 1) AS INTEGER) * 6
ORDER BY ue.event_date DESC
LIMIT 40;
""")
if not rows:
    print("  All 2024+ decision fights have correct matched row counts.")
else:
    print(f"  {'Date':<14} {'Exp':<6} {'Got':<6} Fight")
    for r in rows:
        print(f"  {str(r['event_date']):<14} {r['expected']:<6} {r['matched_rows']:<6} {r['fighter1_name']} vs {r['fighter2_name']}  [{r['event_name']}]")
