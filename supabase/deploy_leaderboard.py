"""
deploy_leaderboard.py — Deploy get_leaderboard() RPC + add display_name to profiles.

Run once:
    python supabase/deploy_leaderboard.py
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

MIGRATION_SQL = """
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name text;
"""

RPC_SQL = """
CREATE OR REPLACE FUNCTION get_leaderboard()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  WITH eligible AS (
    -- All leaderboard-eligible scorecards with fight metadata
    SELECT
      ufss.user_id,
      ufss.fight_id,
      f.fight_url,
      f.winner
    FROM user_fight_scorecard_state ufss
    JOIN fights f ON f.id = ufss.fight_id
    WHERE ufss.leaderboard_eligible = TRUE
  ),
  round_totals AS (
    -- Sum each user's round scores per eligible fight
    SELECT
      urs.user_id,
      urs.fight_id,
      SUM(urs.f1_score) AS f1_total,
      SUM(urs.f2_score) AS f2_total
    FROM user_round_scores urs
    JOIN eligible e ON e.fight_id = urs.fight_id AND e.user_id = urs.user_id
    GROUP BY urs.user_id, urs.fight_id
  ),
  fight_results AS (
    -- Determine user's winner pick and the official winner per fight
    SELECT
      rt.user_id,
      rt.fight_id,
      -- User's winner pick based on total scorecard
      CASE
        WHEN rt.f1_total > rt.f2_total THEN 'f1'
        WHEN rt.f2_total > rt.f1_total THEN 'f2'
        ELSE 'draw'
      END AS user_pick,
      -- Official winner mapped to f1/f2 via fight_meta_details (full name, then last-name fallback)
      CASE
        WHEN fmd.fighter1_name IS NULL THEN NULL
        WHEN LOWER(REGEXP_REPLACE(e.winner, '[^a-zA-Z0-9 ]', '', 'g'))
             = LOWER(REGEXP_REPLACE(fmd.fighter1_name, '[^a-zA-Z0-9 ]', '', 'g'))
          THEN 'f1'
        WHEN LOWER(REGEXP_REPLACE(e.winner, '[^a-zA-Z0-9 ]', '', 'g'))
             = LOWER(REGEXP_REPLACE(fmd.fighter2_name, '[^a-zA-Z0-9 ]', '', 'g'))
          THEN 'f2'
        WHEN LOWER(SPLIT_PART(e.winner, ' ', ARRAY_LENGTH(STRING_TO_ARRAY(e.winner, ' '), 1)))
             = LOWER(SPLIT_PART(fmd.fighter1_name, ' ', ARRAY_LENGTH(STRING_TO_ARRAY(fmd.fighter1_name, ' '), 1)))
          THEN 'f1'
        WHEN LOWER(SPLIT_PART(e.winner, ' ', ARRAY_LENGTH(STRING_TO_ARRAY(e.winner, ' '), 1)))
             = LOWER(SPLIT_PART(fmd.fighter2_name, ' ', ARRAY_LENGTH(STRING_TO_ARRAY(fmd.fighter2_name, ' '), 1)))
          THEN 'f2'
        ELSE NULL
      END AS official_winner
    FROM round_totals rt
    JOIN eligible e ON e.fight_id = rt.fight_id AND e.user_id = rt.user_id
    LEFT JOIN fight_meta_details fmd ON fmd.fight_url = e.fight_url
    WHERE e.winner IS NOT NULL AND e.winner != ''
  ),
  user_stats AS (
    -- Aggregate accuracy per user (minimum 3 eligible fights to appear)
    SELECT
      user_id,
      COUNT(*)                    AS fights_scored,
      SUM(CASE WHEN user_pick = official_winner THEN 1 ELSE 0 END) AS correct_picks,
      ROUND(
        SUM(CASE WHEN user_pick = official_winner THEN 1.0 ELSE 0.0 END)
        / NULLIF(COUNT(*), 0) * 100,
        1
      ) AS accuracy_pct
    FROM fight_results
    WHERE official_winner IS NOT NULL
    GROUP BY user_id
    HAVING COUNT(*) >= 3
  ),
  ranked AS (
    SELECT
      us.*,
      p.display_name,
      RANK() OVER (ORDER BY us.accuracy_pct DESC, us.fights_scored DESC) AS rank
    FROM user_stats us
    LEFT JOIN profiles p ON p.user_id = us.user_id
  )
  SELECT json_agg(
    json_build_object(
      'user_id',      user_id,
      'display_name', display_name,
      'rank',         rank,
      'fights_scored', fights_scored,
      'correct_picks', correct_picks,
      'accuracy_pct', accuracy_pct
    ) ORDER BY rank
  )
  INTO result
  FROM ranked;

  RETURN COALESCE(result, '[]'::json);
END;
$$;

GRANT EXECUTE ON FUNCTION get_leaderboard() TO authenticated, anon;
"""

steps = [
    ("Add display_name column to profiles", MIGRATION_SQL),
    ("Create get_leaderboard() RPC", RPC_SQL),
]

for label, sql in steps:
    r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": sql}, timeout=30)
    if r.ok:
        print(f"✅ {label}")
    else:
        print(f"❌ {label} failed {r.status_code}: {r.text}")
        sys.exit(1)

print("\n🎉 Done! get_leaderboard() deployed.")
print("   display_name column added to profiles (nullable, set via profile UI).")
print("   Minimum 3 eligible fights required to appear on leaderboard.")
