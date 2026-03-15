"""
deploy_poll_live_fights.py — Deploy poll-live-fights Edge Function + pg_cron schedule.

Run once (from ufc-web-app/):
    python supabase/deploy_poll_live_fights.py

What this does:
  1. Deploys supabase/functions/poll-live-fights/index.ts via Supabase CLI (npx supabase)
     NOTE: Management API ZIP upload returns 500 — CLI handles bundling correctly.
  2. Enables pg_cron + pg_net extensions (if not already enabled)
  3. Creates a pg_cron job that calls the Edge Function every minute

Requirements:
  - npx / Node.js available on PATH
  - REACT_APP_SUPABASE_URL and SUPABASE_MANAGEMENT_KEY in .env
"""

import sys
import os
import subprocess
import requests
from pathlib import Path
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

load_dotenv(dotenv_path=Path(__file__).parent.parent / '.env')

supabase_url = os.environ.get("REACT_APP_SUPABASE_URL", "")
mgmt_key     = os.environ.get("SUPABASE_MANAGEMENT_KEY", "")

if not supabase_url or not mgmt_key:
    raise SystemExit("Missing REACT_APP_SUPABASE_URL or SUPABASE_MANAGEMENT_KEY in .env")

project_ref    = supabase_url.replace("https://", "").split(".")[0]
MGMT_QUERY_URL = f"https://api.supabase.com/v1/projects/{project_ref}/database/query"
AUTH_HEADERS   = {"Authorization": f"Bearer {mgmt_key}", "Content-Type": "application/json"}
EDGE_FN_URL    = f"{supabase_url}/functions/v1/poll-live-fights"
FUNCTION_SLUG  = "poll-live-fights"
REPO_ROOT      = Path(__file__).parent.parent

# ---------- 1. Deploy via Supabase CLI ----------

print("\n🚀 Deploying Edge Function via Supabase CLI...")
result = subprocess.run(
    ["npx", "supabase", "functions", "deploy", FUNCTION_SLUG,
     "--project-ref", project_ref, "--no-verify-jwt"],
    env={**os.environ, "SUPABASE_ACCESS_TOKEN": mgmt_key},
    cwd=str(REPO_ROOT),
    capture_output=True,
    text=True,
)
print(result.stdout.strip())
if result.returncode != 0:
    print(result.stderr.strip())
    raise SystemExit(f"❌ CLI deploy failed (exit {result.returncode})")
print(f"✅ {FUNCTION_SLUG} deployed (verify_jwt=false via --no-verify-jwt flag)")

# ---------- 2. Enable extensions + pg_cron schedule ----------

print("\n📅 Setting up pg_cron (every minute)...")

steps = [
    ("Enable pg_cron + pg_net",
     "CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT EXISTS pg_net;"),

    ("Unschedule old job (no-op if absent)",
     "SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'poll-live-fights';"),

    ("Schedule every minute",
     f"""SELECT cron.schedule(
  'poll-live-fights',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := '{EDGE_FN_URL}',
    headers := '{{"Content-Type": "application/json"}}'::jsonb,
    body    := '{{}}'::jsonb
  )
  $$
);"""),
]

for label, sql in steps:
    r = requests.post(MGMT_QUERY_URL, headers=AUTH_HEADERS, json={"query": sql}, timeout=20)
    if r.ok:
        print(f"✅ {label}")
    else:
        print(f"❌ {label} failed {r.status_code}: {r.text}")
        sys.exit(1)

# ---------- done ----------

print(f"""
🎉 Done!
   Edge Function : {EDGE_FN_URL}
   pg_cron       : runs every minute
   Guards        : no event today → skip | before start_time → skip | all fights ended → skip

To verify cron job:
   SELECT * FROM cron.job WHERE jobname = 'poll-live-fights';

To check recent runs:
   SELECT * FROM cron.job_run_details WHERE jobid IN (
     SELECT jobid FROM cron.job WHERE jobname = 'poll-live-fights'
   ) ORDER BY start_time DESC LIMIT 10;

To remove the cron job later:
   SELECT cron.unschedule('poll-live-fights');
""")
