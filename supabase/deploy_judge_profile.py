"""
deploy_judge_profile.py — Deploy get_judge_profile(p_judge) RPC to Supabase.

Run once:
    python supabase/deploy_judge_profile.py
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
-- Drop old overloads so the new single-arg version becomes the only one.
DROP FUNCTION IF EXISTS get_judge_profile(text, text);
DROP FUNCTION IF EXISTS get_judge_profile(text);

CREATE OR REPLACE FUNCTION get_judge_profile(p_judge text)
RETURNS json
LANGUAGE plpgsql
STABLE
SET statement_timeout = '8s'
AS $$
BEGIN
  RETURN (
    WITH

    -- 1. All rows this judge scored.
    js_judge AS (
      SELECT bout, date, round, fighter, score
      FROM judge_scores
      WHERE judge = p_judge
    ),

    -- 2. Distinct (bout, date) pairs this judge worked.
    judge_bouts AS (
      SELECT DISTINCT bout, date FROM js_judge
    ),

    -- 3. All judges' scores on those same bouts (for majority calculation).
    js_all AS (
      SELECT js.bout, js.date, js.round, js.judge, js.fighter, js.score
      FROM judge_scores js
      JOIN judge_bouts jb ON jb.bout = js.bout AND jb.date = js.date
    ),

    -- 4. Pivot this judge's scores: (bout, date, round) → f1_score / f2_score.
    judge_pivoted AS (
      SELECT
        bout, date, round,
        MAX(CASE
          WHEN LOWER(TRIM(fighter)) = LOWER(TRIM(SPLIT_PART(bout, ' vs ', 1)))
          THEN score END) AS f1_score,
        MAX(CASE
          WHEN LOWER(TRIM(fighter)) = LOWER(TRIM(SPLIT_PART(bout, ' vs ', 2)))
          THEN score END) AS f2_score
      FROM js_judge
      GROUP BY bout, date, round
    ),

    complete_judge AS (
      SELECT * FROM judge_pivoted
      WHERE f1_score IS NOT NULL AND f2_score IS NOT NULL
    ),

    -- 5. Pivot ALL judges' scores (complete pairs only) — needed for majority vote.
    complete_all AS (
      SELECT bout, date, round, judge,
        MAX(CASE WHEN LOWER(TRIM(fighter)) = LOWER(TRIM(SPLIT_PART(bout, ' vs ', 1))) THEN score END) AS f1_score,
        MAX(CASE WHEN LOWER(TRIM(fighter)) = LOWER(TRIM(SPLIT_PART(bout, ' vs ', 2))) THEN score END) AS f2_score
      FROM js_all
      GROUP BY bout, date, round, judge
      HAVING
        MAX(CASE WHEN LOWER(TRIM(fighter)) = LOWER(TRIM(SPLIT_PART(bout, ' vs ', 1))) THEN score END) IS NOT NULL
        AND MAX(CASE WHEN LOWER(TRIM(fighter)) = LOWER(TRIM(SPLIT_PART(bout, ' vs ', 2))) THEN score END) IS NOT NULL
    ),

    -- 6. Per (bout, date, round): tally votes per fighter across all judges.
    round_votes AS (
      SELECT
        bout, date, round,
        SUM(CASE WHEN f1_score > f2_score THEN 1 ELSE 0 END) AS f1_votes,
        SUM(CASE WHEN f2_score > f1_score THEN 1 ELSE 0 END) AS f2_votes,
        COUNT(*) AS judge_count
      FROM complete_all
      GROUP BY bout, date, round
    ),

    -- 7. This judge's per-round decision + agreement type.
    judge_decisions AS (
      SELECT
        cj.bout,
        cj.date,
        cj.round,
        cj.f1_score,
        cj.f2_score,
        EXTRACT(YEAR FROM cj.date)::integer AS year,
        CASE
          WHEN cj.f1_score > cj.f2_score THEN 'f1'
          WHEN cj.f2_score > cj.f1_score THEN 'f2'
          ELSE 'draw'
        END AS judge_winner,
        CASE
          WHEN cj.f1_score = cj.f2_score
            THEN 'draw'
          WHEN cj.f1_score > cj.f2_score AND rv.f1_votes = 1
            THEN 'lone_dissenter'
          WHEN cj.f2_score > cj.f1_score AND rv.f2_votes = 1
            THEN 'lone_dissenter'
          WHEN (cj.f1_score > cj.f2_score AND rv.f1_votes = rv.judge_count)
            OR  (cj.f2_score > cj.f1_score AND rv.f2_votes = rv.judge_count)
            THEN 'unanimous'
          ELSE 'majority'
        END AS agreement_type
      FROM complete_judge cj
      JOIN round_votes rv
        ON  rv.bout  = cj.bout
        AND rv.date  = cj.date
        AND rv.round = cj.round
      WHERE rv.judge_count >= 2
    ),

    -- 8. Match each (bout, date) to fight_meta_details for weight class + fighter names.
    unique_bouts AS (
      SELECT DISTINCT
        bout,
        date,
        TRIM(SPLIT_PART(bout, ' vs ', 1)) AS js_f1,
        TRIM(SPLIT_PART(bout, ' vs ', 2)) AS js_f2
      FROM judge_decisions
    ),

    bout_fmd AS (
      SELECT DISTINCT ON (ub.bout, ub.date)
        ub.bout  AS js_bout,
        ub.date  AS js_date,
        fmd.event_name AS fmd_event_name,
        fmd.bout       AS fmd_bout,
        fmd.fight_url,
        fmd.fighter1_name,
        fmd.fighter2_name,
        COALESCE(fmd.weight_class_clean, fmd.weight_class) AS weight_class_clean
      FROM unique_bouts ub
      JOIN ufc_events ue
        ON  ue.event_date BETWEEN ub.date - INTERVAL '1 day' AND ub.date + INTERVAL '1 day'
      JOIN fight_meta_details fmd
        ON  fmd.event_name = ue.event_name
        AND (
          (   lower(split_part(ub.js_f1, ' ', -1)) = lower(split_part(fmd.fighter1_name, ' ', -1))
          AND lower(split_part(ub.js_f2, ' ', -1)) = lower(split_part(fmd.fighter2_name, ' ', -1)))
          OR
          (   lower(split_part(ub.js_f1, ' ', -1)) = lower(split_part(fmd.fighter2_name, ' ', -1))
          AND lower(split_part(ub.js_f2, ' ', -1)) = lower(split_part(fmd.fighter1_name, ' ', -1)))
        )
      ORDER BY ub.bout, ub.date
    ),

    -- 9. Join decisions to fight meta (LEFT: rounds without meta still included in basic stats).
    decisions_with_meta AS (
      SELECT
        jd.*,
        bf.fmd_event_name,
        bf.fmd_bout,
        bf.fight_url,
        bf.fighter1_name,
        bf.fighter2_name,
        bf.weight_class_clean
      FROM judge_decisions jd
      LEFT JOIN bout_fmd bf ON bf.js_bout = jd.bout AND bf.js_date = jd.date
    ),

    -- 10. Join to round_fight_stats (INNER: only rounds with stat data).
    fight_stats_raw AS (
      SELECT
        dm.bout, dm.date, dm.round, dm.judge_winner,
        dm.fighter1_name, dm.fighter2_name,
        rfs.fighter_name,
        rfs.sig_strikes_landed,
        rfs.sig_strikes_attempted,
        rfs.takedowns_landed,
        rfs.control_time_sec,
        rfs.kd
      FROM decisions_with_meta dm
      JOIN round_fight_stats rfs
        ON  rfs.event_name = dm.fmd_event_name
        AND rfs.round      = dm.round
        AND (
          rfs.bout = dm.fmd_bout
          OR rfs.bout = TRIM(SPLIT_PART(dm.fmd_bout, ' vs ', 2)) || ' vs ' || TRIM(SPLIT_PART(dm.fmd_bout, ' vs ', 1))
        )
      WHERE dm.fmd_event_name IS NOT NULL
        AND dm.judge_winner IN ('f1', 'f2')
    ),

    -- 11. Pivot round_fight_stats to f1/f2 columns.
    fight_stats_pivoted AS (
      SELECT
        bout, date, round, judge_winner,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN sig_strikes_landed   END) AS f1_ssl,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN sig_strikes_attempted END) AS f1_ssa,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN takedowns_landed      END) AS f1_td,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN control_time_sec     END) AS f1_ctrl,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN kd                  END) AS f1_kd,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN sig_strikes_landed   END) AS f2_ssl,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN sig_strikes_attempted END) AS f2_ssa,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN takedowns_landed      END) AS f2_td,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN control_time_sec     END) AS f2_ctrl,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN kd                  END) AS f2_kd
      FROM fight_stats_raw
      GROUP BY bout, date, round, judge_winner, fighter1_name, fighter2_name
    ),

    -- 12. Winner/loser stats per round.
    round_winner_stats AS (
      SELECT
        bout, date, round,
        CASE WHEN judge_winner = 'f1' THEN f1_ssl  ELSE f2_ssl  END AS winner_ssl,
        CASE WHEN judge_winner = 'f1' THEN f1_ssa  ELSE f2_ssa  END AS winner_ssa,
        CASE WHEN judge_winner = 'f1' THEN f1_td   ELSE f2_td   END AS winner_td,
        CASE WHEN judge_winner = 'f1' THEN f1_ctrl ELSE f2_ctrl END AS winner_ctrl,
        CASE WHEN judge_winner = 'f1' THEN COALESCE(f1_kd,0)    ELSE COALESCE(f2_kd,0) END AS winner_kd,
        CASE WHEN judge_winner = 'f1' THEN f2_ssl  ELSE f1_ssl  END AS loser_ssl,
        CASE WHEN judge_winner = 'f1' THEN f2_ssa  ELSE f1_ssa  END AS loser_ssa,
        CASE WHEN judge_winner = 'f1' THEN f2_td   ELSE f1_td   END AS loser_td,
        CASE WHEN judge_winner = 'f1' THEN f2_ctrl ELSE f1_ctrl END AS loser_ctrl,
        CASE WHEN judge_winner = 'f1' THEN COALESCE(f2_kd,0)    ELSE COALESCE(f1_kd,0) END AS loser_kd
      FROM fight_stats_pivoted
      WHERE f1_ssl IS NOT NULL AND f2_ssl IS NOT NULL
    )

    SELECT json_build_object(

      -- Basic header stats
      'name',           p_judge,
      'rounds_judged',  (SELECT COUNT(*)                    FROM judge_decisions),
      'fights_judged',  (SELECT COUNT(DISTINCT (bout, date)) FROM judge_decisions),
      'outlier_rate',   (
        SELECT ROUND(AVG(CASE WHEN agreement_type = 'lone_dissenter' THEN 1.0 ELSE 0.0 END)::numeric, 3)
        FROM judge_decisions WHERE agreement_type != 'draw'
      ),
      'ten_eight_rate', (
        SELECT ROUND(AVG(CASE WHEN LEAST(f1_score, f2_score) <= 8 AND f1_score != f2_score THEN 1.0 ELSE 0.0 END)::numeric, 3)
        FROM judge_decisions
      ),
      'last_active',    (SELECT MAX(date) FROM judge_decisions),

      -- Agreement breakdown
      'agreement_breakdown', (
        SELECT json_build_object(
          'unanimous',      COUNT(*) FILTER (WHERE agreement_type = 'unanimous'),
          'majority',       COUNT(*) FILTER (WHERE agreement_type = 'majority'),
          'lone_dissenter', COUNT(*) FILTER (WHERE agreement_type = 'lone_dissenter'),
          'total',          COUNT(*) FILTER (WHERE agreement_type != 'draw'),
          'unanimous_pct',  ROUND(COUNT(*) FILTER (WHERE agreement_type = 'unanimous')::numeric
                              / NULLIF(COUNT(*) FILTER (WHERE agreement_type != 'draw'), 0), 3),
          'majority_pct',   ROUND(COUNT(*) FILTER (WHERE agreement_type = 'majority')::numeric
                              / NULLIF(COUNT(*) FILTER (WHERE agreement_type != 'draw'), 0), 3),
          'lone_pct',       ROUND(COUNT(*) FILTER (WHERE agreement_type = 'lone_dissenter')::numeric
                              / NULLIF(COUNT(*) FILTER (WHERE agreement_type != 'draw'), 0), 3)
        )
        FROM judge_decisions
      ),

      -- Year-by-year trend
      'by_year', (
        SELECT json_agg(t ORDER BY t.year ASC)
        FROM (
          SELECT
            year,
            COUNT(*) FILTER (WHERE agreement_type != 'draw') AS rounds,
            ROUND(AVG(CASE WHEN agreement_type = 'lone_dissenter' THEN 1.0 ELSE 0.0 END
                    )::numeric, 3) AS outlier_rate
          FROM judge_decisions
          WHERE agreement_type != 'draw'
          GROUP BY year
        ) t
      ),

      -- Per-division breakdown
      'by_class', (
        SELECT json_agg(t ORDER BY t.rounds DESC)
        FROM (
          SELECT
            dm.weight_class_clean,
            COUNT(*) FILTER (WHERE dm.agreement_type != 'draw') AS rounds,
            ROUND(AVG(CASE WHEN dm.agreement_type = 'lone_dissenter' THEN 1.0 ELSE 0.0 END)::numeric, 3) AS outlier_rate,
            ROUND(AVG(CASE
              WHEN LEAST(dm.f1_score, dm.f2_score) <= 8 AND dm.f1_score != dm.f2_score
              THEN 1.0 ELSE 0.0 END)::numeric, 3) AS ten_eight_rate
          FROM decisions_with_meta dm
          WHERE dm.weight_class_clean IS NOT NULL
            AND dm.agreement_type != 'draw'
          GROUP BY dm.weight_class_clean
          HAVING COUNT(*) FILTER (WHERE dm.agreement_type != 'draw') >= 10
        ) t
      ),

      -- Style preference
      'style_preference', (
        SELECT json_build_object(
          'striking_pct',  ROUND(AVG(CASE WHEN winner_ssl > loser_ssl THEN 1.0 ELSE 0.0 END)::numeric, 3),
          'grappling_pct', ROUND(AVG(CASE
            WHEN COALESCE(winner_td,0) + COALESCE(winner_ctrl,0) >
                 COALESCE(loser_td,0)  + COALESCE(loser_ctrl,0)
            THEN 1.0 ELSE 0.0 END)::numeric, 3),
          'aggressor_pct', ROUND(AVG(CASE
            WHEN NULLIF(winner_ssa,0) IS NOT NULL AND NULLIF(loser_ssa,0) IS NOT NULL
              AND winner_ssa > loser_ssa
              AND winner_ssl::float / winner_ssa < loser_ssl::float / loser_ssa
            THEN 1.0 ELSE 0.0 END)::numeric, 3),
          'kd_pct',        ROUND(AVG(CASE WHEN winner_kd > loser_kd THEN 1.0 ELSE 0.0 END)::numeric, 3),
          'rounds',        COUNT(*)
        )
        FROM round_winner_stats
      ),

      -- Most controversial fights
      'controversial_fights', (
        SELECT json_agg(t ORDER BY t.outlier_rounds DESC, t.fight_date DESC)
        FROM (
          SELECT
            dm.bout,
            dm.date AS fight_date,
            MAX(dm.fight_url)      AS fight_url,
            MAX(dm.fmd_event_name) AS event_name,
            COUNT(*) FILTER (WHERE dm.agreement_type = 'lone_dissenter') AS outlier_rounds,
            COUNT(*) FILTER (WHERE dm.agreement_type != 'draw')          AS total_rounds
          FROM decisions_with_meta dm
          GROUP BY dm.bout, dm.date
          HAVING COUNT(*) FILTER (WHERE dm.agreement_type = 'lone_dissenter') > 0
          ORDER BY outlier_rounds DESC, dm.date DESC
          LIMIT 5
        ) t
      ),

      -- Men's vs Women's gender split (from decisions_with_meta which has weight_class_clean)
      'gender_split', json_build_object(
        'mens', json_build_object(
          'rounds',        (SELECT COUNT(*) FROM decisions_with_meta
                            WHERE weight_class_clean IS NOT NULL AND weight_class_clean NOT ILIKE 'Women%%'),
          'fights',        (SELECT COUNT(DISTINCT (bout, date)) FROM decisions_with_meta
                            WHERE weight_class_clean IS NOT NULL AND weight_class_clean NOT ILIKE 'Women%%'),
          'outlier_rate',  (SELECT ROUND(AVG(CASE WHEN agreement_type = 'lone_dissenter' THEN 1.0 ELSE 0.0 END)::numeric, 3)
                            FROM decisions_with_meta
                            WHERE agreement_type != 'draw' AND weight_class_clean IS NOT NULL AND weight_class_clean NOT ILIKE 'Women%%'),
          'ten_eight_rate',(SELECT ROUND(AVG(CASE WHEN LEAST(f1_score, f2_score) <= 8 AND f1_score != f2_score THEN 1.0 ELSE 0.0 END)::numeric, 3)
                            FROM decisions_with_meta
                            WHERE weight_class_clean IS NOT NULL AND weight_class_clean NOT ILIKE 'Women%%'),
          'unanimous_pct', (SELECT ROUND(COUNT(*) FILTER (WHERE agreement_type = 'unanimous')::numeric
                              / NULLIF(COUNT(*) FILTER (WHERE agreement_type != 'draw'), 0), 3)
                            FROM decisions_with_meta
                            WHERE weight_class_clean IS NOT NULL AND weight_class_clean NOT ILIKE 'Women%%'),
          'lone_pct',      (SELECT ROUND(COUNT(*) FILTER (WHERE agreement_type = 'lone_dissenter')::numeric
                              / NULLIF(COUNT(*) FILTER (WHERE agreement_type != 'draw'), 0), 3)
                            FROM decisions_with_meta
                            WHERE weight_class_clean IS NOT NULL AND weight_class_clean NOT ILIKE 'Women%%')
        ),
        'womens', json_build_object(
          'rounds',        (SELECT COUNT(*) FROM decisions_with_meta
                            WHERE weight_class_clean ILIKE 'Women%%'),
          'fights',        (SELECT COUNT(DISTINCT (bout, date)) FROM decisions_with_meta
                            WHERE weight_class_clean ILIKE 'Women%%'),
          'outlier_rate',  (SELECT ROUND(AVG(CASE WHEN agreement_type = 'lone_dissenter' THEN 1.0 ELSE 0.0 END)::numeric, 3)
                            FROM decisions_with_meta
                            WHERE agreement_type != 'draw' AND weight_class_clean ILIKE 'Women%%'),
          'ten_eight_rate',(SELECT ROUND(AVG(CASE WHEN LEAST(f1_score, f2_score) <= 8 AND f1_score != f2_score THEN 1.0 ELSE 0.0 END)::numeric, 3)
                            FROM decisions_with_meta
                            WHERE weight_class_clean ILIKE 'Women%%'),
          'unanimous_pct', (SELECT ROUND(COUNT(*) FILTER (WHERE agreement_type = 'unanimous')::numeric
                              / NULLIF(COUNT(*) FILTER (WHERE agreement_type != 'draw'), 0), 3)
                            FROM decisions_with_meta
                            WHERE weight_class_clean ILIKE 'Women%%'),
          'lone_pct',      (SELECT ROUND(COUNT(*) FILTER (WHERE agreement_type = 'lone_dissenter')::numeric
                              / NULLIF(COUNT(*) FILTER (WHERE agreement_type != 'draw'), 0), 3)
                            FROM decisions_with_meta
                            WHERE weight_class_clean ILIKE 'Women%%')
        )
      )

    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_judge_profile(text) TO anon, authenticated;
"""

resp = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": SQL}, timeout=30)
if resp.ok:
    print("✅ get_judge_profile deployed successfully")
else:
    print(f"❌ Error {resp.status_code}: {resp.text}")
