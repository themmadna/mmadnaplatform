"""
deploy_judging_profile.py — Deploy get_user_judging_profile RPC to Supabase.

Run once:
    python supabase/deploy_judging_profile.py
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
CREATE OR REPLACE FUNCTION get_user_judging_profile()
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
        fmd.weight_class,
        fmd.method
      FROM user_round_scores urs
      JOIN fights f ON f.id = urs.fight_id
      JOIN ufc_events ue ON ue.event_name = f.event_name
      LEFT JOIN fight_meta_details fmd ON fmd.fight_url = f.fight_url
      WHERE urs.user_id = v_user_id
        AND fmd.fighter1_name IS NOT NULL
        AND fmd.fighter2_name IS NOT NULL
    ),

    -- 2. Fetch all judge_scores rows (one row per fighter per judge per round)
    --    that fall within ±1 day of the fight date and match this round.
    --    judge_scores schema: id, bout, date, judge, fighter, round, score, referee
    judge_rows AS (
      SELECT
        ur.fight_id,
        ur.round,
        ur.user_f1,
        ur.user_f2,
        ur.weight_class,
        ur.fighter1_name,
        ur.fighter2_name,
        js.judge,
        js.fighter  AS js_fighter,
        js.score
      FROM user_rounds ur
      JOIN judge_scores js
        ON  js.date  BETWEEN ur.event_date - INTERVAL '1 day' AND ur.event_date + INTERVAL '1 day'
        AND js.round = ur.round
        -- Row must belong to one of the two fighters in this fight (last-name match)
        AND (
          lower(split_part(ur.fighter1_name, ' ', -1)) = lower(split_part(js.fighter, ' ', -1))
          OR lower(split_part(ur.fighter2_name, ' ', -1)) = lower(split_part(js.fighter, ' ', -1))
        )
    ),

    -- 3. Pivot: for each (fight_id, round, judge) produce one row with
    --    judge_f1_score and judge_f2_score using a conditional aggregate.
    --    Only rows where BOTH scores are found are kept (complete judge pairs).
    pivoted AS (
      SELECT
        fight_id,
        round,
        user_f1,
        user_f2,
        weight_class,
        judge,
        MAX(CASE
          WHEN lower(split_part(fighter1_name, ' ', -1)) = lower(split_part(js_fighter, ' ', -1))
          THEN score END) AS judge_f1_score,
        MAX(CASE
          WHEN lower(split_part(fighter2_name, ' ', -1)) = lower(split_part(js_fighter, ' ', -1))
          THEN score END) AS judge_f2_score
      FROM judge_rows
      GROUP BY fight_id, round, user_f1, user_f2, weight_class, judge, fighter1_name, fighter2_name
    ),

    complete_judges AS (
      SELECT * FROM pivoted
      WHERE judge_f1_score IS NOT NULL AND judge_f2_score IS NOT NULL
    ),

    -- 4. Per (fight, round): majority vote across judges
    majority AS (
      SELECT
        fight_id,
        round,
        user_f1,
        user_f2,
        weight_class,
        judge,
        judge_f1_score,
        judge_f2_score,
        SUM(CASE WHEN judge_f1_score > judge_f2_score THEN 1 ELSE 0 END) OVER w AS f1_wins,
        SUM(CASE WHEN judge_f2_score > judge_f1_score THEN 1 ELSE 0 END) OVER w AS f2_wins,
        COUNT(*) OVER w AS judge_count
      FROM complete_judges
      WINDOW w AS (PARTITION BY fight_id, round)
    ),

    -- 5. Collapse to one row per fight/round
    round_accuracy AS (
      SELECT DISTINCT ON (fight_id, round)
        fight_id,
        round,
        weight_class,
        CASE WHEN user_f1 > user_f2 THEN 'f1' WHEN user_f2 > user_f1 THEN 'f2' ELSE 'draw' END AS user_winner,
        CASE WHEN f1_wins >= 2 THEN 'f1' WHEN f2_wins >= 2 THEN 'f2' ELSE NULL END AS majority_winner,
        LEAST(user_f1, user_f2) AS user_loser_score
      FROM majority
      WHERE judge_count >= 2
      ORDER BY fight_id, round
    ),

    -- 6. Judge-level agreement with user (min 5 shared rounds)
    judge_agreement AS (
      SELECT
        judge,
        COUNT(*) AS rounds,
        SUM(CASE
          WHEN (judge_f1_score > judge_f2_score AND user_f1 > user_f2)
            OR (judge_f2_score > judge_f1_score AND user_f2 > user_f1)
          THEN 1 ELSE 0
        END) AS agreed
      FROM complete_judges
      GROUP BY judge
      HAVING COUNT(*) >= 5
    )

    SELECT json_build_object(
      'fights_scored',   (SELECT COUNT(DISTINCT fight_id) FROM user_rounds),
      'rounds_scored',   (SELECT COUNT(*) FROM user_rounds),
      'rounds_matched',  (SELECT COUNT(*) FROM round_accuracy WHERE majority_winner IS NOT NULL),
      'accuracy',        (
        SELECT ROUND(AVG(CASE WHEN user_winner = majority_winner THEN 1.0 ELSE 0.0 END)::numeric, 3)
        FROM round_accuracy WHERE majority_winner IS NOT NULL
      ),
      'ten_eight_rate',  (
        SELECT ROUND(AVG(CASE WHEN user_loser_score <= 8 THEN 1.0 ELSE 0.0 END)::numeric, 3)
        FROM round_accuracy WHERE majority_winner IS NOT NULL
      ),
      'accuracy_by_class', (
        SELECT json_agg(t ORDER BY t.rounds DESC)
        FROM (
          SELECT
            weight_class,
            ROUND(AVG(CASE WHEN user_winner = majority_winner THEN 1.0 ELSE 0.0 END)::numeric, 3) AS accuracy,
            COUNT(*) AS rounds
          FROM round_accuracy
          WHERE majority_winner IS NOT NULL AND weight_class IS NOT NULL
          GROUP BY weight_class
          HAVING COUNT(*) >= 3
        ) t
      ),
      'judges', (
        SELECT json_agg(json_build_object(
          'name',           judge,
          'agreement_pct',  ROUND(agreed::numeric / rounds, 3),
          'rounds',         rounds
        ) ORDER BY agreed::numeric / rounds DESC)
        FROM judge_agreement
      )
    )
  );
END;
$$;
"""

resp = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": SQL}, timeout=20)
if resp.ok:
    print("✅ get_user_judging_profile deployed successfully")
else:
    print(f"❌ Error {resp.status_code}: {resp.text}")
