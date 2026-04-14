"""
audit_leaderboard.py — Audit get_leaderboard() accuracy pipeline.

Run: python supabase/audit_leaderboard.py
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
project_ref = supabase_url.replace("https://", "").split(".")[0]
MGMT_QUERY_URL = f"https://api.supabase.com/v1/projects/{project_ref}/database/query"
HEADERS = {"Authorization": f"Bearer {mgmt_key}", "Content-Type": "application/json"}

def run(label, sql):
    r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": sql}, timeout=30)
    if not r.ok:
        print(f"\n❌ {label} failed {r.status_code}: {r.text}")
        return None
    rows = r.json()
    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}")
    if not rows:
        print("  (no rows)")
    else:
        # Print header
        keys = list(rows[0].keys())
        col_w = {k: max(len(k), max(len(str(row.get(k,''))) for row in rows)) for k in keys}
        header = "  " + "  ".join(k.ljust(col_w[k]) for k in keys)
        print(header)
        print("  " + "  ".join("-"*col_w[k] for k in keys))
        for row in rows:
            print("  " + "  ".join(str(row.get(k,'')).ljust(col_w[k]) for k in keys))
    return rows


# ── 1. Eligible scorecard overview ─────────────────────────────────────────
run("1. Eligible scorecards total + per-user counts", """
SELECT
  COUNT(*)                                        AS total_eligible_scorecards,
  COUNT(DISTINCT user_id)                         AS distinct_users,
  COUNT(DISTINCT fight_id)                        AS distinct_fights,
  SUM(CASE WHEN leaderboard_eligible THEN 1 END)  AS eligible_true,
  SUM(CASE WHEN NOT leaderboard_eligible THEN 1 END) AS eligible_false
FROM user_fight_scorecard_state;
""")

# ── 2. Users with ≥3 eligible fights (would appear on leaderboard) ─────────
run("2. Users with >=3 eligible fights", """
SELECT
  user_id,
  COUNT(*) AS eligible_fights
FROM user_fight_scorecard_state
WHERE leaderboard_eligible = TRUE
GROUP BY user_id
HAVING COUNT(*) >= 3
ORDER BY eligible_fights DESC;
""")

# ── 3. Winner mapping coverage: how many eligible fights resolve to f1/f2 ──
run("3. Winner mapping — NULL vs resolved (per eligible scorecard)", """
WITH eligible AS (
  SELECT ufss.user_id, ufss.fight_id, f.fight_url, f.winner
  FROM user_fight_scorecard_state ufss
  JOIN fights f ON f.id = ufss.fight_id
  WHERE ufss.leaderboard_eligible = TRUE
),
mapped AS (
  SELECT
    e.fight_id,
    e.fight_url,
    e.winner AS raw_winner,
    fmd.fighter1_name,
    fmd.fighter2_name,
    CASE
      WHEN fmd.fighter1_name IS NULL THEN 'no_fmd_row'
      WHEN LOWER(REGEXP_REPLACE(e.winner, '[^a-zA-Z0-9 ]', '', 'g'))
           = LOWER(REGEXP_REPLACE(fmd.fighter1_name, '[^a-zA-Z0-9 ]', '', 'g')) THEN 'f1_fullname'
      WHEN LOWER(REGEXP_REPLACE(e.winner, '[^a-zA-Z0-9 ]', '', 'g'))
           = LOWER(REGEXP_REPLACE(fmd.fighter2_name, '[^a-zA-Z0-9 ]', '', 'g')) THEN 'f2_fullname'
      WHEN LOWER(SPLIT_PART(e.winner, ' ', ARRAY_LENGTH(STRING_TO_ARRAY(e.winner, ' '), 1)))
           = LOWER(SPLIT_PART(fmd.fighter1_name, ' ', ARRAY_LENGTH(STRING_TO_ARRAY(fmd.fighter1_name, ' '), 1))) THEN 'f1_lastname'
      WHEN LOWER(SPLIT_PART(e.winner, ' ', ARRAY_LENGTH(STRING_TO_ARRAY(e.winner, ' '), 1)))
           = LOWER(SPLIT_PART(fmd.fighter2_name, ' ', ARRAY_LENGTH(STRING_TO_ARRAY(fmd.fighter2_name, ' '), 1))) THEN 'f2_lastname'
      ELSE 'unresolved'
    END AS match_result
  FROM eligible e
  LEFT JOIN fight_meta_details fmd ON fmd.fight_url = e.fight_url
  GROUP BY e.fight_id, e.fight_url, e.winner, fmd.fighter1_name, fmd.fighter2_name
)
SELECT match_result, COUNT(*) AS fights
FROM mapped
GROUP BY match_result
ORDER BY fights DESC;
""")

# ── 4. Unresolved fights (winner can't be mapped) ──────────────────────────
run("4. Unresolved fights — winner name doesn't match fmd", """
WITH eligible AS (
  SELECT DISTINCT ufss.fight_id, f.fight_url, f.winner
  FROM user_fight_scorecard_state ufss
  JOIN fights f ON f.id = ufss.fight_id
  WHERE ufss.leaderboard_eligible = TRUE
)
SELECT
  e.fight_id,
  e.fight_url,
  e.winner       AS raw_winner,
  fmd.fighter1_name,
  fmd.fighter2_name
