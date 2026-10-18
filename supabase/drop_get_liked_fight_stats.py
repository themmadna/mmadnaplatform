"""
drop_get_liked_fight_stats.py — S-P2-19: DROP the dead get_liked_fight_stats() RPC.

Why: dead (no src/ caller, no DB function/view/cron reference), orphan (never had a deploy
script — created by hand), and latently buggy: it joins round_fight_stats to fights on
(event_name, bout) text, which Convention #9 forbids (rfs.bout is often reversed). anon/PUBLIC
EXECUTE was already revoked ad-hoc in S-P2-9 (2026-05-31).

The script re-runs the reachability checks against the live DB and refuses to drop if any
reference has appeared since. A frontend grep is on you: `grep -rn get_liked_fight_stats src/`
(empty on 2026-10-18).

Run once:
    python supabase/drop_get_liked_fight_stats.py

Idempotent: safe to re-run (DROP ... IF EXISTS).

To undo — the exact definition as it was live on 2026-10-18 (pg_get_functiondef), plus the
grants it had then:

    CREATE OR REPLACE FUNCTION public.get_liked_fight_stats()
     RETURNS SETOF round_fight_stats
     LANGUAGE sql
     STABLE
    AS $function$
      SELECT
          rfs.*
      FROM
          public.round_fight_stats rfs
      JOIN
          public.fights f ON rfs.event_name = f.event_name AND rfs.bout = f.bout
      JOIN
          public.user_votes uv ON f.id = uv.fight_id
      WHERE
          uv.user_id = auth.uid() -- Automatically gets the currently logged-in user
          AND uv.vote_type = 'like';
    $function$;
    REVOKE EXECUTE ON FUNCTION public.get_liked_fight_stats() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.get_liked_fight_stats() TO authenticated, service_role;
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


print("Pre-flight (reachability in the live DB):")
exists = run_sql("SELECT 1 FROM pg_proc WHERE proname = 'get_liked_fight_stats';")
print("  function present:", bool(exists))
checks = {
    "other functions": "SELECT proname AS ref FROM pg_proc WHERE prosrc ILIKE '%get_liked_fight_stats%' AND proname <> 'get_liked_fight_stats';",
    "views": "SELECT table_name AS ref FROM information_schema.views WHERE view_definition ILIKE '%get_liked_fight_stats%';",
    "dependencies": "SELECT classid::regclass::text AS ref FROM pg_depend WHERE refobjid IN (SELECT oid FROM pg_proc WHERE proname = 'get_liked_fight_stats') AND deptype <> 'n';",
    "cron jobs": "SELECT jobname AS ref FROM cron.job WHERE command ILIKE '%get_liked_fight_stats%';",
}
found = False
for label, sql in checks.items():
    refs = [r["ref"] for r in run_sql(sql)]
    print(f"  {label}: {refs or 'none'}")
    found = found or bool(refs)
if found:
    print("\nABORT — something references get_liked_fight_stats now. Nothing dropped.")
    sys.exit(1)

print("\nDropping...")
run_sql("DROP FUNCTION IF EXISTS public.get_liked_fight_stats();")
print("  done.")

print("\nVerifying...")
left = run_sql("SELECT oid::regprocedure::text AS sig FROM pg_proc WHERE proname = 'get_liked_fight_stats';")
print("  remaining:", [r["sig"] for r in left] or "none")
if left:
    print("\nVERIFY FAILED — an overload may remain; check the output above.")
    sys.exit(1)
print("\nS-P2-19 complete.")
