"""
migrate_user_votes_cascade.py — Switch user_votes.fight_id FK to ON DELETE CASCADE.

Audit ref: memory/audits/2026-05-16/02-schema.md §1, followups #7 (S-P1-7)

Background:
  All sibling user-data tables CASCADE on fights.id delete:
    - user_round_scores.fight_id            ON DELETE CASCADE ✓
    - user_fight_scorecard_state.fight_id   ON DELETE CASCADE ✓
    - fight_ratings.fight_id                ON DELETE CASCADE ✓
    - user_votes.fight_id                   ON DELETE NO ACTION  ← outlier (this fix)

  The Phase 2 auto-delete guard prevents most accidental fight deletes, but if a fight
  is ever deleted manually the NO ACTION FK blocks the delete with a constraint
  violation while the sibling tables silently cascade. Pick a behavior and apply it
  consistently. CASCADE matches the user-data lifecycle (delete fight → delete votes
  for it; nobody can vote on a fight that no longer exists).

  Live state at write-time (240 user_votes rows, 0 orphans). The fix is a constraint
  swap only — no data is written or deleted.

Run once:
    python supabase/migrate_user_votes_cascade.py

Idempotent: re-running after success is a no-op (script detects existing CASCADE and exits).
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


def run_sql(sql: str):
    r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": sql}, timeout=30)
    if not r.ok:
        print(f"FAIL query {r.status_code}: {r.text}")
        sys.exit(1)
    return r.json()


# ---------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------
print("Pre-flight: current FK state + orphan check...")

PREFLIGHT_SQL = """
SELECT
  (
    SELECT CASE con.confdeltype
             WHEN 'a' THEN 'NO ACTION'
             WHEN 'r' THEN 'RESTRICT'
             WHEN 'c' THEN 'CASCADE'
             WHEN 'n' THEN 'SET NULL'
             WHEN 'd' THEN 'SET DEFAULT'
           END
    FROM pg_constraint con
    JOIN pg_class     rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'user_votes'
      AND con.conname = 'user_votes_fight_id_fkey'
  ) AS current_delete_action,
  (SELECT COUNT(*) FROM user_votes)                                     AS user_votes_rows,
  (SELECT COUNT(*) FROM user_votes uv
   WHERE NOT EXISTS (SELECT 1 FROM fights f WHERE f.id = uv.fight_id))  AS orphan_user_votes;
"""

rows = run_sql(PREFLIGHT_SQL)
if not rows:
    print("FAIL pre-flight returned no rows")
    sys.exit(1)

row = rows[0]
current_action = row["current_delete_action"]
total_rows     = int(row["user_votes_rows"])
orphans        = int(row["orphan_user_votes"])

print(f"  user_votes_fight_id_fkey  ON DELETE = {current_action}")
print(f"  user_votes rows           = {total_rows}")
print(f"  orphan user_votes         = {orphans}")

if current_action == "CASCADE":
    print("OK already CASCADE - nothing to do.")
    sys.exit(0)

if current_action is None:
    print("FAIL constraint user_votes_fight_id_fkey not found. Investigate before re-running.")
    sys.exit(1)

if orphans > 0:
    print(f"FAIL abort: {orphans} orphan user_votes rows exist. Re-adding the FK would fail.")
    print("       Investigate those rows and clean before re-running.")
    sys.exit(1)

print("OK pre-flight passed. Swapping constraint...")


# ---------------------------------------------------------------
# Swap (single transaction)
# ---------------------------------------------------------------
SWAP_SQL = """
BEGIN;
  ALTER TABLE public.user_votes
    DROP CONSTRAINT user_votes_fight_id_fkey;

  ALTER TABLE public.user_votes
    ADD CONSTRAINT user_votes_fight_id_fkey
    FOREIGN KEY (fight_id) REFERENCES public.fights(id)
    ON DELETE CASCADE;
COMMIT;
"""

run_sql(SWAP_SQL)


# ---------------------------------------------------------------
# Verify
# ---------------------------------------------------------------
VERIFY_SQL = """
SELECT
  CASE con.confdeltype
    WHEN 'a' THEN 'NO ACTION'
    WHEN 'c' THEN 'CASCADE'
    ELSE con.confdeltype::text
  END AS delete_action
FROM pg_constraint con
JOIN pg_class     rel ON rel.oid = con.conrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND rel.relname = 'user_votes'
  AND con.conname = 'user_votes_fight_id_fkey';
"""

rows = run_sql(VERIFY_SQL)
if not rows or rows[0]["delete_action"] != "CASCADE":
    print(f"FAIL verify failed: got {rows}")
    sys.exit(1)

print("OK user_votes_fight_id_fkey now ON DELETE CASCADE")
print("   Sibling parity restored across user_round_scores / user_fight_scorecard_state /")
print("   fight_ratings / user_votes.")
