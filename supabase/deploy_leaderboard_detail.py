"""
deploy_leaderboard_detail.py — Deploy get_leaderboard_user_detail(p_user_id uuid) RPC.

Returns last 5 eligible decision fights (with correct/incorrect) and last 5 eligible
rounds (with judge majority match) for a given user. Used by the leaderboard row expand.

Run once:
    python supabase/deploy_leaderboard_detail.py
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

RPC_SQL = """
CREATE OR REPLACE FUNCTION get_leaderboard_user_detail(p_user_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result json;
BEGIN
  WITH

  -- All leaderboard-eligible scorecards for this user with fight metadata
  eligible AS (
    SELECT
      ufss.fight_id,
      f.fight_url,
      f.winner       AS raw_winner,
      f.event_name,
      ue.event_date,
      fmd.fighter1_name,
      fmd.fighter2_name,
      fmd.method
    FROM user_fight_scorecard_state ufss
    JOIN fights f ON f.id = ufss.fight_id
    JOIN ufc_events ue ON ue.event_name = f.event_name
    LEFT JOIN fight_meta_details fmd ON fmd.fight_url = f.fight_url
    WHERE ufss.user_id = p_user_id
      AND ufss.leaderboard_eligible = TRUE
  ),

  -- ── RECENT FIGHTS (decisions only) ─────────────────────────────────────

  -- Sum each user's round scores per eligible decision fight
  round_totals AS (
    SELECT
      urs.fight_id,
      SUM(urs.f1_score) AS f1_total,
      SUM(urs.f2_score) AS f2_total
    FROM user_round_scores urs
    JOIN eligible e ON e.fight_id = urs.fight_id
    WHERE urs.user_id = p_user_id
      AND e.method ILIKE 'Decision%%'
    GROUP BY urs.fight_id
  ),

  -- Map user scorecard pick to official winner
  fight_results AS (
    SELECT
      rt.fight_id,
      e.fight_url,
      e.event_name,
      e.event_date,
      e.fighter1_name,
      e.fighter2_name,
      CASE
        WHEN rt.f1_total > rt.f2_total THEN 'f1'
        WHEN rt.f2_total > rt.f1_total THEN 'f2'
        ELSE 'draw'
      END AS user_pick,
      CASE
        WHEN e.fighter1_name IS NULL THEN NULL
        WHEN LOWER(REGEXP_REPLACE(e.raw_winner, '[^a-zA-Z0-9 ]', '', 'g'))
             = LOWER(REGEXP_REPLACE(e.fighter1_name, '[^a-zA-Z0-9 ]', '', 'g')) THEN 'f1'
        WHEN LOWER(REGEXP_REPLACE(e.raw_winner, '[^a-zA-Z0-9 ]', '', 'g'))
             = LOWER(REGEXP_REPLACE(e.fighter2_name, '[^a-zA-Z0-9 ]', '', 'g')) THEN 'f2'
        WHEN LOWER(SPLIT_PART(e.raw_winner, ' ', ARRAY_LENGTH(STRING_TO_ARRAY(e.raw_winner, ' '), 1)))
             = LOWER(SPLIT_PART(e.fighter1_name, ' ', ARRAY_LENGTH(STRING_TO_ARRAY(e.fighter1_name, ' '), 1))) THEN 'f1'
        WHEN LOWER(SPLIT_PART(e.raw_winner, ' ', ARRAY_LENGTH(STRING_TO_ARRAY(e.raw_winner, ' '), 1)))
             = LOWER(SPLIT_PART(e.fighter2_name, ' ', ARRAY_LENGTH(STRING_TO_ARRAY(e.fighter2_name, ' '), 1))) THEN 'f2'
        ELSE NULL
      END AS official_winner
    FROM round_totals rt
    JOIN eligible e ON e.fight_id = rt.fight_id
    WHERE e.raw_winner IS NOT NULL AND e.raw_winner != ''
  ),

  recent_fights AS (
    SELECT
      fight_id,
      fight_url,
      event_name,
      event_date,
      fighter1_name,
      fighter2_name,
      user_pick,
      official_winner,
      (user_pick = official_winner AND official_winner IS NOT NULL) AS correct
    FROM fight_results
    ORDER BY event_date DESC, fight_id DESC
    LIMIT 5
  ),

  -- ── RECENT ROUNDS (agreement with judge majority) ───────────────────────

  -- Matching judge_scores rows for each user-scored round
  judge_rows AS (
    SELECT
      urs.fight_id,
      urs.round,
      urs.f1_score  AS user_f1,
      urs.f2_score  AS user_f2,
      e.fight_url,
      e.event_name,
      e.event_date,
      e.fighter1_name,
      e.fighter2_name,
      js.judge,
      js.fighter    AS js_fighter,
      js.score
    FROM user_round_scores urs
    JOIN eligible e ON e.fight_id = urs.fight_id
    JOIN judge_scores js
      ON  js.date  BETWEEN e.event_date - INTERVAL '1 day' AND e.event_date + INTERVAL '1 day'
      AND js.round = urs.round
      AND (
            lower(split_part(e.fighter1_name, ' ', -1)) = lower(split_part(js.fighter, ' ', -1))
         OR lower(split_part(e.fighter2_name, ' ', -1)) = lower(split_part(js.fighter, ' ', -1))
      )
    WHERE urs.user_id = p_user_id
      AND e.fighter1_name IS NOT NULL
      AND e.fighter2_name IS NOT NULL
  ),

  -- Pivot to one row per (fight_id, round, judge) with f1/f2 scores
  round_pivoted AS (
    SELECT
      fight_id,
      round,
      user_f1,
      user_f2,
      fight_url,
      event_name,
      event_date,
      fighter1_name,
      fighter2_name,
      judge,
      MAX(CASE WHEN lower(split_part(fighter1_name, ' ', -1)) = lower(split_part(js_fighter, ' ', -1)) THEN score END) AS judge_f1,
      MAX(CASE WHEN lower(split_part(fighter2_name, ' ', -1)) = lower(split_part(js_fighter, ' ', -1)) THEN score END) AS judge_f2
    FROM judge_rows
    GROUP BY fight_id, round, user_f1, user_f2, fight_url, event_name, event_date, fighter1_name, fighter2_name, judge
  ),

  -- Only complete judge pairs (both fighters scored)
  round_complete AS (
    SELECT * FROM round_pivoted
    WHERE judge_f1 IS NOT NULL AND judge_f2 IS NOT NULL
  ),

  -- Window: how many judges gave each fighter the round
  round_majority AS (
    SELECT
      fight_id,
      round,
      user_f1,
      user_f2,
      fight_url,
      event_name,
      event_date,
      fighter1_name,
      fighter2_name,
      SUM(CASE WHEN judge_f1 > judge_f2 THEN 1 ELSE 0 END) OVER w AS f1_votes,
      SUM(CASE WHEN judge_f2 > judge_f1 THEN 1 ELSE 0 END) OVER w AS f2_votes,
      COUNT(*) OVER w AS judge_count
    FROM round_complete
    WINDOW w AS (PARTITION BY fight_id, round)
  ),

  -- Collapse to one row per (fight_id, round)
  round_collapsed AS (
    SELECT DISTINCT ON (fight_id, round)
      fight_id,
      round,
      fight_url,
      event_name,
      event_date,
      fighter1_name,
      fighter2_name,
      CASE WHEN user_f1 > user_f2 THEN 'f1' WHEN user_f2 > user_f1 THEN 'f2' ELSE 'draw' END AS user_winner,
      CASE WHEN f1_votes >= 2 THEN 'f1' WHEN f2_votes >= 2 THEN 'f2' ELSE NULL END AS majority_winner
    FROM round_majority
    WHERE judge_count >= 2
    ORDER BY fight_id, round
  ),

  recent_rounds AS (
    SELECT
      fight_id,
      round,
      fight_url,
      event_name,
      event_date,
      fighter1_name,
      fighter2_name,
      user_winner,
      majority_winner,
      (user_winner = majority_winner AND majority_winner IS NOT NULL) AS matched
    FROM round_collapsed
    WHERE majority_winner IS NOT NULL
    ORDER BY event_date DESC, fight_id DESC, round DESC
    LIMIT 5
  )

  SELECT json_build_object(
    'fights', COALESCE(
      (SELECT json_agg(row_to_json(rf) ORDER BY rf.event_date DESC, rf.fight_id DESC)
       FROM recent_fights rf),
      '[]'::json
    ),
    'rounds', COALESCE(
      (SELECT json_agg(row_to_json(rr) ORDER BY rr.event_date DESC, rr.fight_id DESC, rr.round DESC)
       FROM recent_rounds rr),
      '[]'::json
    )
  )
  INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION get_leaderboard_user_detail(uuid) TO authenticated, anon;
"""

steps = [
    ("Deploy get_leaderboard_user_detail() RPC", RPC_SQL),
]

for label, sql in steps:
    r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": sql}, timeout=30)
    if r.ok:
        print(f"✅ {label}")
    else:
        print(f"❌ {label} failed {r.status_code}: {r.text}")
        sys.exit(1)

print("\n🎉 Done! get_leaderboard_user_detail() deployed.")
print("   Returns last 5 eligible fights + last 5 eligible rounds for a user.")
