"""
deploy_triggers.py — version-controls and deploys database triggers.

Currently manages:
  - update_fight_ratings() trigger on user_votes
  - drops sync_fight_ratings, an unscripted duplicate trigger that fired the same
    recount a second time on every vote (found 2026-10-18)
  - S-P2-14: EXECUTE on update_fight_ratings() revoked from PUBLIC/anon/authenticated —
    only the trigger machinery calls it, and Postgres doesn't check EXECUTE when a
    trigger fires (only at CREATE TRIGGER, run here as postgres)

After deploying, a smoke test casts a vote as a real user inside a transaction that is
always rolled back, and checks fight_ratings moves by exactly 1 — a broken permission
would show up as an error or delta 0. (A duplicate trigger would NOT show here: each
recounts from scratch. The trigger-list check catches that.)

Run: python supabase/deploy_triggers.py
Requires: REACT_APP_SUPABASE_URL and SUPABASE_MANAGEMENT_KEY in .env
"""

import re
import sys
import os
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

url      = os.environ.get("REACT_APP_SUPABASE_URL", "")
mgmt_key = os.environ.get("SUPABASE_MANAGEMENT_KEY", "")

if not url or not mgmt_key:
    raise SystemExit("Missing REACT_APP_SUPABASE_URL or SUPABASE_MANAGEMENT_KEY in .env")

# Extract project ref from URL (https://<ref>.supabase.co)
project_ref = url.replace("https://", "").split(".")[0]
api_url = f"https://api.supabase.com/v1/projects/{project_ref}/database/query"
headers = {"Authorization": f"Bearer {mgmt_key}", "Content-Type": "application/json"}

# ── SQL ────────────────────────────────────────────────────────────────────────

UPDATE_FIGHT_RATINGS_SQL = """
-- Trigger function: update_fight_ratings
-- Fires AFTER INSERT, UPDATE, or DELETE on user_votes.
-- Recounts all vote types for the affected fight_id and upserts
-- the result into fight_ratings. Silent update — no error if fight
-- has no entry yet in fight_ratings (INSERT handles the first vote).

BEGIN;

CREATE OR REPLACE FUNCTION update_fight_ratings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_fight_id bigint;
BEGIN
  -- On DELETE use OLD; on INSERT/UPDATE use NEW
  IF TG_OP = 'DELETE' THEN
    target_fight_id := OLD.fight_id;
  ELSE
    target_fight_id := NEW.fight_id;
  END IF;

  INSERT INTO fight_ratings (fight_id, likes_count, dislikes_count, favorites_count)
  SELECT
    target_fight_id,
    COUNT(*) FILTER (WHERE vote_type = 'like'),
    COUNT(*) FILTER (WHERE vote_type = 'dislike'),
    COUNT(*) FILTER (WHERE vote_type = 'favorite')
  FROM user_votes
  WHERE fight_id = target_fight_id
  ON CONFLICT (fight_id) DO UPDATE SET
    likes_count      = EXCLUDED.likes_count,
    dislikes_count   = EXCLUDED.dislikes_count,
    favorites_count  = EXCLUDED.favorites_count;

  RETURN NULL;
END;
$$;

-- Re-attach trigger (idempotent)
DROP TRIGGER IF EXISTS update_fight_ratings_trigger ON user_votes;
CREATE TRIGGER update_fight_ratings_trigger
  AFTER INSERT OR UPDATE OR DELETE ON user_votes
  FOR EACH ROW
  EXECUTE FUNCTION update_fight_ratings();

-- Unscripted duplicate of the trigger above (same function, same events).
DROP TRIGGER IF EXISTS sync_fight_ratings ON user_votes;

-- S-P2-14. CREATE OR REPLACE keeps an existing ACL, but a fresh CREATE grants PUBLIC
-- EXECUTE by default — so the revoke lives here, after every (re)create.
REVOKE EXECUTE ON FUNCTION update_fight_ratings() FROM PUBLIC, anon, authenticated;

COMMIT;
"""

# The allowlisted user in src/featureFlags.js — the smoke test votes as them.
TEST_USER = '92ece4d5-d62d-48e3-988d-6d25c22152f2'

# Always raises: the result rides out on the error and the vote is rolled back.
SMOKE_TEST_SQL = f"""
DO $smoke$
DECLARE
  U uuid := '{TEST_USER}';
  f bigint;
  before_likes int;
  after_likes int;
BEGIN
  SELECT max(id) INTO f FROM fights WHERE status = 'completed';
  DELETE FROM user_votes WHERE user_id = U AND fight_id = f;
  SELECT COALESCE((SELECT likes_count FROM fight_ratings WHERE fight_id = f), 0) INTO before_likes;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', U::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO user_votes (user_id, fight_id, vote_type) VALUES (U, f, 'like');
  EXECUTE 'RESET ROLE';

  SELECT COALESCE((SELECT likes_count FROM fight_ratings WHERE fight_id = f), 0) INTO after_likes;
  RAISE EXCEPTION 'SMOKE fight=% likes % -> % delta=%', f, before_likes, after_likes, after_likes - before_likes;
END
$smoke$;
"""

# ── Deploy ─────────────────────────────────────────────────────────────────────

def run_sql(label, sql):
    print(f"Deploying: {label}...")
    resp = requests.post(api_url, headers=headers, json={"query": sql})
    if resp.status_code >= 400:
        print(f"  ERROR {resp.status_code}: {resp.text}")
        sys.exit(1)
    print(f"  OK ({resp.status_code})")

def query(sql):
    resp = requests.post(api_url, headers=headers, json={"query": sql})
    if resp.status_code >= 400:
        print(f"  ERROR {resp.status_code}: {resp.text}")
        sys.exit(1)
    return resp.json()


run_sql("update_fight_ratings() function + trigger", UPDATE_FIGHT_RATINGS_SQL)

print("\nVerifying...")
trgs = sorted(r["tgname"] for r in query("""
    SELECT tgname FROM pg_trigger
    WHERE tgrelid = 'public.user_votes'::regclass AND NOT tgisinternal;
"""))
print("  user_votes triggers:", trgs)
acl = query("SELECT proacl::text AS acl FROM pg_proc WHERE oid = 'public.update_fight_ratings'::regproc;")[0]["acl"]
print("  update_fight_ratings ACL:", acl)
# '{=X/' or ',=X/' is the PUBLIC grant
leaked = [g for g in ("{=X/", ",=X/", "anon=", "authenticated=") if g in acl]

print("\nSmoke test (vote as a real user, rolled back):")
resp = requests.post(api_url, headers=headers, json={"query": SMOKE_TEST_SQL})
m = re.search(r"SMOKE fight=\d+ likes \d+ -> \d+ delta=-?\d+", resp.text)
smoke = m.group(0) if m else f"no SMOKE line (HTTP {resp.status_code}): {resp.text[:500]}"
print("  " + smoke)

if trgs != ["update_fight_ratings_trigger"] or leaked or not smoke.endswith("delta=1"):
    print("\nVERIFY FAILED — check the output above.")
    sys.exit(1)
print("\nAll triggers deployed successfully.")
