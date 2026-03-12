"""
deploy_user_judge_comparison.py — Deploy get_user_judge_comparison(p_judge) RPC.

Run once:
    python supabase/deploy_user_judge_comparison.py
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

SQL = """
CREATE OR REPLACE FUNCTION get_user_judge_comparison(p_judge text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RETURN NULL; END IF;

  RETURN (
    WITH

    -- 1. All rounds the user has scored, with fight date + meta
    user_rounds AS (
      SELECT
        urs.fight_id,
        urs.round,
        urs.f1_score  AS user_f1,
        urs.f2_score  AS user_f2,
        f.fight_url,
        ue.event_date,
        fmd.fighter1_name,
        fmd.fighter2_name,
        COALESCE(fmd.weight_class_clean, fmd.weight_class) AS weight_class_clean
      FROM user_round_scores urs
      JOIN fights f ON f.id = urs.fight_id
      JOIN ufc_events ue ON ue.event_name = f.event_name
      LEFT JOIN fight_meta_details fmd ON fmd.fight_url = f.fight_url
      WHERE urs.user_id = v_user_id
        AND fmd.fighter1_name IS NOT NULL
        AND fmd.fighter2_name IS NOT NULL
    ),

    -- 2. Judge's scores for the same fights, matched by date ±1 day + last-name
    judge_rows AS (
      SELECT
        ur.fight_id,
        ur.round,
        ur.user_f1,
        ur.user_f2,
        ur.weight_class_clean,
        ur.fighter1_name,
        ur.fighter2_name,
        js.fighter AS js_fighter,
        js.score
      FROM user_rounds ur
      JOIN judge_scores js
        ON  js.date  BETWEEN ur.event_date - INTERVAL '1 day' AND ur.event_date + INTERVAL '1 day'
        AND js.round = ur.round
        AND js.judge = p_judge
        AND (
          lower(split_part(ur.fighter1_name, ' ', -1)) = lower(split_part(js.fighter, ' ', -1))
          OR lower(split_part(ur.fighter2_name, ' ', -1)) = lower(split_part(js.fighter, ' ', -1))
        )
    ),

    -- 3. Pivot to one row per (fight_id, round) with judge's f1/f2 scores
    judge_pivoted AS (
      SELECT
        fight_id,
        round,
        user_f1,
        user_f2,
        weight_class_clean,
        MAX(CASE WHEN lower(split_part(fighter1_name, ' ', -1)) = lower(split_part(js_fighter, ' ', -1)) THEN score END) AS judge_f1,
        MAX(CASE WHEN lower(split_part(fighter2_name, ' ', -1)) = lower(split_part(js_fighter, ' ', -1)) THEN score END) AS judge_f2
      FROM judge_rows
      GROUP BY fight_id, round, user_f1, user_f2, weight_class_clean, fighter1_name, fighter2_name
    ),

    -- 4. Shared rounds with both sides' winners (exclude 10-10 draws from either)
    shared AS (
      SELECT
        fight_id,
        round,
        weight_class_clean,
        CASE WHEN user_f1 > user_f2 THEN 'f1' WHEN user_f2 > user_f1 THEN 'f2' ELSE 'draw' END AS user_winner,
        CASE WHEN judge_f1 > judge_f2 THEN 'f1' WHEN judge_f2 > judge_f1 THEN 'f2' ELSE 'draw' END AS judge_winner
      FROM judge_pivoted
      WHERE judge_f1 IS NOT NULL AND judge_f2 IS NOT NULL
    ),

    -- 5. Scoreable rounds (no draws from either side)
    scoreable AS (
      SELECT * FROM shared
      WHERE user_winner != 'draw' AND judge_winner != 'draw'
    ),

    -- 6. Per-fight disagreement tallies
    fight_disagreements AS (
      SELECT
        fight_id,
        COUNT(*) FILTER (WHERE user_winner != judge_winner) AS disagreement_rounds,
        COUNT(*) AS scored_rounds
      FROM scoreable
      GROUP BY fight_id
      HAVING COUNT(*) FILTER (WHERE user_winner != judge_winner) > 0
    ),

    -- 7. Agreement rate by weight class (min 3 rounds)
    by_class_agg AS (
      SELECT
        weight_class_clean,
        COUNT(*) AS rounds,
        ROUND(AVG(CASE WHEN user_winner = judge_winner THEN 1.0 ELSE 0.0 END)::numeric, 3) AS agreement_pct
      FROM scoreable
      WHERE weight_class_clean IS NOT NULL
      GROUP BY weight_class_clean
      HAVING COUNT(*) >= 3
    )

    SELECT json_build_object(

      'shared_rounds',     (SELECT COUNT(*) FROM scoreable),
      'shared_fights',     (SELECT COUNT(DISTINCT fight_id) FROM scoreable),

      'agreement_rate',    (
        SELECT ROUND(AVG(CASE WHEN user_winner = judge_winner THEN 1.0 ELSE 0.0 END)::numeric, 3)
        FROM scoreable
      ),

      'by_class',          (
        SELECT json_agg(t ORDER BY t.rounds DESC)
        FROM (SELECT * FROM by_class_agg) t
      ),

      'top_disagreements', (
        SELECT json_agg(t ORDER BY t.disagreement_rounds DESC)
        FROM (
          SELECT
            fd.fight_id,
            fmd.bout,
            f.fight_url,
            ue.event_date AS fight_date,
            fd.disagreement_rounds,
            fd.scored_rounds
          FROM fight_disagreements fd
          JOIN fights f ON f.id = fd.fight_id
          JOIN ufc_events ue ON ue.event_name = f.event_name
          LEFT JOIN fight_meta_details fmd ON fmd.fight_url = f.fight_url
          ORDER BY fd.disagreement_rounds DESC
          LIMIT 5
        ) t
      )

    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_judge_comparison(text) TO authenticated;
"""

resp = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": SQL}, timeout=30)
if resp.ok:
    print("✅ get_user_judge_comparison deployed successfully")
else:
    print(f"❌ Error {resp.status_code}: {resp.text}")
