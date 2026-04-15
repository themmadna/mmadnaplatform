"""
deploy_scoring_insights.py — Deploy get_scoring_insights RPC to Supabase.

Run once (or to update):
    python supabase/deploy_scoring_insights.py
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
CREATE OR REPLACE FUNCTION get_scoring_insights()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_stat_rounds integer;
  v_tier integer;
  v_mens_rounds integer;
  v_womens_rounds integer;
  v_qualifying_groups integer;
BEGIN
  IF v_user_id IS NULL THEN RETURN NULL; END IF;

  -- Count matched rounds (rounds with fight stats) up front for tier gating
  SELECT COUNT(*) INTO v_stat_rounds
  FROM user_round_scores urs
  JOIN fights f ON f.id = urs.fight_id
  JOIN ufc_events ue ON ue.event_name = f.event_name
  JOIN fight_meta_details fmd ON fmd.fight_url = f.fight_url
  JOIN round_fight_stats rfs
    ON rfs.event_name = fmd.event_name
    AND rfs.round = urs.round
    AND (
      rfs.bout = fmd.bout
      OR rfs.bout = TRIM(SPLIT_PART(fmd.bout, ' vs ', 2)) || ' vs ' || TRIM(SPLIT_PART(fmd.bout, ' vs ', 1))
    )
  WHERE urs.user_id = v_user_id
    AND fmd.fighter1_name IS NOT NULL
    AND fmd.fighter2_name IS NOT NULL
    AND urs.f1_score != urs.f2_score;

  -- Determine tier
  IF v_stat_rounds < 15 THEN
    RETURN json_build_object(
      'tier', 0,
      'rounds_with_stats', v_stat_rounds,
      'tier1_needed', 15
    );
  END IF;

  -- Full computation for tier >= 1
  RETURN (
    WITH
    -- 1. All rounds the user has scored, with fight date + meta
    user_rounds AS (
      SELECT
        urs.fight_id,
        urs.round,
        urs.f1_score AS user_f1,
        urs.f2_score AS user_f2,
        f.fight_url,
        ue.event_date,
        fmd.fighter1_name,
        fmd.fighter2_name,
        COALESCE(fmd.weight_class_clean, fmd.weight_class) AS weight_class_clean,
        fmd.event_name AS fmd_event_name,
        fmd.bout AS fmd_bout
      FROM user_round_scores urs
      JOIN fights f ON f.id = urs.fight_id
      JOIN ufc_events ue ON ue.event_name = f.event_name
      LEFT JOIN fight_meta_details fmd ON fmd.fight_url = f.fight_url
      WHERE urs.user_id = v_user_id
        AND fmd.fighter1_name IS NOT NULL
        AND fmd.fighter2_name IS NOT NULL
    ),

    -- 2. Judge rows for accuracy-by-round (drift feature)
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
        js.fighter AS js_fighter,
        js.score
      FROM user_rounds ur
      JOIN judge_scores js
        ON js.date BETWEEN ur.event_date - INTERVAL '1 day' AND ur.event_date + INTERVAL '1 day'
        AND js.round = ur.round
        AND (
          lower(split_part(ur.fighter1_name, ' ', -1)) = lower(split_part(js.fighter, ' ', -1))
          OR lower(split_part(ur.fighter2_name, ' ', -1)) = lower(split_part(js.fighter, ' ', -1))
        )
    ),

    pivoted AS (
      SELECT
        fight_id, round, user_f1, user_f2, weight_class_clean, judge,
        MAX(CASE WHEN lower(split_part(fighter1_name, ' ', -1)) = lower(split_part(js_fighter, ' ', -1)) THEN score END) AS judge_f1_score,
        MAX(CASE WHEN lower(split_part(fighter2_name, ' ', -1)) = lower(split_part(js_fighter, ' ', -1)) THEN score END) AS judge_f2_score
      FROM judge_rows
      GROUP BY fight_id, round, user_f1, user_f2, weight_class_clean, judge, fighter1_name, fighter2_name
    ),

    complete_judges AS (
      SELECT * FROM pivoted
      WHERE judge_f1_score IS NOT NULL AND judge_f2_score IS NOT NULL
    ),

    majority AS (
      SELECT
        fight_id, round, user_f1, user_f2, weight_class_clean,
        SUM(CASE WHEN judge_f1_score > judge_f2_score THEN 1 ELSE 0 END) OVER w AS f1_wins,
        SUM(CASE WHEN judge_f2_score > judge_f1_score THEN 1 ELSE 0 END) OVER w AS f2_wins,
        COUNT(*) OVER w AS judge_count,
        SUM(CASE
          WHEN (user_f1 > user_f2 AND judge_f1_score > judge_f2_score)
            OR (user_f2 > user_f1 AND judge_f2_score > judge_f1_score)
          THEN 1 ELSE 0
        END) OVER w AS judges_agreeing
      FROM complete_judges
      WINDOW w AS (PARTITION BY fight_id, round)
    ),

    round_accuracy AS (
      SELECT DISTINCT ON (fight_id, round)
        fight_id, round, weight_class_clean,
        CASE WHEN user_f1 > user_f2 THEN 'f1' WHEN user_f2 > user_f1 THEN 'f2' ELSE 'draw' END AS user_winner,
        CASE WHEN f1_wins >= 2 THEN 'f1' WHEN f2_wins >= 2 THEN 'f2' ELSE NULL END AS majority_winner,
        judges_agreeing, judge_count
      FROM majority
      WHERE judge_count >= 2
      ORDER BY fight_id, round
    ),

    -- 3. Round-level fight stats
    fight_stats_raw AS (
      SELECT
        ur.fight_id, ur.round, ur.user_f1, ur.user_f2,
        ur.weight_class_clean, ur.fighter1_name, ur.fighter2_name,
        rfs.fighter_name,
        rfs.sig_strikes_landed, rfs.sig_strikes_attempted,
        rfs.takedowns_landed, rfs.control_time_sec,
        rfs.sub_attempts, rfs.sig_strikes_ground_landed AS ground_strikes,
        rfs.kd
      FROM user_rounds ur
      JOIN round_fight_stats rfs
        ON rfs.event_name = ur.fmd_event_name
        AND rfs.round = ur.round
        AND (
          rfs.bout = ur.fmd_bout
          OR rfs.bout = TRIM(SPLIT_PART(ur.fmd_bout, ' vs ', 2)) || ' vs ' || TRIM(SPLIT_PART(ur.fmd_bout, ' vs ', 1))
        )
    ),

    fight_stats_pivoted AS (
      SELECT
        fight_id, round, user_f1, user_f2, weight_class_clean,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN sig_strikes_landed END) AS f1_ssl,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN sig_strikes_attempted END) AS f1_ssa,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN takedowns_landed END) AS f1_td,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN control_time_sec END) AS f1_ctrl,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN ground_strikes END) AS f1_grd,
        MAX(CASE WHEN lower(split_part(fighter1_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN kd END) AS f1_kd,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN sig_strikes_landed END) AS f2_ssl,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN sig_strikes_attempted END) AS f2_ssa,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN takedowns_landed END) AS f2_td,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN control_time_sec END) AS f2_ctrl,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN ground_strikes END) AS f2_grd,
        MAX(CASE WHEN lower(split_part(fighter2_name,' ',-1)) = lower(split_part(fighter_name,' ',-1)) THEN kd END) AS f2_kd
      FROM fight_stats_raw
      GROUP BY fight_id, round, user_f1, user_f2, weight_class_clean, fighter1_name, fighter2_name
    ),

    -- 4. Winner/loser stats oriented by user's pick (extended with kd)
    round_winner_stats AS (
      SELECT
        fight_id, round, weight_class_clean,
        CASE WHEN user_f1 > user_f2 THEN f1_ssl  ELSE f2_ssl  END AS winner_ssl,
        CASE WHEN user_f1 > user_f2 THEN f1_ssa  ELSE f2_ssa  END AS winner_ssa,
        CASE WHEN user_f1 > user_f2 THEN f1_td   ELSE f2_td   END AS winner_td,
        CASE WHEN user_f1 > user_f2 THEN f1_ctrl ELSE f2_ctrl END AS winner_ctrl,
        CASE WHEN user_f1 > user_f2 THEN f1_grd  ELSE f2_grd  END AS winner_grd,
        CASE WHEN user_f1 > user_f2 THEN f1_kd   ELSE f2_kd   END AS winner_kd,
        CASE WHEN user_f1 > user_f2 THEN f2_ssl  ELSE f1_ssl  END AS loser_ssl,
        CASE WHEN user_f1 > user_f2 THEN f2_ssa  ELSE f1_ssa  END AS loser_ssa,
        CASE WHEN user_f1 > user_f2 THEN f2_td   ELSE f1_td   END AS loser_td,
        CASE WHEN user_f1 > user_f2 THEN f2_ctrl ELSE f1_ctrl END AS loser_ctrl,
        CASE WHEN user_f1 > user_f2 THEN f2_grd  ELSE f1_grd  END AS loser_grd,
        CASE WHEN user_f1 > user_f2 THEN f2_kd   ELSE f1_kd   END AS loser_kd
      FROM fight_stats_pivoted
      WHERE user_f1 != user_f2
        AND f1_ssl IS NOT NULL AND f2_ssl IS NOT NULL
    ),

    -- 5. Tier computation
    tier_info AS (
      SELECT
        COUNT(*) AS total_stat_rounds,
        COUNT(*) FILTER (WHERE weight_class_clean NOT ILIKE 'Women%%') AS mens_rounds,
        COUNT(*) FILTER (WHERE weight_class_clean ILIKE 'Women%%') AS womens_rounds
      FROM round_winner_stats
    ),

    tier_groups AS (
      SELECT weight_class_group, COUNT(*) AS grp_rounds
      FROM (
        SELECT
          CASE
            WHEN weight_class_clean ILIKE 'Women%%Strawweight%%' OR weight_class_clean ILIKE 'Women%%Flyweight%%' THEN 'W-Straw+Fly'
            WHEN weight_class_clean ILIKE 'Women%%Bantamweight%%' OR weight_class_clean ILIKE 'Women%%Featherweight%%' THEN 'W-BW+FW'
            WHEN weight_class_clean ILIKE '%%Flyweight%%' AND weight_class_clean NOT ILIKE 'Women%%' THEN 'Fly+BW'
            WHEN weight_class_clean ILIKE '%%Bantamweight%%' AND weight_class_clean NOT ILIKE 'Women%%' THEN 'Fly+BW'
            WHEN weight_class_clean ILIKE '%%Featherweight%%' AND weight_class_clean NOT ILIKE 'Women%%' THEN 'FW+LW'
            WHEN weight_class_clean ILIKE '%%Lightweight%%' AND weight_class_clean NOT ILIKE 'Women%%' THEN 'FW+LW'
            WHEN weight_class_clean ILIKE '%%Welterweight%%' THEN 'WW+MW'
            WHEN weight_class_clean ILIKE '%%Middleweight%%' THEN 'WW+MW'
            WHEN weight_class_clean ILIKE '%%Light Heavyweight%%' THEN 'LHW+HW'
            WHEN weight_class_clean ILIKE '%%Heavyweight%%' AND weight_class_clean NOT ILIKE '%%Light%%' THEN 'LHW+HW'
            ELSE 'Other'
          END AS weight_class_group
        FROM round_winner_stats
      ) grouped
      GROUP BY weight_class_group
      HAVING COUNT(*) >= 15
    ),

    -- =============================================
    -- FEATURE 4: Stat Weighting Fingerprint
    -- =============================================
    stat_fingerprint AS (
      SELECT
        ROUND(AVG(CASE WHEN winner_ssl > loser_ssl THEN 1.0 ELSE 0.0 END)::numeric, 3) AS ssl_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_td,0) > COALESCE(loser_td,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS td_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_ctrl,0) > COALESCE(loser_ctrl,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS ctrl_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_kd,0) > COALESCE(loser_kd,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS kd_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_grd,0) > COALESCE(loser_grd,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS grd_pct,
        COUNT(*) AS rounds
      FROM round_winner_stats
    ),

    -- =============================================
    -- FEATURE 5: Pattern Breaks
    -- =============================================
    predicted_picks AS (
      SELECT
        fsp.fight_id, fsp.round, fsp.user_f1, fsp.user_f2,
        fsp.weight_class_clean,
        -- Weighted prediction score: positive = predicted f1, negative = predicted f2
        (CASE WHEN f1_ssl > f2_ssl THEN 1 WHEN f2_ssl > f1_ssl THEN -1 ELSE 0 END)::numeric * sf.ssl_pct
        + (CASE WHEN COALESCE(f1_td,0) > COALESCE(f2_td,0) THEN 1 WHEN COALESCE(f2_td,0) > COALESCE(f1_td,0) THEN -1 ELSE 0 END)::numeric * sf.td_pct
        + (CASE WHEN COALESCE(f1_ctrl,0) > COALESCE(f2_ctrl,0) THEN 1 WHEN COALESCE(f2_ctrl,0) > COALESCE(f1_ctrl,0) THEN -1 ELSE 0 END)::numeric * sf.ctrl_pct
        + (CASE WHEN COALESCE(f1_kd,0) > COALESCE(f2_kd,0) THEN 1 WHEN COALESCE(f2_kd,0) > COALESCE(f1_kd,0) THEN -1 ELSE 0 END)::numeric * sf.kd_pct
        + (CASE WHEN COALESCE(f1_grd,0) > COALESCE(f2_grd,0) THEN 1 WHEN COALESCE(f2_grd,0) > COALESCE(f1_grd,0) THEN -1 ELSE 0 END)::numeric * sf.grd_pct
        AS predicted_score,
        CASE WHEN user_f1 > user_f2 THEN 'f1' ELSE 'f2' END AS actual_pick,
        CASE WHEN user_f1 > user_f2 THEN 'f1' ELSE 'f2' END AS user_pick_label,
        -- For top_stat_against: which stat most disagreed with the user's pick
        fsp.f1_ssl, fsp.f2_ssl, fsp.f1_td, fsp.f2_td, fsp.f1_ctrl, fsp.f2_ctrl,
        fsp.f1_kd, fsp.f2_kd, fsp.f1_grd, fsp.f2_grd
      FROM fight_stats_pivoted fsp
      CROSS JOIN stat_fingerprint sf
      WHERE fsp.user_f1 != fsp.user_f2
        AND fsp.f1_ssl IS NOT NULL AND fsp.f2_ssl IS NOT NULL
    ),

    pattern_break_rounds AS (
      SELECT *,
        CASE
          WHEN predicted_score > 0 THEN 'f1'
          WHEN predicted_score < 0 THEN 'f2'
          ELSE NULL
        END AS predicted_pick
      FROM predicted_picks
      WHERE (predicted_score > 0 AND actual_pick = 'f2')
         OR (predicted_score < 0 AND actual_pick = 'f1')
    ),

    pattern_break_examples AS (
      SELECT
        pb.fight_id, pb.round, pb.predicted_pick, pb.actual_pick,
        pb.weight_class_clean,
        ur.fighter1_name, ur.fighter2_name, ur.fight_url,
        ABS(pb.predicted_score) AS confidence
      FROM pattern_break_rounds pb
      JOIN user_rounds ur ON ur.fight_id = pb.fight_id AND ur.round = pb.round
      ORDER BY ABS(pb.predicted_score) DESC
      LIMIT 5
    ),

    -- =============================================
    -- FEATURE 2: Stat-Score Disconnect
    -- =============================================
    stat_disconnect AS (
      SELECT
        fight_id, round, weight_class_clean,
        (CASE WHEN winner_ssl > loser_ssl THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(winner_td,0) > COALESCE(loser_td,0) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(winner_ctrl,0) > COALESCE(loser_ctrl,0) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(winner_kd,0) > COALESCE(loser_kd,0) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(winner_grd,0) > COALESCE(loser_grd,0) THEN 1 ELSE 0 END) AS winner_cats,
        (CASE WHEN loser_ssl > winner_ssl THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(loser_td,0) > COALESCE(winner_td,0) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(loser_ctrl,0) > COALESCE(winner_ctrl,0) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(loser_kd,0) > COALESCE(winner_kd,0) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(loser_grd,0) > COALESCE(winner_grd,0) THEN 1 ELSE 0 END) AS loser_cats
      FROM round_winner_stats
    ),

    disconnect_examples AS (
      SELECT
        sd.fight_id, sd.round, sd.winner_cats, sd.loser_cats,
        sd.weight_class_clean,
        ur.fighter1_name, ur.fighter2_name, ur.fight_url
      FROM stat_disconnect sd
      JOIN user_rounds ur ON ur.fight_id = sd.fight_id AND ur.round = sd.round
      WHERE sd.loser_cats > sd.winner_cats
      ORDER BY (sd.loser_cats - sd.winner_cats) DESC, sd.fight_id
      LIMIT 5
    ),

    -- =============================================
    -- FEATURE 3: Consistency Score
    -- =============================================
    -- Uses un-oriented fight_stats_pivoted: count how many stat categories f1 dominates,
    -- then check if user consistently picks the stat-dominant fighter.
    round_profiles AS (
      SELECT
        fight_id, round, user_f1, user_f2,
        (CASE WHEN f1_ssl > f2_ssl THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(f1_td,0) > COALESCE(f2_td,0) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(f1_ctrl,0) > COALESCE(f2_ctrl,0) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(f1_kd,0) > COALESCE(f2_kd,0) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(f1_grd,0) > COALESCE(f2_grd,0) THEN 1 ELSE 0 END) AS f1_dominant_cats,
        (CASE WHEN f2_ssl > f1_ssl THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(f2_td,0) > COALESCE(f1_td,0) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(f2_ctrl,0) > COALESCE(f1_ctrl,0) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(f2_kd,0) > COALESCE(f1_kd,0) THEN 1 ELSE 0 END)
        + (CASE WHEN COALESCE(f2_grd,0) > COALESCE(f1_grd,0) THEN 1 ELSE 0 END) AS f2_dominant_cats,
        -- Did user pick the fighter who dominates more stat categories?
        CASE
          WHEN (CASE WHEN f1_ssl > f2_ssl THEN 1 ELSE 0 END)
             + (CASE WHEN COALESCE(f1_td,0) > COALESCE(f2_td,0) THEN 1 ELSE 0 END)
             + (CASE WHEN COALESCE(f1_ctrl,0) > COALESCE(f2_ctrl,0) THEN 1 ELSE 0 END)
             + (CASE WHEN COALESCE(f1_kd,0) > COALESCE(f2_kd,0) THEN 1 ELSE 0 END)
             + (CASE WHEN COALESCE(f1_grd,0) > COALESCE(f2_grd,0) THEN 1 ELSE 0 END)
             >
             (CASE WHEN f2_ssl > f1_ssl THEN 1 ELSE 0 END)
             + (CASE WHEN COALESCE(f2_td,0) > COALESCE(f1_td,0) THEN 1 ELSE 0 END)
             + (CASE WHEN COALESCE(f2_ctrl,0) > COALESCE(f1_ctrl,0) THEN 1 ELSE 0 END)
             + (CASE WHEN COALESCE(f2_kd,0) > COALESCE(f1_kd,0) THEN 1 ELSE 0 END)
             + (CASE WHEN COALESCE(f2_grd,0) > COALESCE(f1_grd,0) THEN 1 ELSE 0 END)
             AND user_f1 > user_f2 THEN true
          WHEN (CASE WHEN f2_ssl > f1_ssl THEN 1 ELSE 0 END)
             + (CASE WHEN COALESCE(f2_td,0) > COALESCE(f1_td,0) THEN 1 ELSE 0 END)
             + (CASE WHEN COALESCE(f2_ctrl,0) > COALESCE(f1_ctrl,0) THEN 1 ELSE 0 END)
             + (CASE WHEN COALESCE(f2_kd,0) > COALESCE(f1_kd,0) THEN 1 ELSE 0 END)
             + (CASE WHEN COALESCE(f2_grd,0) > COALESCE(f1_grd,0) THEN 1 ELSE 0 END)
             >
             (CASE WHEN f1_ssl > f2_ssl THEN 1 ELSE 0 END)
             + (CASE WHEN COALESCE(f1_td,0) > COALESCE(f2_td,0) THEN 1 ELSE 0 END)
             + (CASE WHEN COALESCE(f1_ctrl,0) > COALESCE(f2_ctrl,0) THEN 1 ELSE 0 END)
             + (CASE WHEN COALESCE(f1_kd,0) > COALESCE(f2_kd,0) THEN 1 ELSE 0 END)
             + (CASE WHEN COALESCE(f1_grd,0) > COALESCE(f2_grd,0) THEN 1 ELSE 0 END)
             AND user_f2 > user_f1 THEN true
          ELSE false
        END AS picked_stat_dominant
      FROM fight_stats_pivoted
      WHERE user_f1 != user_f2
        AND f1_ssl IS NOT NULL AND f2_ssl IS NOT NULL
    ),

    -- Bucket by dominant_cats (the higher of f1/f2 dominant count = 3,4,5)
    consistency_buckets AS (
      SELECT
        GREATEST(f1_dominant_cats, f2_dominant_cats) AS dominant_cats,
        COUNT(*) AS rounds_in_bucket,
        ROUND(AVG(CASE WHEN picked_stat_dominant THEN 1.0 ELSE 0.0 END)::numeric, 3) AS picked_dominant_pct
      FROM round_profiles
      WHERE f1_dominant_cats != f2_dominant_cats  -- exclude perfectly tied rounds
      GROUP BY GREATEST(f1_dominant_cats, f2_dominant_cats)
    ),

    -- =============================================
    -- FEATURE 1: Round-by-Round Drift
    -- =============================================
    -- 1a: Accuracy per round number
    drift_by_round AS (
      SELECT
        ra.round,
        COUNT(*) AS cnt,
        ROUND(AVG(CASE WHEN user_winner = majority_winner THEN 1.0 ELSE 0.0 END)::numeric, 3) AS accuracy
      FROM round_accuracy ra
      WHERE majority_winner IS NOT NULL
      GROUP BY ra.round
      ORDER BY ra.round
    ),

    -- 1b: Momentum — in 3+ round fights, when user gave R1+R2 to same fighter, did they continue in R3?
    fight_round_picks AS (
      SELECT
        fight_id,
        round,
        CASE WHEN user_f1 > user_f2 THEN 'f1' WHEN user_f2 > user_f1 THEN 'f2' ELSE 'draw' END AS pick
      FROM user_rounds
      WHERE user_f1 != user_f2
    ),

    momentum_fights AS (
      SELECT
        r1.fight_id,
        r1.pick AS r1_pick,
        r2.pick AS r2_pick,
        r3.pick AS r3_pick
      FROM fight_round_picks r1
      JOIN fight_round_picks r2 ON r2.fight_id = r1.fight_id AND r2.round = 2
      JOIN fight_round_picks r3 ON r3.fight_id = r1.fight_id AND r3.round = 3
      WHERE r1.round = 1
        AND r1.pick != 'draw' AND r2.pick != 'draw' AND r3.pick != 'draw'
        AND r1.pick = r2.pick  -- user gave R1 and R2 to the same fighter
    ),

    -- =============================================
    -- TIER 2/3: Gender and weight class group splits
    -- =============================================
    fingerprint_mens AS (
      SELECT
        ROUND(AVG(CASE WHEN winner_ssl > loser_ssl THEN 1.0 ELSE 0.0 END)::numeric, 3) AS ssl_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_td,0) > COALESCE(loser_td,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS td_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_ctrl,0) > COALESCE(loser_ctrl,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS ctrl_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_kd,0) > COALESCE(loser_kd,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS kd_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_grd,0) > COALESCE(loser_grd,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS grd_pct,
        COUNT(*) AS rounds
      FROM round_winner_stats
      WHERE weight_class_clean NOT ILIKE 'Women%%'
    ),

    fingerprint_womens AS (
      SELECT
        ROUND(AVG(CASE WHEN winner_ssl > loser_ssl THEN 1.0 ELSE 0.0 END)::numeric, 3) AS ssl_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_td,0) > COALESCE(loser_td,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS td_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_ctrl,0) > COALESCE(loser_ctrl,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS ctrl_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_kd,0) > COALESCE(loser_kd,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS kd_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_grd,0) > COALESCE(loser_grd,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS grd_pct,
        COUNT(*) AS rounds
      FROM round_winner_stats
      WHERE weight_class_clean ILIKE 'Women%%'
    ),

    fingerprint_by_group AS (
      SELECT
        CASE
          WHEN weight_class_clean ILIKE 'Women%%Strawweight%%' OR weight_class_clean ILIKE 'Women%%Flyweight%%' THEN 'W-Straw+Fly'
          WHEN weight_class_clean ILIKE 'Women%%Bantamweight%%' OR weight_class_clean ILIKE 'Women%%Featherweight%%' THEN 'W-BW+FW'
          WHEN weight_class_clean ILIKE '%%Flyweight%%' AND weight_class_clean NOT ILIKE 'Women%%' THEN 'Fly+BW'
          WHEN weight_class_clean ILIKE '%%Bantamweight%%' AND weight_class_clean NOT ILIKE 'Women%%' THEN 'Fly+BW'
          WHEN weight_class_clean ILIKE '%%Featherweight%%' AND weight_class_clean NOT ILIKE 'Women%%' THEN 'FW+LW'
          WHEN weight_class_clean ILIKE '%%Lightweight%%' AND weight_class_clean NOT ILIKE 'Women%%' THEN 'FW+LW'
          WHEN weight_class_clean ILIKE '%%Welterweight%%' THEN 'WW+MW'
          WHEN weight_class_clean ILIKE '%%Middleweight%%' THEN 'WW+MW'
          WHEN weight_class_clean ILIKE '%%Light Heavyweight%%' THEN 'LHW+HW'
          WHEN weight_class_clean ILIKE '%%Heavyweight%%' AND weight_class_clean NOT ILIKE '%%Light%%' THEN 'LHW+HW'
          ELSE 'Other'
        END AS weight_class_group,
        ROUND(AVG(CASE WHEN winner_ssl > loser_ssl THEN 1.0 ELSE 0.0 END)::numeric, 3) AS ssl_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_td,0) > COALESCE(loser_td,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS td_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_ctrl,0) > COALESCE(loser_ctrl,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS ctrl_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_kd,0) > COALESCE(loser_kd,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS kd_pct,
        ROUND(AVG(CASE WHEN COALESCE(winner_grd,0) > COALESCE(loser_grd,0) THEN 1.0 ELSE 0.0 END)::numeric, 3) AS grd_pct,
        COUNT(*) AS rounds
      FROM round_winner_stats
      GROUP BY 1
      HAVING COUNT(*) >= 15
    )

    -- =============================================
    -- FINAL JSON BUILD
    -- =============================================
    SELECT json_build_object(
      'tier', CASE
        WHEN (SELECT total_stat_rounds FROM tier_info) >= 80
          AND (SELECT mens_rounds FROM tier_info) >= 15
          AND (SELECT womens_rounds FROM tier_info) >= 15
          AND (SELECT COUNT(*) FROM tier_groups) >= 3
        THEN 3
        WHEN (SELECT total_stat_rounds FROM tier_info) >= 40
          AND (SELECT mens_rounds FROM tier_info) >= 15
          AND (SELECT womens_rounds FROM tier_info) >= 15
        THEN 2
        ELSE 1
      END,
      'rounds_with_stats', (SELECT total_stat_rounds FROM tier_info),

      'tier2_progress', json_build_object(
        'mens', (SELECT mens_rounds FROM tier_info),
        'womens', (SELECT womens_rounds FROM tier_info),
        'mens_needed', 15,
        'womens_needed', 15,
        'total_needed', 40
      ),
      'tier3_progress', json_build_object(
        'qualifying_groups', (SELECT COUNT(*) FROM tier_groups),
        'groups_needed', 3,
        'total_needed', 80
      ),

      -- Feature 4: Fingerprint
      'fingerprint', (
        SELECT json_build_object(
          'ssl_pct', ssl_pct, 'td_pct', td_pct, 'ctrl_pct', ctrl_pct,
          'kd_pct', kd_pct, 'grd_pct', grd_pct, 'rounds', rounds,
          'ranked', (
            SELECT json_agg(r ORDER BY r.pct DESC)
            FROM (
              SELECT 'ssl' AS stat, 'Sig Strikes' AS label, ssl_pct AS pct FROM stat_fingerprint
              UNION ALL SELECT 'td', 'Takedowns', td_pct FROM stat_fingerprint
              UNION ALL SELECT 'ctrl', 'Control Time', ctrl_pct FROM stat_fingerprint
              UNION ALL SELECT 'kd', 'Knockdowns', kd_pct FROM stat_fingerprint
              UNION ALL SELECT 'grd', 'Ground Strikes', grd_pct FROM stat_fingerprint
            ) r
          )
        )
        FROM stat_fingerprint
      ),

      -- Feature 5: Pattern Breaks
      'pattern_breaks', json_build_object(
        'rate', (
          SELECT ROUND(
            COUNT(*) FILTER (WHERE
              (predicted_score > 0 AND actual_pick = 'f2')
              OR (predicted_score < 0 AND actual_pick = 'f1')
            )::numeric / NULLIF(COUNT(*), 0), 3
          )
          FROM predicted_picks
        ),
        'count', (SELECT COUNT(*) FROM pattern_break_rounds),
        'total', (SELECT COUNT(*) FROM predicted_picks),
        'examples', COALESCE((
          SELECT json_agg(json_build_object(
            'fight_id', fight_id, 'fight_url', fight_url,
            'round', round, 'fighter1_name', fighter1_name,
            'fighter2_name', fighter2_name,
            'predicted_pick', predicted_pick, 'actual_pick', actual_pick,
            'weight_class_clean', weight_class_clean
          ))
          FROM pattern_break_examples
        ), '[]'::json)
      ),

      -- Feature 2: Stat-Score Disconnect
      'disconnect', json_build_object(
        'rate', (
          SELECT ROUND(
            COUNT(*) FILTER (WHERE loser_cats > winner_cats)::numeric / NULLIF(COUNT(*), 0), 3
          )
          FROM stat_disconnect
        ),
        'count', (SELECT COUNT(*) FROM stat_disconnect WHERE loser_cats > winner_cats),
        'total', (SELECT COUNT(*) FROM stat_disconnect),
        'examples', COALESCE((
          SELECT json_agg(json_build_object(
            'fight_id', fight_id, 'fight_url', fight_url,
            'round', round, 'fighter1_name', fighter1_name,
            'fighter2_name', fighter2_name,
            'winner_cats', winner_cats, 'loser_cats', loser_cats,
            'weight_class_clean', weight_class_clean
          ))
          FROM disconnect_examples
        ), '[]'::json)
      ),

      -- Feature 3: Consistency
      'consistency', json_build_object(
        'score', (
          SELECT ROUND(
            SUM(GREATEST(picked_dominant_pct, 1.0 - picked_dominant_pct) * rounds_in_bucket)::numeric
            / NULLIF(SUM(rounds_in_bucket), 0), 3
          )
          FROM consistency_buckets
        ),
        'buckets', COALESCE((
          SELECT json_agg(json_build_object(
            'dominant_cats', dominant_cats,
            'rounds', rounds_in_bucket,
            'picked_dominant_pct', picked_dominant_pct
          ) ORDER BY dominant_cats DESC)
          FROM consistency_buckets
        ), '[]'::json)
      ),

      -- Feature 1: Drift
      'drift', json_build_object(
        'by_round', COALESCE((
          SELECT json_agg(json_build_object(
            'round', round, 'accuracy', accuracy, 'count', cnt
          ) ORDER BY round)
          FROM drift_by_round
        ), '[]'::json),
        'momentum_rate', (
          SELECT ROUND(
            COUNT(*) FILTER (WHERE r3_pick = r1_pick)::numeric / NULLIF(COUNT(*), 0), 3
          )
          FROM momentum_fights
        ),
        'momentum_sample', (SELECT COUNT(*) FROM momentum_fights)
      ),

      -- Tier 2: Gender fingerprints (null if tier < 2)
      'fingerprint_mens', CASE
        WHEN (SELECT mens_rounds FROM tier_info) >= 15 AND (SELECT womens_rounds FROM tier_info) >= 15
          AND (SELECT total_stat_rounds FROM tier_info) >= 40
        THEN (SELECT json_build_object(
          'ssl_pct', ssl_pct, 'td_pct', td_pct, 'ctrl_pct', ctrl_pct,
          'kd_pct', kd_pct, 'grd_pct', grd_pct, 'rounds', rounds
        ) FROM fingerprint_mens)
        ELSE NULL
      END,

      'fingerprint_womens', CASE
        WHEN (SELECT mens_rounds FROM tier_info) >= 15 AND (SELECT womens_rounds FROM tier_info) >= 15
          AND (SELECT total_stat_rounds FROM tier_info) >= 40
        THEN (SELECT json_build_object(
          'ssl_pct', ssl_pct, 'td_pct', td_pct, 'ctrl_pct', ctrl_pct,
          'kd_pct', kd_pct, 'grd_pct', grd_pct, 'rounds', rounds
        ) FROM fingerprint_womens)
        ELSE NULL
      END,

      -- Tier 3: Per-group fingerprints (null if tier < 3)
      'fingerprint_by_group', CASE
        WHEN (SELECT total_stat_rounds FROM tier_info) >= 80
          AND (SELECT mens_rounds FROM tier_info) >= 15
          AND (SELECT womens_rounds FROM tier_info) >= 15
          AND (SELECT COUNT(*) FROM tier_groups) >= 3
        THEN COALESCE((
          SELECT json_agg(json_build_object(
            'group', weight_class_group,
            'ssl_pct', ssl_pct, 'td_pct', td_pct, 'ctrl_pct', ctrl_pct,
            'kd_pct', kd_pct, 'grd_pct', grd_pct, 'rounds', rounds
          ) ORDER BY rounds DESC)
          FROM fingerprint_by_group
        ), '[]'::json)
        ELSE NULL
      END
    )
  );
END;
$$;

-- Grant access to authenticated users only
GRANT EXECUTE ON FUNCTION get_scoring_insights() TO authenticated;
"""

resp = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": SQL}, timeout=30)
if resp.ok:
    print("✅ get_scoring_insights deployed successfully")
else:
    print(f"❌ Error {resp.status_code}: {resp.text}")
