"""
migrate_prediction_lock.py — Server-side pick lock: no pick changes once a fight has started.

Why: the lock was client-only. The app closes picks at the walkout, but RLS lets a
signed-in user insert, change or delete their own pick through the API at any time —
including after the fight, which would let anyone pick the winner after the fact or
clear a missed pick to erase it from their record.

What it adds:
  trg_ufp_lock_started — BEFORE INSERT/UPDATE/DELETE on user_fight_predictions.
  For the API roles (authenticated, anon) it rejects any write that creates, changes or
  removes a pick on a fight that is locked:
      fight_started_at IS NOT NULL OR fight_ended_at IS NOT NULL OR status = 'completed'
  (status covers past fights the live poller never stamped — e.g. the 403 era.)

  Still allowed after the start:
    - UPDATE that leaves fight_id / predicted_fighter / bout_snapshot unchanged —
      that's the spoiler reveal (revealed_at), which only ever happens after a fight.
    - Anything not run as authenticated/anon: referential actions (fight deleted →
      fight_id SET NULL; user deleted → CASCADE) run as the table owner, and
      service_role scripts are admin fixes.

  Locks at the FIRST BELL, not the walkout — the DB has no walkout timestamp. The app
  still locks at the walkout; this closes the API path for everything after the bell.

Safety: before applying, the trigger + a self-test run in one transaction that always
rolls back (the test ends by raising its own report). The trigger is only applied if
every case passes, and the self-test is run again (also rolled back) against the live
trigger. The self-test acts as the allowlisted user against the two newest fights and
one completed fight; nothing it writes survives.

Run once:
    python supabase/migrate_prediction_lock.py

Idempotent: safe to re-run.

To undo:
    DROP TRIGGER IF EXISTS trg_ufp_lock_started ON user_fight_predictions;
    DROP FUNCTION IF EXISTS lock_started_fight_predictions();
"""

import re
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

# The allowlisted user in src/featureFlags.js — the self-test acts as them.
TEST_USER = '92ece4d5-d62d-48e3-988d-6d25c22152f2'


def run_sql(sql: str):
    r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": sql}, timeout=60)
    if not r.ok:
        print(f"FAIL query {r.status_code}: {r.text}")
        sys.exit(1)
    return r.json()


TRIGGER_SQL = """
CREATE OR REPLACE FUNCTION lock_started_fight_predictions()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  new_fid   bigint;
  old_fid   bigint;
  locked_id bigint;
BEGIN
  -- Only the API roles are locked. Referential actions (fight deleted → SET NULL,
  -- user deleted → CASCADE) run as the table owner; service_role is admin fixes.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP <> 'DELETE' THEN new_fid := NEW.fight_id; END IF;
  IF TG_OP <> 'INSERT' THEN old_fid := OLD.fight_id; END IF;

  -- The spoiler reveal writes revealed_at only, and only ever after the fight.
  IF TG_OP = 'UPDATE'
     AND new_fid IS NOT DISTINCT FROM old_fid
     AND NEW.predicted_fighter IS NOT DISTINCT FROM OLD.predicted_fighter
     AND NEW.bout_snapshot IS NOT DISTINCT FROM OLD.bout_snapshot THEN
    RETURN NEW;
  END IF;

  -- Moving a pick between fights counts against both of them.
  SELECT f.id INTO locked_id
    FROM fights f
   WHERE f.id IN (new_fid, old_fid)
     AND (f.fight_started_at IS NOT NULL OR f.fight_ended_at IS NOT NULL OR f.status = 'completed')
   LIMIT 1;

  IF locked_id IS NOT NULL THEN
    RAISE EXCEPTION 'Pick locked: fight % has started', locked_id
      USING ERRCODE = 'check_violation', HINT = 'Picks close when the fight starts.';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ufp_lock_started ON user_fight_predictions;
CREATE TRIGGER trg_ufp_lock_started
  BEFORE INSERT OR UPDATE OR DELETE ON user_fight_predictions
  FOR EACH ROW EXECUTE FUNCTION lock_started_fight_predictions();
"""


# (name, run as, expected, statement). 'user' = authenticated as TEST_USER, 'admin' =
# the management connection. o1/o2 = open fights, d = a completed fight, U = the user.
CASES = [
    ('pick an open fight',              'user',  'allowed', "INSERT INTO user_fight_predictions (user_id, fight_id, predicted_fighter, bout_snapshot) VALUES (U, o1, 'A', 'A vs B')"),
    ('change pick before start',        'user',  'allowed', "UPDATE user_fight_predictions SET predicted_fighter = 'B' WHERE user_id = U AND fight_id = o1"),
    ('pick a completed fight',          'user',  'blocked', "INSERT INTO user_fight_predictions (user_id, fight_id, predicted_fighter, bout_snapshot) VALUES (U, d, 'A', 'A vs B')"),
    ('pick second open fight',          'user',  'allowed', "INSERT INTO user_fight_predictions (user_id, fight_id, predicted_fighter, bout_snapshot) VALUES (U, o2, 'A', 'A vs B')"),
    ('-- first bell on o1',             'admin', 'allowed', "UPDATE fights SET fight_started_at = now() WHERE id = o1"),
    ('change pick after start',         'user',  'blocked', "UPDATE user_fight_predictions SET predicted_fighter = 'A' WHERE user_id = U AND fight_id = o1"),
    ('upsert pick after start',         'user',  'blocked', "INSERT INTO user_fight_predictions (user_id, fight_id, predicted_fighter, bout_snapshot) VALUES (U, o1, 'A', 'A vs B') ON CONFLICT (user_id, fight_id) DO UPDATE SET predicted_fighter = EXCLUDED.predicted_fighter"),
    ('clear pick after start',          'user',  'blocked', "DELETE FROM user_fight_predictions WHERE user_id = U AND fight_id = o1"),
    ('move pick off a started fight',   'user',  'blocked', "DELETE FROM user_fight_predictions WHERE user_id = U AND fight_id = o2; UPDATE user_fight_predictions SET fight_id = o2 WHERE user_id = U AND fight_id = o1"),
    ('reveal after start',              'user',  'allowed', "UPDATE user_fight_predictions SET revealed_at = now() WHERE user_id = U AND fight_id = o1"),
    ('fight deleted → SET NULL (owner)', 'admin', 'allowed', "UPDATE user_fight_predictions SET fight_id = NULL WHERE user_id = U AND fight_id = o1"),
]