FROM eligible e
LEFT JOIN fight_meta_details fmd ON fmd.fight_url = e.fight_url
WHERE fmd.fighter1_name IS NULL
   OR (
     LOWER(REGEXP_REPLACE(e.winner, '[^a-zA-Z0-9 ]', '', 'g'))
       NOT IN (
         LOWER(REGEXP_REPLACE(fmd.fighter1_name, '[^a-zA-Z0-9 ]', '', 'g')),
         LOWER(REGEXP_REPLACE(fmd.fighter2_name, '[^a-zA-Z0-9 ]', '', 'g'))
       )
     AND
     LOWER(SPLIT_PART(e.winner, ' ', ARRAY_LENGTH(STRING_TO_ARRAY(e.winner, ' '), 1)))
       NOT IN (
         LOWER(SPLIT_PART(fmd.fighter1_name, ' ', ARRAY_LENGTH(STRING_TO_ARRAY(fmd.fighter1_name, ' '), 1))),
         LOWER(SPLIT_PART(fmd.fighter2_name, ' ', ARRAY_LENGTH(STRING_TO_ARRAY(fmd.fighter2_name, ' '), 1)))
       )
   )
ORDER BY e.fight_id;
""")

# ── 5. Live leaderboard result ─────────────────────────────────────────────
run("5. Live leaderboard output", """
SELECT * FROM get_leaderboard();
""")

# ── 6. Per-user accuracy detail (spot-check, top 5 users) ─────────────────
run("6. Per-user per-fight breakdown (users with >=3 eligible)", """
WITH eligible AS (
  SELECT ufss.user_id, ufss.fight_id, f.fight_url, f.winner
  FROM user_fight_scorecard_state ufss
  JOIN fights f ON f.id = ufss.fight_id
  WHERE ufss.leaderboard_eligible = TRUE
),
round_totals AS (
  SELECT urs.user_id, urs.fight_id,
    SUM(urs.f1_score) AS f1_total,
    SUM(urs.f2_score) AS f2_total
  FROM user_round_scores urs
  JOIN eligible e ON e.fight_id = urs.fight_id AND e.user_id = urs.user_id
  GROUP BY urs.user_id, urs.fight_id
),
fight_results AS (
  SELECT
    rt.user_id,
    rt.fight_id,
    rt.f1_total,
    rt.f2_total,
    CASE WHEN rt.f1_total > rt.f2_total THEN 'f1'
         WHEN rt.f2_total > rt.f1_total THEN 'f2'
         ELSE 'draw' END AS user_pick,
    CASE
      WHEN fmd.fighter1_name IS NULL THEN NULL
      WHEN LOWER(REGEXP_REPLACE(e.winner,'[^a-zA-Z0-9 ]','','g'))
           = LOWER(REGEXP_REPLACE(fmd.fighter1_name,'[^a-zA-Z0-9 ]','','g')) THEN 'f1'
      WHEN LOWER(REGEXP_REPLACE(e.winner,'[^a-zA-Z0-9 ]','','g'))
           = LOWER(REGEXP_REPLACE(fmd.fighter2_name,'[^a-zA-Z0-9 ]','','g')) THEN 'f2'
      WHEN LOWER(SPLIT_PART(e.winner,' ',ARRAY_LENGTH(STRING_TO_ARRAY(e.winner,' '),1)))
           = LOWER(SPLIT_PART(fmd.fighter1_name,' ',ARRAY_LENGTH(STRING_TO_ARRAY(fmd.fighter1_name,' '),1))) THEN 'f1'
      WHEN LOWER(SPLIT_PART(e.winner,' ',ARRAY_LENGTH(STRING_TO_ARRAY(e.winner,' '),1)))
           = LOWER(SPLIT_PART(fmd.fighter2_name,' ',ARRAY_LENGTH(STRING_TO_ARRAY(fmd.fighter2_name,' '),1))) THEN 'f2'
      ELSE NULL END AS official_winner,
    e.winner AS raw_winner,
    fmd.fighter1_name,
    fmd.fighter2_name
  FROM round_totals rt
  JOIN eligible e ON e.fight_id = rt.fight_id AND e.user_id = rt.user_id
  LEFT JOIN fight_meta_details fmd ON fmd.fight_url = e.fight_url
  WHERE e.winner IS NOT NULL AND e.winner != ''
)
SELECT
  user_id,
  fight_id,
  f1_total,
  f2_total,
  user_pick,
  official_winner,
  CASE WHEN user_pick = official_winner THEN 'CORRECT' ELSE 'WRONG' END AS result,
  raw_winner,
  fighter1_name,
  fighter2_name
FROM fight_results
WHERE user_id IN (
  SELECT user_id FROM user_fight_scorecard_state
  WHERE leaderboard_eligible = TRUE
  GROUP BY user_id HAVING COUNT(*) >= 3
  LIMIT 5
)
ORDER BY user_id, fight_id;
""")

print("\n\nAudit complete.")
