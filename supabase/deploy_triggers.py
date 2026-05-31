"""
deploy_triggers.py — version-controls and deploys database triggers.

Currently manages:
  - update_fight_ratings() trigger on user_votes

Run: python supabase/deploy_triggers.py
Requires: REACT_APP_SUPABASE_URL and SUPABASE_MANAGEMENT_KEY in .env
"""

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
"""

# ── Deploy ─────────────────────────────────────────────────────────────────────

def run_sql(label, sql):
    print(f"Deploying: {label}...")
    resp = requests.post(api_url, headers=headers, json={"query": sql})
    if resp.status_code >= 400:
        print(f"  ERROR {resp.status_code}: {resp.text}")
        sys.exit(1)
    print(f"  OK ({resp.status_code})")

run_sql("update_fight_ratings() function + trigger", UPDATE_FIGHT_RATINGS_SQL)
print("\nAll triggers deployed successfully.")