def selftest_sql() -> str:
    blocks = []
    for i, (name, who, expect, stmt) in enumerate(CASES, 1):
        role = "EXECUTE 'SET LOCAL ROLE authenticated';" if who == 'user' else "EXECUTE 'RESET ROLE';"
        safe = name.replace("'", "''")
        blocks.append(f"""
  {role}
  BEGIN
    {stmt};
    got := 'allowed'; err := '';
  EXCEPTION WHEN OTHERS THEN
    got := 'blocked'; err := SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
  -- a "blocked" only counts if it was this trigger, not RLS or a constraint
  ok := got = '{expect}' AND (got = 'allowed' OR err LIKE 'Pick locked%');
  IF NOT ok THEN fails := fails + 1; END IF;
  report := report || '{i}. {safe}: ' || got || CASE WHEN err <> '' THEN ' (' || err || ')' ELSE '' END
                   || CASE WHEN ok THEN ' PASS' ELSE ' FAIL, expected {expect}' END || E'\\n';""")
    return f"""
DO $selftest$
DECLARE
  U uuid := '{TEST_USER}';
  o1 bigint; o2 bigint; d bigint;
  got text; err text; ok boolean;
  fails int := 0;
  report text := E'\\n';
BEGIN
  -- Fixtures (rolled back with everything else): the two newest fights, forced open,
  -- and the newest completed fight. Clear the user's own picks on them first.
  SELECT max(id) INTO o1 FROM fights;
  SELECT max(id) INTO o2 FROM fights WHERE id < o1;
  UPDATE fights SET fight_started_at = NULL, fight_ended_at = NULL, status = 'upcoming' WHERE id IN (o1, o2);
  SELECT max(id) INTO d FROM fights WHERE status = 'completed' AND id NOT IN (o1, o2);
  DELETE FROM user_fight_predictions WHERE user_id = U AND fight_id IN (o1, o2, d);

  PERFORM set_config('request.jwt.claims', json_build_object('sub', U, 'role', 'authenticated')::text, true);
  PERFORM set_config('request.jwt.claim.sub', U::text, true);
{''.join(blocks)}

  -- Always raise: the report rides out on the error, and the whole transaction
  -- (fixtures, test rows — and on a dry run, the trigger itself) is rolled back.
  RAISE EXCEPTION 'SELFTEST fails=% (fixtures o1=% o2=% d=%)%', fails, o1, o2, d, report;
END
$selftest$;
"""


def _strings(x):
    if isinstance(x, str):
        yield x
    elif isinstance(x, dict):
        for v in x.values():
            yield from _strings(v)
    elif isinstance(x, list):
        for v in x:
            yield from _strings(v)


def run_selftest(prefix_sql: str = "") -> bool:
    r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": prefix_sql + selftest_sql()}, timeout=60)
    try:
        texts = list(_strings(r.json()))
    except ValueError:
        texts = [r.text]
    m = next((re.search(r'SELFTEST fails=(\d+)(.*)', t, re.S) for t in texts if 'SELFTEST fails=' in t), None)
    if r.ok or not m:
        print(f"  self-test did not report (HTTP {r.status_code}): {r.text[:2000]}")
        return False
    print("  " + m.group(2).strip().replace('\n', '\n  '))
    return m.group(1) == '0'


def trigger_present() -> bool:
    return bool(run_sql("""
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = 'public.user_fight_predictions'::regclass
          AND tgname = 'trg_ufp_lock_started' AND NOT tgisinternal;
    """))


print("Pre-flight:")
before = run_sql("SELECT count(*) AS n FROM user_fight_predictions;")[0]['n']
print("  rows:", before)

already = trigger_present()
print("  trigger already present:", already)

print("\nDry run (trigger + self-test in one transaction, rolled back):")
dry_ok = run_selftest(TRIGGER_SQL)
if not already and trigger_present():
    # The API committed statements one by one instead of as one transaction.
    print("\nDRY RUN DID NOT ROLL BACK — the trigger is now live. Review the self-test above;")
    print("undo SQL is in this script's docstring.")
    sys.exit(1)
if not dry_ok:
    print("\nDRY RUN FAILED — nothing applied.")
    sys.exit(1)

print("\nApplying trigger...")
run_sql("BEGIN;\n" + TRIGGER_SQL + "\nCOMMIT;")
print("  done.")

print("\nVerifying...")
trg = trigger_present()
print("  trigger:", "present" if trg else "MISSING")
after = run_sql("SELECT count(*) AS n FROM user_fight_predictions;")[0]['n']
print("  rows:", after, "(before:", str(before) + ")")

print("\nSelf-test against the live trigger (rolled back):")
live_ok = run_selftest()

if not trg or after != before or not live_ok:
    print("\nVERIFY FAILED — check the output above. Undo SQL is in this script's docstring.")
    sys.exit(1)
print("\nMigration complete.")
