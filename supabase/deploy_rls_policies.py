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
  - fight_ratings           (public read only — one policy)

Public data tables (fights, fight_meta_details, etc.) need no RLS change —
their data is public, and the scraper writes via service key which bypasses RLS.

fight_ratings: aggregate vote counts, public to read. RLS is ON with a single
read-everything SELECT policy and no write policies, so API roles can't write it.
The update_fight_ratings() trigger on user_votes still writes it because the function
is SECURITY DEFINER (runs as postgres). S-P2-10 (2026-10-18) dropped the duplicate
"Public Read Ratings" policy; this script keeps it dropped.

After deploying, the script verifies fight_ratings has exactly one SELECT policy and
that the anon key can still read it (the vote counts on every fight card).
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
-- The update_fight_ratings trigger fires on mutations here and
-- recounts into fight_ratings. It is SECURITY DEFINER, so it
-- writes past fight_ratings' RLS (see deploy_triggers.py).
-- ============================================================
ALTER TABLE user_votes ENABLE ROW LEVEL SECURITY;

-- Strip legacy permissive policies left over from before the April 2026 migration
-- (audit memory/audits/2026-05-16/01-security.md §2). The "Votes are viewable by
-- everyone" policy had qual=true and OR-combined with user_votes_select_own,
-- effectively leaking every user's vote history. DROP IF EXISTS keeps this idempotent.
DROP POLICY IF EXISTS "Votes are viewable by everyone" ON user_votes;
DROP POLICY IF EXISTS "Authenticated users can vote"   ON user_votes;
DROP POLICY IF EXISTS "Users can update own vote"      ON user_votes;
DROP POLICY IF EXISTS "Users can delete own vote"      ON user_votes;

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


-- ============================================================
-- fight_ratings
-- Public aggregate counts: anyone reads, nobody writes via the API.
-- ============================================================
ALTER TABLE fight_ratings ENABLE ROW LEVEL SECURITY;

-- S-P2-10: exact duplicate of the policy below (both SELECT, qual true, role public).
DROP POLICY IF EXISTS "Public Read Ratings" ON fight_ratings;

DROP POLICY IF EXISTS "Enable read access for all users" ON fight_ratings;
CREATE POLICY "Enable read access for all users"
  ON fight_ratings FOR SELECT
  USING (true);
"""

print("Deploying RLS policies to Supabase...")
r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": RLS_SQL}, timeout=30)

if r.ok:
    print("✅ RLS enabled and policies applied to:")
    print("   - user_round_scores      (select/insert/update/delete: own rows only)")
    print("   - user_fight_scorecard_state (select/insert/update/delete: own rows only)")
    print("   - user_votes             (select/insert/update/delete: own rows only)")
    print("   - profiles               (select/insert/update/delete: own rows only)")
    print("   - fight_ratings          (select: everyone; no write policies)")
    print()
    print("⚠️  Verify the app still works:")
    print("   1. Log in and score a round — should still save correctly")
    print("   2. Load your Judging DNA — should still load your profile")
    print("   3. Vote on a fight — should still register")
    print("   4. Try querying user_round_scores unauthenticated — should now return 0 rows")
else:
    print(f"❌ RLS deployment failed {r.status_code}: {r.text}")
    sys.exit(1)

print("\nVerifying fight_ratings...")
v = requests.post(MGMT_QUERY_URL, headers=HEADERS, timeout=30, json={"query": """
    SELECT policyname, cmd, qual FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'fight_ratings' ORDER BY policyname;
"""})
v.raise_for_status()
policies = v.json()
print("   policies:", [(p["policyname"], p["cmd"], p["qual"]) for p in policies])
ok_policies = [(p["policyname"], p["cmd"], p["qual"]) for p in policies] == [("Enable read access for all users", "SELECT", "true")]

# The anon key is what every guest (and the fight cards) reads vote counts with.
anon_key = os.environ.get("REACT_APP_SUPABASE_ANON_KEY", "")
a = requests.get(f"{supabase_url}/rest/v1/fight_ratings?select=fight_id&limit=1",
                 headers={"apikey": anon_key, "Authorization": f"Bearer {anon_key}"}, timeout=30)
anon_rows = len(a.json()) if a.ok else 0
print(f"   anon read: HTTP {a.status_code}, {anon_rows} row(s)")

if not ok_policies or anon_rows != 1:
    print("\n❌ VERIFY FAILED — check the output above.")
    sys.exit(1)
print("✅ fight_ratings: one public read policy, anon can read.")
