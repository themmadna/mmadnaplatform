"""
migrate_prediction_keep_on_delete.py — Keep a pick when its fight row is deleted.

Why: the master scraper's auto-delete removes cancelled bouts from `fights`
("Deleting Cancelled Fight"), and user_fight_predictions.fight_id was
ON DELETE CASCADE — so the pick vanished with no trace. That breaks the feature's
own rule: a pick on a matchup that changed is VOID and shown as such, never silently
dropped. Found 2026-10-03 when a pick on fight 9042 (UFC Fight Night: Rosas Jr. vs
Barcelos) disappeared and the card showed one fewer pick than was made.

What it changes:
  1. ADD event_name — a deleted fight takes its event with it, and an orphaned pick
     still has to group under the right card on the profile. Filled server-side by
     a trigger from fights.event_name, so the client never has to send it (or be
     trusted to). Backfilled for existing rows.
  2. fight_id DROP NOT NULL, FK re-created ON DELETE SET NULL. A NULL fight_id IS the
     "fight was deleted" marker; the frontend renders those picks as void.
     UNIQUE (user_id, fight_id) still holds for live picks — Postgres treats NULLs as
     distinct, so any number of orphans can coexist.

Not recoverable: picks already cascade-deleted before this ran (e.g. id 3 on 9042).

Run once:
    python supabase/migrate_prediction_keep_on_delete.py

Idempotent: safe to re-run.

To undo (deletes orphaned picks, then restores the old shape):
    DELETE FROM user_fight_predictions WHERE fight_id IS NULL;
    ALTER TABLE user_fight_predictions DROP CONSTRAINT user_fight_predictions_fight_id_fkey;
    ALTER TABLE user_fight_predictions ADD CONSTRAINT user_fight_predictions_fight_id_fkey
      FOREIGN KEY (fight_id) REFERENCES fights(id) ON DELETE CASCADE;
    ALTER TABLE user_fight_predictions ALTER COLUMN fight_id SET NOT NULL;
    DROP TRIGGER IF EXISTS trg_ufp_event_name ON user_fight_predictions;
    DROP FUNCTION IF EXISTS set_user_fight_predictions_event_name();
    ALTER TABLE user_fight_predictions DROP COLUMN event_name;
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


print("Pre-flight:")
before = run_sql("SELECT count(*) AS n FROM user_fight_predictions;")[0]['n']
print("  rows:", before)


MIGRATION_SQL = """
BEGIN;

-- 1. event_name, filled from fights by trigger
ALTER TABLE user_fight_predictions ADD COLUMN IF NOT EXISTS event_name text;

CREATE OR REPLACE FUNCTION set_user_fight_predictions_event_name()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  -- fight_id goes NULL when the fight is deleted (ON DELETE SET NULL); keep the
  -- event_name we already have in that case — it's the only record of the card left.
  IF NEW.fight_id IS NOT NULL THEN
    SELECT f.event_name INTO NEW.event_name FROM fights f WHERE f.id = NEW.fight_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ufp_event_name ON user_fight_predictions;
CREATE TRIGGER trg_ufp_event_name
  BEFORE INSERT OR UPDATE OF fight_id ON user_fight_predictions
  FOR EACH ROW EXECUTE FUNCTION set_user_fight_predictions_event_name();

UPDATE user_fight_predictions p
   SET event_name = f.event_name
  FROM fights f
 WHERE f.id = p.fight_id AND p.event_name IS DISTINCT FROM f.event_name;

-- 2. A deleted fight orphans the pick instead of deleting it
ALTER TABLE user_fight_predictions ALTER COLUMN fight_id DROP NOT NULL;
ALTER TABLE user_fight_predictions DROP CONSTRAINT IF EXISTS user_fight_predictions_fight_id_fkey;
ALTER TABLE user_fight_predictions ADD CONSTRAINT user_fight_predictions_fight_id_fkey
  FOREIGN KEY (fight_id) REFERENCES fights(id) ON DELETE SET NULL;

COMMIT;
"""

print("\nApplying migration...")
run_sql(MIGRATION_SQL)
print("  done.")

print("\nVerifying...")
fk = run_sql("""
    SELECT pg_get_constraintdef(con.oid) AS d
    FROM pg_constraint con JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'user_fight_predictions' AND con.conname = 'user_fight_predictions_fight_id_fkey';
""")
print("  fight_id FK:", fk[0]['d'] if fk else "MISSING")
ok_fk = bool(fk) and 'ON DELETE SET NULL' in fk[0]['d']

col = run_sql("""
    SELECT is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_fight_predictions' AND column_name = 'fight_id';
""")
print("  fight_id nullable:", col[0]['is_nullable'])

stats = run_sql("""
    SELECT count(*) AS n,
           count(*) FILTER (WHERE event_name IS NULL) AS missing_event
    FROM user_fight_predictions;
""")[0]
print("  rows:", stats['n'], "(before:", str(before) + ")")
print("  rows missing event_name:", stats['missing_event'])

if not ok_fk or col[0]['is_nullable'] != 'YES' or stats['missing_event'] or stats['n'] != before:
    print("\nVERIFY FAILED — check the output above.")
    sys.exit(1)
print("\nMigration complete.")
