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
  WITH

  -- 1. All leaderboard-eligible scorecards with full fight metadata
  eligible AS (
    SELECT
      ufss.user_id,
      ufss.fight_id,
      f.fight_url,
      f.winner       AS raw_winner,
      ue.event_date,
      fmd.fighter1_name,
      fmd.fighter2_name,
      fmd.method
    FROM user_fight_scorecard_state ufss
    JOIN fights f ON f.id = ufss.fight_id
    JOIN ufc_events ue ON ue.event_name = f.event_name
    LEFT JOIN fight_meta_details fmd ON fmd.fight_url = f.fight_url
    WHERE ufss.leaderboard_eligible = TRUE
  ),

  -- ── FIGHT ACCURACY (decisions only) ────────────────────────────────────

  -- 2. Sum each user's round scores per eligible decision fight
  round_totals AS (
    SELECT
      urs.user_id,
      urs.fight_id,
      SUM(urs.f1_score) AS f1_total,
      SUM(urs.f2_score) AS f2_total
    FROM user_round_scores urs
    JOIN eligible e ON e.fight_id = urs.fight_id AND e.user_id = urs.user_id
    WHERE e.method ILIKE 'Decision%%'
    GROUP BY urs.user_id, urs.fight_id
  ),

  -- 3. Map user's scorecard pick to official winner (full name then last-name fallback)
  fight_results AS (
    SELECT
      rt.user_id,
      rt.fight_id,
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
    JOIN eligible e ON e.fight_id = rt.fight_id AND e.user_id = rt.user_id
    WHERE e.raw_winner IS NOT NULL AND e.raw_winner != ''
  ),

  -- 4. Per-user fight accuracy (min 3 eligible decision fights to appear)
  user_fight_stats AS (
    SELECT
      user_id,
      COUNT(*)                    AS fights_scored,
      SUM(CASE WHEN user_pick = official_winner THEN 1 ELSE 0 END) AS correct_picks,
      ROUND(
        SUM(CASE WHEN user_pick = official_winner THEN 1.0 ELSE 0.0 END)
        / NULLIF(COUNT(*), 0) * 100,
        1
      ) AS fight_acc_pct
    FROM fight_results
    WHERE official_winner IS NOT NULL
    GROUP BY user_id
    HAVING COUNT(*) >= 3
  ),

  -- ── ROUND ACCURACY (agreement with judge majority) ──────────────────────

  -- 5. Per eligible round: all matching judge_scores rows (±1 day, last-name match)
  judge_rows AS (
    SELECT
      e.user_id,
      urs.fight_id,
      urs.round,
      urs.f1_score  AS user_f1,
      urs.f2_score  AS user_f2,
      e.fighter1_name,
      e.fighter2_name,
      js.judge,
      js.fighter    AS js_fighter,
      js.score
    FROM user_round_scores urs
    JOIN eligible e ON e.fight_id = urs.fight_id AND e.user_id = urs.user_id
    JOIN judge_scores js
      ON  js.date  BETWEEN e.event_date - INTERVAL '1 day' AND e.event_date + INTERVAL '1 day'
      AND js.round = urs.round
      AND (
            lower(split_part(e.fighter1_name, ' ', -1)) = lower(split_part(js.fighter, ' ', -1))
         OR lower(split_part(e.fighter2_name, ' ', -1)) = lower(split_part(js.fighter, ' ', -1))
      )
    WHERE e.fighter1_name IS NOT NULL
      AND e.fighter2_name IS NOT NULL
  ),

  -- 6. Pivot to one row per (user_id, fight_id, round, judge) with f1/f2 scores
  round_pivoted AS (
    SELECT
      user_id,
      fight_id,
      round,
      user_f1,
      user_f2,
      judge,
      MAX(CASE WHEN lower(split_part(fighter1_name, ' ', -1)) = lower(split_part(js_fighter, ' ', -1)) THEN score END) AS judge_f1,
      MAX(CASE WHEN lower(split_part(fighter2_name, ' ', -1)) = lower(split_part(js_fighter, ' ', -1)) THEN score END) AS judge_f2
    FROM judge_rows
    GROUP BY user_id, fight_id, round, user_f1, user_f2, judge, fighter1_name, fighter2_name
  ),

  -- 7. Only complete judge pairs (both fighters scored)
  round_complete AS (
    SELECT * FROM round_pivoted
    WHERE judge_f1 IS NOT NULL AND judge_f2 IS NOT NULL
  ),

  -- 8. Window: how many judges gave each fighter the round
  round_majority AS (
    SELECT
      user_id,
      fight_id,
      round,
      user_f1,
      user_f2,
      SUM(CASE WHEN judge_f1 > judge_f2 THEN 1 ELSE 0 END) OVER w AS f1_votes,
      SUM(CASE WHEN judge_f2 > judge_f1 THEN 1 ELSE 0 END) OVER w AS f2_votes,
      COUNT(*) OVER w AS judge_count
    FROM round_complete
    WINDOW w AS (PARTITION BY user_id, fight_id, round)
  ),

  -- 9. Collapse to one row per (user_id, fight_id, round)
  round_collapsed AS (
    SELECT DISTINCT ON (user_id, fight_id, round)
      user_id,
      fight_id,
      round,
      CASE WHEN user_f1 > user_f2 THEN 'f1' WHEN user_f2 > user_f1 THEN 'f2' ELSE 'draw' END AS user_winner,
      CASE WHEN f1_votes >= 2 THEN 'f1' WHEN f2_votes >= 2 THEN 'f2' ELSE NULL END AS majority_winner,
      judge_count
    FROM round_majority
    WHERE judge_count >= 2
    ORDER BY user_id, fight_id, round
  ),

  -- 10. Per-user round accuracy aggregate
  user_round_stats AS (
    SELECT
      user_id,
      COUNT(*) AS rounds_matched,
      ROUND(
        AVG(CASE WHEN user_winner = majority_winner THEN 1.0 ELSE 0.0 END)::numeric * 100,
        1
      ) AS round_acc_pct
    FROM round_collapsed
    WHERE majority_winner IS NOT NULL
    GROUP BY user_id
  ),

  -- ── RANK ────────────────────────────────────────────────────────────────

  ranked AS (
    SELECT
      ufs.*,
      p.display_name,
      COALESCE(urs.rounds_matched, 0) AS rounds_matched,
      urs.round_acc_pct,
      RANK() OVER (ORDER BY ufs.fight_acc_pct DESC, ufs.fights_scored DESC) AS rank
    FROM user_fight_stats ufs
    LEFT JOIN user_round_stats urs ON urs.user_id = ufs.user_id
    LEFT JOIN profiles p ON p.user_id = ufs.user_id
  )

  SELECT json_agg(
    json_build_object(
      'user_id',        user_id,
      'display_name',   display_name,
      'rank',           rank,
      'fights_scored',  fights_scored,
      'correct_picks',  correct_picks,
      'fight_acc_pct',  fight_acc_pct,
      'rounds_matched', rounds_matched,
      'round_acc_pct',  round_acc_pct
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
    ("Add display_name column to profiles (idempotent)", MIGRATION_SQL),
    ("Deploy get_leaderboard() v2 — decisions filter + round accuracy", RPC_SQL),
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
