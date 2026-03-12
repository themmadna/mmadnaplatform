"""
deploy_judge_comparison.py — Deploy get_judge_comparison(p_judge1, p_judge2) RPC.

Run once:
    python supabase/deploy_judge_comparison.py
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
CREATE OR REPLACE FUNCTION get_judge_comparison(p_judge1 text, p_judge2 text)
RETURNS json
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
  RETURN (
    WITH

    -- 1. Pivot each judge's scores to (bout, date, round) → f1_score / f2_score.
    judge1_pivoted AS (
      SELECT
        bout, date, round,
        MAX(CASE WHEN LOWER(TRIM(fighter)) = LOWER(TRIM(SPLIT_PART(bout, ' vs ', 1))) THEN score END) AS f1,
        MAX(CASE WHEN LOWER(TRIM(fighter)) = LOWER(TRIM(SPLIT_PART(bout, ' vs ', 2))) THEN score END) AS f2
      FROM judge_scores
      WHERE judge = p_judge1
      GROUP BY bout, date, round
      HAVING
        MAX(CASE WHEN LOWER(TRIM(fighter)) = LOWER(TRIM(SPLIT_PART(bout, ' vs ', 1))) THEN score END) IS NOT NULL
        AND MAX(CASE WHEN LOWER(TRIM(fighter)) = LOWER(TRIM(SPLIT_PART(bout, ' vs ', 2))) THEN score END) IS NOT NULL
    ),

    judge2_pivoted AS (
      SELECT
        bout, date, round,
        MAX(CASE WHEN LOWER(TRIM(fighter)) = LOWER(TRIM(SPLIT_PART(bout, ' vs ', 1))) THEN score END) AS f1,
        MAX(CASE WHEN LOWER(TRIM(fighter)) = LOWER(TRIM(SPLIT_PART(bout, ' vs ', 2))) THEN score END) AS f2
      FROM judge_scores
      WHERE judge = p_judge2
      GROUP BY bout, date, round
      HAVING
        MAX(CASE WHEN LOWER(TRIM(fighter)) = LOWER(TRIM(SPLIT_PART(bout, ' vs ', 1))) THEN score END) IS NOT NULL
        AND MAX(CASE WHEN LOWER(TRIM(fighter)) = LOWER(TRIM(SPLIT_PART(bout, ' vs ', 2))) THEN score END) IS NOT NULL
    ),

    -- 2. Rounds both judges scored.
    shared AS (
      SELECT
        j1.bout,
        j1.date,
        j1.round,
        CASE WHEN j1.f1 > j1.f2 THEN 'f1' WHEN j1.f2 > j1.f1 THEN 'f2' ELSE 'draw' END AS j1_winner,
        CASE WHEN j2.f1 > j2.f2 THEN 'f1' WHEN j2.f2 > j2.f1 THEN 'f2' ELSE 'draw' END AS j2_winner
      FROM judge1_pivoted j1
      JOIN judge2_pivoted j2
        ON  j2.bout  = j1.bout
        AND j2.date  = j1.date
        AND j2.round = j1.round
    ),

    -- 3. Shared rounds where neither judge scored a draw (scoreable rounds).
    scoreable AS (
      SELECT * FROM shared
      WHERE j1_winner != 'draw' AND j2_winner != 'draw'
    ),

    -- 4. Per-fight disagreement tallies (for top_disagreements list).
    fight_disagreements AS (
      SELECT
        bout,
        date AS fight_date,
        COUNT(*) FILTER (WHERE j1_winner != j2_winner) AS disagreement_rounds,
        COUNT(*)                                        AS scored_rounds
      FROM scoreable
      GROUP BY bout, date
      HAVING COUNT(*) FILTER (WHERE j1_winner != j2_winner) > 0
    )

    SELECT json_build_object(

      'shared_rounds',     (SELECT COUNT(*) FROM scoreable),
      'shared_fights',     (SELECT COUNT(DISTINCT (bout, date)) FROM scoreable),

      -- % of shared scored rounds where they picked different fighters
      'disagreement_rate', (
        SELECT ROUND(
          AVG(CASE WHEN j1_winner != j2_winner THEN 1.0 ELSE 0.0 END)::numeric, 3
        )
        FROM scoreable
      ),

      -- Top 5 fights with the most disagreement rounds
      'top_disagreements', (
        SELECT json_agg(t ORDER BY t.disagreement_rounds DESC, t.fight_date DESC)
        FROM (
          SELECT bout, fight_date, disagreement_rounds, scored_rounds
          FROM fight_disagreements
          ORDER BY disagreement_rounds DESC, fight_date DESC
          LIMIT 5
        ) t
      )
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_judge_comparison(text, text) TO anon, authenticated;
"""

resp = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": SQL}, timeout=30)
if resp.ok:
    print("✅ get_judge_comparison deployed successfully")
else:
    print(f"❌ Error {resp.status_code}: {resp.text}")
