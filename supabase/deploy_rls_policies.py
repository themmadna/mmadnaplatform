"""
deploy_rls_policies.py — Enable Row Level Security on all user-data tables.

Confirmed gap: RLS was not enabled on user_round_scores (and likely other user tables).
Any authenticated user with the anon key could read any other user's scoring data.

Run once:
    python supabase/deploy_rls_policies.py

Tables this script secures:
  - user_round_scores       (private: own rounds only)
  - user_fight_scorecard_state (private: own scorecard state only)
  - user_votes              (private: own votes only)
  - profiles                (private: own profile only)

Public data tables (fights, fight_meta_details, etc.) need no RLS change —
their data is public, and the scraper writes via service key which bypasses RLS.

fight_ratings is intentionally excluded: it is maintained by a trigger on user_votes.
Enabling RLS on fight_ratings risks breaking the trigger. Its data (aggregate counts)
is not user-private and does not require RLS.
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

RLS_SQL = """
-- ============================================================
-- user_round_scores
-- Each user can only read/write their own round scores.
-- ============================================================
ALTER TABLE user_round_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_round_scores_select_own" ON user_round_scores;
CREATE POLICY "user_round_scores_select_own"
  ON user_round_scores FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_round_scores_insert_own" ON user_round_scores;
CREATE POLICY "user_round_scores_insert_own"
  ON user_round_scores FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_round_scores_update_own" ON user_round_scores;
CREATE POLICY "user_round_scores_update_own"
  ON user_round_scores FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_round_scores_delete_own" ON user_round_scores;
CREATE POLICY "user_round_scores_delete_own"
  ON user_round_scores FOR DELETE
  USING (user_id = auth.uid());


-- ============================================================
-- user_fight_scorecard_state
-- Each user can only read/write their own scorecard state.
-- ============================================================
ALTER TABLE user_fight_scorecard_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ufss_select_own" ON user_fight_scorecard_state;
CREATE POLICY "ufss_select_own"
  ON user_fight_scorecard_state FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "ufss_insert_own" ON user_fight_scorecard_state;
CREATE POLICY "ufss_insert_own"
  ON user_fight_scorecard_state FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ufss_update_own" ON user_fight_scorecard_state;
CREATE POLICY "ufss_update_own"
  ON user_fight_scorecard_state FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ufss_delete_own" ON user_fight_scorecard_state;
CREATE POLICY "ufss_delete_own"
  ON user_fight_scorecard_state FOR DELETE
  USING (user_id = auth.uid());


-- ============================================================
-- user_votes
-- Each user can only read/write their own votes.
-- The update_fight_ratings trigger fires on mutations here;
-- it updates fight_ratings (no RLS) and runs in the user's
-- session context — no SECURITY DEFINER change needed.
-- ============================================================
ALTER TABLE user_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_votes_select_own" ON user_votes;
CREATE POLICY "user_votes_select_own"
  ON user_votes FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "user_votes_insert_own" ON user_votes;
CREATE POLICY "user_votes_insert_own"
  ON user_votes FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_votes_update_own" ON user_votes;
CREATE POLICY "user_votes_update_own"
  ON user_votes FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "user_votes_delete_own" ON user_votes;
CREATE POLICY "user_votes_delete_own"
  ON user_votes FOR DELETE
  USING (user_id = auth.uid());


-- ============================================================
-- profiles
-- Each user can only read/write their own profile row.
-- ============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_own" ON profiles;
CREATE POLICY "profiles_select_own"
  ON profiles FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "profiles_insert_own" ON profiles;
CREATE POLICY "profiles_insert_own"
  ON profiles FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "profiles_update_own" ON profiles;
CREATE POLICY "profiles_update_own"
  ON profiles FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "profiles_delete_own" ON profiles;
CREATE POLICY "profiles_delete_own"
  ON profiles FOR DELETE
  USING (user_id = auth.uid());
"""

print("Deploying RLS policies to Supabase...")
r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": RLS_SQL}, timeout=30)

if r.ok:
    print("✅ RLS enabled and policies applied to:")
    print("   - user_round_scores      (select/insert/update/delete: own rows only)")
    print("   - user_fight_scorecard_state (select/insert/update/delete: own rows only)")
    print("   - user_votes             (select/insert/update/delete: own rows only)")
    print("   - profiles               (select/insert/update/delete: own rows only)")
    print()
    print("⚠️  Verify the app still works:")
    print("   1. Log in and score a round — should still save correctly")
    print("   2. Load your Judging DNA — should still load your profile")
    print("   3. Vote on a fight — should still register")
    print("   4. Try querying user_round_scores unauthenticated — should now return 0 rows")
else:
    print(f"❌ RLS deployment failed {r.status_code}: {r.text}")
    sys.exit(1)
