"""
test_poll_live_fights.py — Verify poll-live-fights Edge Function + pg_cron health.

Run from ufc-web-app/:
    python supabase/test_poll_live_fights.py

Checks:
  1. pg_cron job exists and is active
  2. Recent cron run history (last 10 runs)
  3. Most recent event fights — rounds_fought / fight_ended_at populated
  4. Manual invocation of the Edge Function (confirms it responds)
"""

import sys
import os
import requests
from pathlib import Path
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

load_dotenv(dotenv_path=Path(__file__).parent.parent / '.env')

supabase_url = os.environ.get("REACT_APP_SUPABASE_URL", "")
service_key  = os.environ.get("SUPABASE_SERVICE_KEY", "")
mgmt_key     = os.environ.get("SUPABASE_MANAGEMENT_KEY", "")

if not supabase_url or not service_key or not mgmt_key:
    raise SystemExit("Missing REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_KEY, or SUPABASE_MANAGEMENT_KEY in .env")

project_ref    = supabase_url.replace("https://", "").split(".")[0]
MGMT_QUERY_URL = f"https://api.supabase.com/v1/projects/{project_ref}/database/query"
MGMT_HEADERS   = {"Authorization": f"Bearer {mgmt_key}", "Content-Type": "application/json"}
DB_HEADERS     = {
    "apikey": service_key,
    "Authorization": f"Bearer {service_key}",
    "Content-Type": "application/json",
}
EDGE_FN_URL = f"{supabase_url}/functions/v1/poll-live-fights"

PASS = "PASS"
FAIL = "FAIL"
WARN = "WARN"

def section(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print('='*60)

def result(status, msg):
    icon = {"PASS": "✅", "FAIL": "❌", "WARN": "⚠️ "}.get(status, "  ")
    print(f"{icon} {msg}")

def mgmt_query(sql):
    r = requests.post(MGMT_QUERY_URL, headers=MGMT_HEADERS, json={"query": sql}, timeout=20)
    r.raise_for_status()
    return r.json()

def db_get(path):
    r = requests.get(f"{supabase_url}/rest/v1/{path}", headers=DB_HEADERS, timeout=20)
    r.raise_for_status()
    return r.json()


# ---------- 1. pg_cron job health ----------

section("1. pg_cron job health")

try:
    rows = mgmt_query("SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'poll-live-fights';")
    if not rows:
        result(FAIL, "pg_cron job 'poll-live-fights' NOT FOUND — run deploy_poll_live_fights.py")
    else:
        job = rows[0]
        status = PASS if job.get("active") else FAIL
        result(status, f"Job found: id={job['jobid']}, schedule='{job['schedule']}', active={job['active']}")
except Exception as e:
    result(FAIL, f"pg_cron query failed: {e}")


# ---------- 2. Recent cron run history ----------

section("2. Recent cron run history (last 10 runs)")

try:
    runs = mgmt_query("""
        SELECT start_time, status, return_message
        FROM cron.job_run_details
        WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname = 'poll-live-fights')
        ORDER BY start_time DESC
        LIMIT 10;
    """)
    if not runs:
        result(WARN, "No run history found yet — job may not have fired yet or extension is new")
    else:
        successes = sum(1 for r in runs if r.get("status") == "succeeded")
        failures  = sum(1 for r in runs if r.get("status") != "succeeded")
        result(PASS if failures == 0 else WARN,
               f"{len(runs)} recent runs: {successes} succeeded, {failures} failed")
        for run in runs[:5]:
            ts  = run.get("start_time", "")[:19]
            st  = run.get("status", "?")
            msg = (run.get("return_message") or "")[:80]
            print(f"     {ts}  [{st}]  {msg}")
        if len(runs) > 5:
            print(f"     ... ({len(runs)-5} more)")
except Exception as e:
    result(FAIL, f"Run history query failed: {e}")


# ---------- 3. Most recent event — fight fields ----------

section("3. Most recent event — rounds_fought / fight_ended_at coverage")

try:
    # Get the most recently completed event (event_date <= today)
    from datetime import date
    today = date.today().isoformat()
    events = db_get(f"ufc_events?select=event_name,event_date&event_date=lte.{today}&order=event_date.desc&limit=1")
    if not events:
        result(FAIL, "No events found in ufc_events table")
    else:
        event = events[0]
        event_name = event["event_name"]
        event_date = event["event_date"]
        print(f"  Event: {event_name} ({event_date})")

        fights = db_get(
            f"fights?event_name=eq.{requests.utils.quote(event_name)}"
            f"&select=id,bout,status,fight_started_at,fight_ended_at,rounds_fought,scheduled_rounds,ended_by_decision"
            f"&order=id.asc"
        )

        if not fights:
            result(WARN, "No fights found for this event")
        else:
            print(f"  {len(fights)} fights found\n")
            all_ended   = all(f.get("fight_ended_at") for f in fights)
            all_rounds  = all(f.get("rounds_fought") for f in fights)
            any_ended   = any(f.get("fight_ended_at") for f in fights)

            for f in fights:
                ended    = "✅" if f.get("fight_ended_at") else "❌"
                rounds   = f.get("rounds_fought") or "—"
                sched    = f.get("scheduled_rounds") or "—"
                decision = f.get("ended_by_decision")
                dec_str  = f" decision={decision}" if decision is not None else ""
                print(f"     {ended} fight {f['id']} | rounds={rounds}/{sched}{dec_str} | {(f.get('bout') or '')[:40]}")

            print()
            if all_ended and all_rounds:
                result(PASS, "All fights have fight_ended_at and rounds_fought set")
            elif any_ended:
                missing_ended  = sum(1 for f in fights if not f.get("fight_ended_at"))
                missing_rounds = sum(1 for f in fights if not f.get("rounds_fought"))
                result(WARN, f"{missing_ended} fights missing fight_ended_at, {missing_rounds} missing rounds_fought")
            else:
                result(WARN, "No fights have fight_ended_at — event may be in the future or data not yet written")

except Exception as e:
    result(FAIL, f"Fight query failed: {e}")


# ---------- 4. Manual invocation ----------

section("4. Manual Edge Function invocation")

try:
    r = requests.post(EDGE_FN_URL, json={}, timeout=15)
    body = r.json()
    print(f"  HTTP {r.status_code}")
    print(f"  Response: {body}")
    if r.ok and body.get("ok"):
        skipped = body.get("skipped")
        if skipped:
            result(PASS, f"Function responded correctly — skipped: {skipped}")
        else:
            result(PASS, f"Function ran and processed event: {body.get('event')}")
    else:
        result(FAIL, f"Function returned error: {body}")
except Exception as e:
    result(FAIL, f"Edge Function invocation failed: {e}")


print(f"\n{'='*60}")
print("  Done")
print('='*60)
