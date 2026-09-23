"""
migrate_fight_predictions.py — Create user_fight_predictions (pre-fight winner picks).

Backs the swipe-to-predict feature: before a fight starts, a signed-in user picks who
wins. Guests cannot predict (sessionStorage would evaporate an accuracy record), so this
is auth-only by design.

Schema decisions worth keeping:

  predicted_fighter is the fighter's NAME, never a corner index.
    fights.bout gets re-scraped and can come back with the two fighters in the other
    order (CLAUDE.md conventions #1/#9). A corner-only record would silently invert and
    start crediting the wrong fighter. A name snapshot cannot.

  bout_snapshot stores the bout string exactly as it read when the pick was made.
    A pick refers to a specific MATCHUP, not to a fighter. If either side changes —
    opponent swap, withdrawal, or the bout being scratched off the card — the pick is
    void. Storing only the chosen fighter misses the case where the OPPONENT is
    replaced: the chosen name still matches, so the swap goes undetected and the user
    is left holding a live pick on a fight they never agreed to.

  No graded/correct column. Correctness is derived at read time against fights.winner
    using matchesFighter (NOT exact equality — ESPN and ufcstats spell the same fighter
    differently, e.g. "Matthieu Letho Duclos" vs "Matthieu Duclos"). Storing the verdict
    would go stale whenever the scraper corrects a winner after the fact.

  UNIQUE (user_id, fight_id) — one pick per fight per user. Changing your mind is an
    upsert, clearing it is a delete.

  Both FKs CASCADE, matching every sibling user-data table (user_round_scores,
    user_fight_scorecard_state, fight_ratings, and user_votes since S-P1-7).

Run once:
    python supabase/migrate_fight_predictions.py

Idempotent: safe to re-run — every statement is IF NOT EXISTS / DROP-then-CREATE.

To undo (nothing else references this table):
    DROP TABLE IF EXISTS user_fight_predictions;
"""

import sys
import os
import json
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


def run_sql(sql: str):
    r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": sql}, timeout=30)
    if not r.ok:
        print(f"FAIL query {r.status_code}: {r.text}")
        sys.exit(1)
    return r.json()


# ---------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------
print("Pre-flight: does the table already exist?")
existing = run_sql("""
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'user_fight_predictions';
""")
if existing:
    print("  user_fight_predictions already exists — re-running is a no-op for the table,")
    print("  policies and indexes will be refreshed.")
else:
    print("  not present — will be created.")


MIGRATION_SQL = """
-- ============================================================
-- user_fight_predictions
-- One pre-fight winner pick per user per fight.
-- ============================================================
CREATE TABLE IF NOT EXISTS user_fight_predictions (
  id                bigserial   PRIMARY KEY,
  user_id           uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fight_id          bigint      NOT NULL REFERENCES fights(id)     ON DELETE CASCADE,

  -- The fighter's NAME as it read in fights.bout at pick time. Never a corner index:
  -- bout strings get re-scraped and can come back reversed.
  predicted_fighter text        NOT NULL,

  -- The full bout string at pick time. If the current bout no longer matches this,
  -- the matchup changed (swap / withdrawal / scratch) and the pick is void.
  bout_snapshot     text        NOT NULL,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT user_fight_predictions_unique_pick UNIQUE (user_id, fight_id)
);

-- Profile stats read every pick for one user; the event view reads one user's picks
-- for a set of fights. Both are covered by the unique constraint's index on
-- (user_id, fight_id), but fight_id alone is needed for the FK delete check.
CREATE INDEX IF NOT EXISTS idx_ufp_fight_id ON user_fight_predictions (fight_id);

-- keep updated_at honest on upsert
CREATE OR REPLACE FUNCTION set_user_fight_predictions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ufp_updated_at ON user_fight_predictions;
CREATE TRIGGER trg_ufp_updated_at
  BEFORE UPDATE ON user_fight_predictions
  FOR EACH ROW EXECUTE FUNCTION set_user_fight_predictions_updated_at();

-- ============================================================
-- RLS — a pick is private to the user who made it.
-- Matches the pattern in deploy_rls_policies.py.
-- ============================================================
ALTER TABLE user_fight_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ufp_select_own" ON user_fight_predictions;
CREATE POLICY "ufp_select_own"
  ON user_fight_predictions FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "ufp_insert_own" ON user_fight_predictions;
CREATE POLICY "ufp_insert_own"
  ON user_fight_predictions FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ufp_update_own" ON user_fight_predictions;
CREATE POLICY "ufp_update_own"
  ON user_fight_predictions FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ufp_delete_own" ON user_fight_predictions;
CREATE POLICY "ufp_delete_own"
  ON user_fight_predictions FOR DELETE
  USING (user_id = auth.uid());

-- Guests never reach this table; anon has no business here.
REVOKE ALL ON user_fight_predictions FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_fight_predictions TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE user_fight_predictions_id_seq TO authenticated;
"""

print("\nApplying migration...")
run_sql(MIGRATION_SQL)
print("  done.")

# ---------------------------------------------------------------
# Verify
# ---------------------------------------------------------------
print("\nVerifying...")

cols = run_sql("""
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_fight_predictions'
    ORDER BY ordinal_position;
""")
print("  columns:")
for c in cols:
    print("    %-18s %-26s null=%s" % (c['column_name'], c['data_type'], c['is_nullable']))

rls = run_sql("""
    SELECT relrowsecurity
    FROM pg_class
    WHERE relname = 'user_fight_predictions';
""")
print("  RLS enabled:", rls[0]['relrowsecurity'] if rls else "UNKNOWN")

pols = run_sql("""
    SELECT policyname, cmd
    FROM pg_policies
    WHERE tablename = 'user_fight_predictions'
    ORDER BY policyname;
""")
print("  policies:", ", ".join("%s(%s)" % (p['policyname'], p['cmd']) for p in pols) or "NONE")

fks = run_sql("""
    SELECT con.conname, con.confdeltype
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'user_fight_predictions' AND con.contype = 'f';
""")
print("  foreign keys (c = ON DELETE CASCADE):")
for f in fks:
    print("    %-52s %s" % (f['conname'], f['confdeltype']))

cnt = run_sql("SELECT count(*) AS n FROM user_fight_predictions;")
print("  rows:", cnt[0]['n'])

print("\nMigration complete.")
