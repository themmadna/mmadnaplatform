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
        COALESCE(fmd.weight_class_clean, fmd.weight_class) AS weight_class_clean,
        fmd.method,
        fmd.event_name AS fmd_event_name,
        fmd.bout       AS fmd_bout
      FROM user_round_scores urs
      JOIN fights f ON f.id = urs.fight_id
      JOIN ufc_events ue ON ue.event_name = f.event_name
      LEFT JOIN fight_meta_details fmd ON fmd.fight_url = f.fight_url
      WHERE urs.user_id = v_user_id
        AND fmd.fighter1_name IS NOT NULL
        AND fmd.fighter2_name IS NOT NULL
    ),

    -- 2. Fetch all judge_scores rows (one row per fighter per judge per round)
    --    within ±1 day of the fight date that name-match either fighter.
    judge_rows AS (
      SELECT
        ur.fight_id,
        ur.round,
        ur.user_f1,
        ur.user_f2,
        ur.weight_class_clean,
        ur.fighter1_name,
        ur.fighter2_name,
        js.judge,
        js.fighter  AS js_fighter,
        js.score
      FROM user_rounds ur
      JOIN judge_scores js
        ON  js.date  BETWEEN ur.event_date - INTERVAL '1 day' AND ur.event_date + INTERVAL '1 day'
        AND js.round = ur.round
        AND (
          lower(split_part(ur.fighter1_name, ' ', -1)) = lower(split_part(js.fighter, ' ', -1))
          OR lower(split_part(ur.fighter2_name, ' ', -1)) = lower(split_part(js.fighter, ' ', -1))
        )
    ),

    -- 3. Pivot to one row per (fight, round, judge) with f1/f2 scores.
    --    Only complete pairs (both scores found) are kept.
    pivoted AS (
      SELECT
        fight_id,
        round,
        user_f1,
        user_f2,
        weight_class_clean,
        judge,
        MAX(CASE
          WHEN lower(split_part(fighter1_name, ' ', -1)) = lower(split_part(js_fighter, ' ', -1))
          THEN score END) AS judge_f1_score,
        MAX(CASE
          WHEN lower(split_part(fighter2_name, ' ', -1)) = lower(split_part(js_fighter, ' ', -1))
          THEN score END) AS judge_f2_score
      FROM judge_rows
      GROUP BY fight_id, round, user_f1, user_f2, weight_class_clean, judge, fighter1_name, fighter2_name
    ),

    complete_judges AS (
      SELECT * FROM pivoted
      WHERE judge_f1_score IS NOT NULL AND judge_f2_score IS NOT NULL
    ),

    -- 4. Per (fight, round): majority vote + count how many judges agree with user
    majority AS (
      SELECT
        fight_id,
        round,
        user_f1,
        user_f2,
        weight_class_clean,
        judge,
        judge_f1_score,
        judge_f2_score,
        SUM(CASE WHEN judge_f1_score > judge_f2_score THEN 1 ELSE 0 END) OVER w AS f1_wins,
        SUM(CASE WHEN judge_f2_score > judge_f1_score THEN 1 ELSE 0 END) OVER w AS f2_wins,
        COUNT(*) OVER w AS judge_count,
        -- How many judges agree with the user's pick on this round
        SUM(CASE
          WHEN (user_f1 > user_f2 AND judge_f1_score > judge_f2_score)
            OR (user_f2 > user_f1 AND judge_f2_score > judge_f1_score)
          THEN 1 ELSE 0
        END) OVER w AS judges_agreeing
      FROM complete_judges
      WINDOW w AS (PARTITION BY fight_id, round)
    ),

    -- 5. Collapse to one row per (fight, round)
    round_accuracy AS (
      SELECT DISTINCT ON (fight_id, round)
        fight_id,
        round,
        weight_class_clean,
        CASE WHEN user_f1 > user_f2 THEN 'f1' WHEN user_f2 > user_f1 THEN 'f2' ELSE 'draw' END AS user_winner,
        CASE WHEN f1_wins >= 2 THEN 'f1' WHEN f2_wins >= 2 THEN 'f2' ELSE NULL END AS majority_winner,
        LEAST(user_f1, user_f2) AS user_loser_score,
        judges_agreeing,
        judge_count
      FROM majority
      WHERE judge_count >= 2
      ORDER BY fight_id, round
    ),

    -- 6. For 10-8 quality: collect each judge's loser score on rounds where user gave 10-8.
    --    judge_loser_score <= 8 means that judge also scored it a dominant round.
    ten_eight_judge_scores AS (
      SELECT
        CASE
          WHEN cj.user_f1 > cj.user_f2 THEN cj.judge_f2_score
          ELSE                               cj.judge_f1_score
        END AS judge_loser_score
      FROM complete_judges cj
      JOIN round_accuracy ra ON ra.fight_id = cj.fight_id AND ra.round = cj.round
      WHERE cj.user_f1 != cj.user_f2
        AND LEAST(cj.user_f1, cj.user_f2) <= 8
        AND ra.majority_winner IS NOT NULL
    ),

    -- 7. Judge-level agreement with user (min 5 shared rounds)
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
    ),

    -- 8. Round-level fight stats: one row per (fight_id, round, fighter).
    --    fmd.bout and rfs.bout are often reversed (same ufcstats scraper, different scrape order),
    --    so match both orderings: "A vs B" and "B vs A".
    fight_stats_raw AS (
      SELECT
        ur.fight_id,
        ur.round,
        ur.user_f1,
        ur.user_f2,
        ur.weight_class_clean,
        ur.fighter1_name,
        ur.fighter2_name,
        rfs.fighter_name,
        rfs.sig_strikes_landed,
        rfs.sig_strikes_attempted,
        rfs.takedowns_landed,
        rfs.control_time_sec,
        rfs.sub_attempts,
        rfs.sig_strikes_ground_landed AS ground_strikes,
        rfs.kd
      FROM user_rounds ur
      JOIN round_fight_stats rfs
        ON  rfs.event_name = ur.fmd_event_name
        AND rfs.round      = ur.round
        AND (
          rfs.bout = ur.fmd_bout
          OR rfs.bout = TRIM(SPLIT_PART(ur.fmd_bout, ' vs ', 2)) || ' vs ' || TRIM(SPLIT_PART(ur.fmd_bout, ' vs ', 1))
        )
    ),

    -- 9. Pivot fight stats to one row per (fight_id, round) with f1/f2 columns.
    --    Uses last-name match (same source so names are consistent).
    fight_stats_pivoted AS (
      SELECT
        fight_id,
        round,
        user_f1,
        user_f2,
        weight_class_clean,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN sig_strikes_landed   END) AS f1_ssl,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN sig_strikes_attempted END) AS f1_ssa,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN takedowns_landed      END) AS f1_td,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN control_time_sec     END) AS f1_ctrl,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN sub_attempts         END) AS f1_sub,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN ground_strikes       END) AS f1_grd,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN kd                  END) AS f1_kd,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN sig_strikes_landed   END) AS f2_ssl,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN sig_strikes_attempted END) AS f2_ssa,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN takedowns_landed      END) AS f2_td,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN control_time_sec     END) AS f2_ctrl,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN sub_attempts         END) AS f2_sub,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN ground_strikes       END) AS f2_grd,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN kd                  END) AS f2_kd
      FROM fight_stats_raw
      GROUP BY fight_id, round, user_f1, user_f2, weight_class_clean
    ),

    -- 10. Derive winner/loser stats per round (user's pick determines winner).
    --     Only rounds with complete stats and a clear user pick (no draw) are included.
    round_winner_stats AS (
      SELECT
        fight_id,
        round,
        weight_class_clean,
        CASE WHEN user_f1 > user_f2 THEN f1_ssl  ELSE f2_ssl  END AS winner_ssl,
        CASE WHEN user_f1 > user_f2 THEN f1_ssa  ELSE f2_ssa  END AS winner_ssa,
        CASE WHEN user_f1 > user_f2 THEN f1_td   ELSE f2_td   END AS winner_td,
        CASE WHEN user_f1 > user_f2 THEN f1_ctrl ELSE f2_ctrl END AS winner_ctrl,
        CASE WHEN user_f1 > user_f2 THEN f1_sub  ELSE f2_sub  END AS winner_sub,
        CASE WHEN user_f1 > user_f2 THEN f1_grd  ELSE f2_grd  END AS winner_grd,
        CASE WHEN user_f1 > user_f2 THEN f2_ssl  ELSE f1_ssl  END AS loser_ssl,
        CASE WHEN user_f1 > user_f2 THEN f2_ssa  ELSE f1_ssa  END AS loser_ssa,
        CASE WHEN user_f1 > user_f2 THEN f2_td   ELSE f1_td   END AS loser_td,
        CASE WHEN user_f1 > user_f2 THEN f2_ctrl ELSE f1_ctrl END AS loser_ctrl,
        CASE WHEN user_f1 > user_f2 THEN f2_grd  ELSE f1_grd  END AS loser_grd
      FROM fight_stats_pivoted
      WHERE user_f1 != user_f2
        AND f1_ssl IS NOT NULL AND f2_ssl IS NOT NULL
    ),

    -- 11. Per-class striking vs grappling bias (merged into accuracy_by_class below).
    class_bias AS (
      SELECT
        weight_class_clean,
        ROUND(AVG(CASE WHEN winner_ssl > loser_ssl THEN 1.0 ELSE 0.0 END)::numeric, 3) AS striking_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_td,0) + COALESCE(winner_ctrl,0) > COALESCE(loser_td,0) + COALESCE(loser_ctrl,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS grappling_pct
      FROM round_winner_stats
      WHERE weight_class_clean IS NOT NULL
      GROUP BY weight_class_clean
    )

    SELECT json_build_object(
      'fights_scored',       (SELECT COUNT(DISTINCT fight_id) FROM user_rounds),
      'rounds_scored',       (SELECT COUNT(*) FROM user_rounds),
      'rounds_matched',      (SELECT COUNT(*) FROM round_accuracy WHERE majority_winner IS NOT NULL),
      'accuracy',            (
        SELECT ROUND(AVG(CASE WHEN user_winner = majority_winner THEN 1.0 ELSE 0.0 END)::numeric, 3)
        FROM round_accuracy WHERE majority_winner IS NOT NULL
      ),
      -- % of rounds where 0 judges agreed with the user (lone dissenter)
      'outlier_rate',        (
        SELECT ROUND(AVG(CASE WHEN judges_agreeing = 0 THEN 1.0 ELSE 0.0 END)::numeric, 3)
        FROM round_accuracy
      ),
      -- Per-round breakdown: how many judges agreed (all / most / some / none)
      -- Denominator: all rounds with judge data (includes splits where majority_winner IS NULL)
      'agreement_breakdown', (
        SELECT json_build_object(
          'all3',           COUNT(*) FILTER (WHERE judges_agreeing = judge_count),
          'two_of_three',   COUNT(*) FILTER (WHERE judges_agreeing >= 2 AND judges_agreeing < judge_count),
          'one_of_three',   COUNT(*) FILTER (WHERE judges_agreeing = 1),
          'lone_dissenter', COUNT(*) FILTER (WHERE judges_agreeing = 0),
          'total',          COUNT(*),
          'all3_pct',       ROUND(COUNT(*) FILTER (WHERE judges_agreeing = judge_count)::numeric            / NULLIF(COUNT(*), 0), 3),
          'two_pct',        ROUND(COUNT(*) FILTER (WHERE judges_agreeing >= 2 AND judges_agreeing < judge_count)::numeric / NULLIF(COUNT(*), 0), 3),
          'one_pct',        ROUND(COUNT(*) FILTER (WHERE judges_agreeing = 1)::numeric                     / NULLIF(COUNT(*), 0), 3),
          'lone_pct',       ROUND(COUNT(*) FILTER (WHERE judges_agreeing = 0)::numeric                     / NULLIF(COUNT(*), 0), 3)
        )
        FROM round_accuracy
      ),
      'ten_eight_rate',      (
        SELECT ROUND(AVG(CASE WHEN user_loser_score <= 8 THEN 1.0 ELSE 0.0 END)::numeric, 3)
        FROM round_accuracy WHERE majority_winner IS NOT NULL
      ),
      -- Of user 10-8 rounds, % where judges also scored it dominant (their loser got <= 8)
      'ten_eight_quality',   (
        SELECT ROUND(AVG(CASE WHEN judge_loser_score <= 8 THEN 1.0 ELSE 0.0 END)::numeric, 3)
        FROM ten_eight_judge_scores
      ),
      'accuracy_by_class',   (
        SELECT json_agg(t ORDER BY t.rounds DESC)
        FROM (
          SELECT
            ra.weight_class_clean,
            ROUND(AVG(CASE WHEN ra.user_winner = ra.majority_winner THEN 1.0 ELSE 0.0 END)::numeric, 3) AS accuracy,
            COUNT(*) AS rounds,
            ROUND(AVG(ra.user_loser_score)::numeric, 2) AS avg_loser_score,
            cb.striking_pct,
            cb.grappling_pct
          FROM round_accuracy ra
          LEFT JOIN class_bias cb ON cb.weight_class_clean = ra.weight_class_clean
          WHERE ra.majority_winner IS NOT NULL AND ra.weight_class_clean IS NOT NULL
          GROUP BY ra.weight_class_clean, cb.striking_pct, cb.grappling_pct
          HAVING COUNT(*) >= 3
        ) t
      ),
      'judges',              (
        SELECT json_agg(json_build_object(
          'name',          judge,
          'agreement_pct', ROUND(agreed::numeric / rounds, 3),
          'rounds',        rounds
        ) ORDER BY agreed::numeric / rounds DESC)
        FROM judge_agreement
      ),

      -- Bias metrics (require round_fight_stats join — null when no stats available)

      -- striking_vs_grappling_bias: of rounds user awarded, did their winner have more
      -- sig strikes landed (striking) or more takedowns+ctrl (grappling)?
      'striking_vs_grappling_bias', (
        SELECT json_build_object(
          'striking_pct',  ROUND(AVG(CASE WHEN winner_ssl > loser_ssl THEN 1.0 ELSE 0.0 END)::numeric, 3),
          'grappling_pct', ROUND(AVG(CASE WHEN COALESCE(winner_td,0) + COALESCE(winner_ctrl,0) > COALESCE(loser_td,0) + COALESCE(loser_ctrl,0) THEN 1.0 ELSE 0.0 END)::numeric, 3),
          'rounds',        COUNT(*)
        )
        FROM round_winner_stats
      ),

      -- aggressor_bias: % of rounds where user's winner threw more (volume advantage)
      -- but landed at a lower accuracy than the opponent.
      'aggressor_bias', (
        SELECT ROUND(AVG(CASE
          WHEN COALESCE(winner_ssa,0) > COALESCE(loser_ssa,0)
            AND NULLIF(winner_ssa,0) IS NOT NULL AND NULLIF(loser_ssa,0) IS NOT NULL
            AND winner_ssl::float / winner_ssa < loser_ssl::float / loser_ssa
          THEN 1.0 ELSE 0.0
        END)::numeric, 3)
        FROM round_winner_stats
        WHERE winner_ssa IS NOT NULL AND loser_ssa IS NOT NULL
      ),

      -- takedown_quality_bias: of rounds where user's winner had ctrl > 30s,
      -- % where the control was passive (no subs, <=3 ground strikes).
      'takedown_quality_bias', (
        SELECT json_build_object(
          'passive_control_pct', ROUND(
            SUM(CASE WHEN COALESCE(winner_ctrl,0) > 30 AND COALESCE(winner_sub,0) = 0 AND COALESCE(winner_grd,0) <= 3 THEN 1 ELSE 0 END)::numeric /
            NULLIF(SUM(CASE WHEN COALESCE(winner_ctrl,0) > 30 THEN 1 ELSE 0 END), 0),
          3),
          'control_rounds', SUM(CASE WHEN COALESCE(winner_ctrl,0) > 30 THEN 1 ELSE 0 END)
        )
        FROM round_winner_stats
      ),

      -- knockdown_bias: on rounds where there was a KD, % of time user sided with
      -- the fighter who scored the knockdown.
      'knockdown_bias', (
        SELECT json_build_object(
          'kd_bias_pct', ROUND(AVG(CASE
            WHEN (user_f1 > user_f2 AND COALESCE(f1_kd,0) > COALESCE(f2_kd,0))
              OR (user_f2 > user_f1 AND COALESCE(f2_kd,0) > COALESCE(f1_kd,0))
            THEN 1.0 ELSE 0.0
          END)::numeric, 3),
          'kd_rounds', COUNT(*)
        )
        FROM fight_stats_pivoted
        WHERE ABS(COALESCE(f1_kd,0) - COALESCE(f2_kd,0)) > 0
          AND user_f1 != user_f2
      ),

      -- takedown_lean: of rounds where one fighter had more takedowns,
      -- % of time user sided with the fighter who landed more TDs.
      'takedown_lean', (
        SELECT json_build_object(
          'pct',    ROUND(AVG(CASE
            WHEN (user_f1 > user_f2 AND COALESCE(f1_td,0) > COALESCE(f2_td,0))
              OR (user_f2 > user_f1 AND COALESCE(f2_td,0) > COALESCE(f1_td,0))
            THEN 1.0 ELSE 0.0
          END)::numeric, 3),
          'rounds', COUNT(*)
        )
        FROM fight_stats_pivoted
        WHERE ABS(COALESCE(f1_td,0) - COALESCE(f2_td,0)) > 0
          AND user_f1 != user_f2
      ),

      -- scoring_differentials: average gap between winner and loser in the rounds
      -- the user awarded. Shows how big a margin they typically need to give a round.
      'scoring_differentials', (
        SELECT json_build_object(
          'avg_strike_diff', ROUND(AVG(COALESCE(winner_ssl,0) - COALESCE(loser_ssl,0))::numeric, 1),
          'avg_ctrl_diff',   ROUND(AVG(COALESCE(winner_ctrl,0) - COALESCE(loser_ctrl,0))::numeric, 0),
          'avg_grd_diff',    ROUND(AVG(COALESCE(winner_grd,0) - COALESCE(loser_grd,0))::numeric, 1),
          'rounds',          COUNT(*)
        )
        FROM round_winner_stats
        WHERE winner_ssl IS NOT NULL
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
