"""
deploy_community_scorecard.py — Deploy get_community_scorecard(p_fight_id) RPC.

Returns the community's average per-round scorecard for a fight: per round, the
mean f1/f2 score across ALL users plus the contributing user count. Output is
aggregate-only (no user_id) so anon access is intentional — this powers the public
"community scorecard" comparison in ScorecardComparison.js. That is why this
function is NOT in the S-P2-9 anon-revoke set.

This script was reconstructed 2026-05-31 (S-P2-8): the function existed live but
had no version-controlled deploy script, so its search_path could never be
hardened on redeploy. CREATE OR REPLACE preserves existing grants; the explicit
GRANTs below document the intended public surface for a fresh environment.

Run:
    python supabase/deploy_community_scorecard.py
Requires: REACT_APP_SUPABASE_URL and SUPABASE_MANAGEMENT_KEY in .env
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
CREATE OR REPLACE FUNCTION public.get_community_scorecard(p_fight_id bigint)
RETURNS TABLE(round integer, f1_avg numeric, f2_avg numeric, user_count integer)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    round,
    ROUND(AVG(f1_score)::numeric, 1) AS f1_avg,
    ROUND(AVG(f2_score)::numeric, 1) AS f2_avg,
    COUNT(*)::integer                AS user_count
  FROM user_round_scores
  WHERE fight_id = p_fight_id
  GROUP BY round
  ORDER BY round;
$$;

-- Aggregate-only output (no user_id) — intentionally public.
GRANT EXECUTE ON FUNCTION public.get_community_scorecard(bigint) TO anon, authenticated;
"""

resp = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": SQL}, timeout=30)
if resp.ok:
    print("✅ get_community_scorecard deployed successfully")
else:
    print(f"❌ Error {resp.status_code}: {resp.text}")
    sys.exit(1)
