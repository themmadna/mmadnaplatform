"""
deploy_judge_directory.py — Deploy get_judge_directory() RPC to Supabase.

Run once:
    python supabase/deploy_judge_directory.py
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
CREATE OR REPLACE FUNCTION get_judge_directory()
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN (
    WITH

    -- 1. Pivot each (bout, date, round, judge) to one row with f1/f2 scores.
    --    Fighter assignment: exact name match against the bout string split on ' vs '.
    --    Both names come from mmadecisions so they should be consistent within that source.
    pivoted AS (
      SELECT
        js.bout,
        js.date,
        js.round,
        js.judge,
        MAX(CASE
          WHEN LOWER(TRIM(js.fighter)) = LOWER(TRIM(SPLIT_PART(js.bout, ' vs ', 1)))
          THEN js.score END) AS f1_score,
        MAX(CASE
          WHEN LOWER(TRIM(js.fighter)) = LOWER(TRIM(SPLIT_PART(js.bout, ' vs ', 2)))
          THEN js.score END) AS f2_score
      FROM judge_scores js
      GROUP BY js.bout, js.date, js.round, js.judge
    ),

    -- 2. Keep only rows where both fighters were matched (complete pairs).
    complete AS (
      SELECT * FROM pivoted
      WHERE f1_score IS NOT NULL AND f2_score IS NOT NULL
    ),

    -- 3. Per (bout, date, round): tally how many judges voted for each fighter.
    round_votes AS (
      SELECT
        bout,
        date,
        round,
        SUM(CASE WHEN f1_score > f2_score THEN 1 ELSE 0 END) AS f1_votes,
        SUM(CASE WHEN f2_score > f1_score THEN 1 ELSE 0 END) AS f2_votes,
        COUNT(*) AS judge_count
      FROM complete
      GROUP BY bout, date, round
    ),

    -- 4. Per (judge, bout, date, round): flag lone dissenters.
    --    Outlier = this judge was the ONLY one who picked a fighter (0 others agreed).
    --    Drawn rounds (10-10) are excluded from outlier logic.
    judge_decisions AS (
      SELECT
        c.judge,
        c.bout,
        c.date,
        c.round,
        c.f1_score,
        c.f2_score,
        CASE
          WHEN c.f1_score = c.f2_score THEN FALSE
          WHEN c.f1_score > c.f2_score AND rv.f1_votes = 1 THEN TRUE
          WHEN c.f2_score > c.f1_score AND rv.f2_votes = 1 THEN TRUE
          ELSE FALSE
        END AS is_outlier
      FROM complete c
      JOIN round_votes rv
        ON  rv.bout  = c.bout
        AND rv.date  = c.date
        AND rv.round = c.round
      WHERE rv.judge_count >= 2
    ),

    -- 5. Aggregate stats per judge. Minimum 50 rounds to appear in the directory.
    judge_stats AS (
      SELECT
        judge AS name,
        COUNT(*)                                                                        AS rounds_judged,
        COUNT(DISTINCT (bout, date))                                                   AS fights_judged,
        ROUND(AVG(CASE WHEN is_outlier THEN 1.0 ELSE 0.0 END)::numeric, 3)            AS outlier_rate,
        ROUND(AVG(CASE
          WHEN LEAST(f1_score, f2_score) <= 8 AND f1_score != f2_score
          THEN 1.0 ELSE 0.0 END)::numeric, 3)                                         AS ten_eight_rate,
        MAX(date)                                                                      AS last_active
      FROM judge_decisions
      GROUP BY judge
      HAVING COUNT(*) >= 50
    )

    SELECT json_agg(
      json_build_object(
        'name',           name,
        'rounds_judged',  rounds_judged,
        'fights_judged',  fights_judged,
        'outlier_rate',   outlier_rate,
        'ten_eight_rate', ten_eight_rate,
        'last_active',    last_active
      )
      ORDER BY rounds_judged DESC
    )
    FROM judge_stats
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_judge_directory() TO anon, authenticated;
"""

resp = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": SQL}, timeout=30)
if resp.ok:
    print("✅ get_judge_directory deployed successfully")
else:
    print(f"❌ Error {resp.status_code}: {resp.text}")
