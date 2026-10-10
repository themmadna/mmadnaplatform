"""
pick_watcher.py — READ-ONLY live-card watcher for predictions + the live pipeline.

Snapshots an event's fight rows and picks every 2 minutes and logs only what changed,
so after the card we can check: no pick saved after its walkout, when the backend
stamped start/end, and when winners landed. Each cycle it also reads the
poll-live-fights responses recorded by pg_net, so a dead poller (e.g. ESPN 403s —
UFC 331/332) shows up during the card instead of after it.

Never writes to Supabase: table SELECTs with the service key, plus one SELECT on
net._http_response via the Management API.

USAGE (from ufc-web-app/):
    python pick_watcher.py --event "UFC Fight Night: Allen vs Duncan" --date 20261010

Log: espn_probe_logs/pick_watch_<date>.jsonl (gitignored). Exits when every bout has
ended with a winner settled (NULL = not yet; '' = draw/NC), or after --max-hours.
Pair with: python espn_winner_probe.py --date <date>
"""
import argparse, os, sys, json, time
from datetime import datetime, timezone
from pathlib import Path
import requests
from dotenv import load_dotenv
from supabase import create_client

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = Path(__file__).parent
load_dotenv(ROOT / ".env")

ap = argparse.ArgumentParser()
ap.add_argument('--event', required=True, help="exact fights.event_name")
ap.add_argument('--date', required=True, help="YYYYMMDD, used for the log file name")
ap.add_argument('--interval', type=int, default=120)
ap.add_argument('--max-hours', type=float, default=12)
args = ap.parse_args()

url = os.environ["REACT_APP_SUPABASE_URL"]
sb = create_client(url, os.environ["SUPABASE_SERVICE_KEY"])
mgmt_key = os.environ.get("SUPABASE_MANAGEMENT_KEY", "")
project_ref = url.replace("https://", "").split(".")[0]
LOG = ROOT / "espn_probe_logs" / f"pick_watch_{args.date}.jsonl"

FIGHT_COLS = "id,bout,status,fight_started_at,fight_ended_at,winner,rounds_fought,ended_by_decision,card_position"
PICK_COLS = "id,user_id,fight_id,predicted_fighter,bout_snapshot,event_name,revealed_at,created_at,updated_at"
# pg_net keeps responses for a few hours; this summarises the poller's recent calls.
POLLER_SQL = """
SELECT status_code, left(coalesce(content, error_msg, ''), 160) AS body, count(*) AS n, max(created) AS last
FROM net._http_response
WHERE created > now() - interval '%d seconds'
GROUP BY 1, 2 ORDER BY last DESC LIMIT 6
"""


def poller_health(window_s):
    if not mgmt_key:
        return None
    try:
        r = requests.post(f"https://api.supabase.com/v1/projects/{project_ref}/database/query",
                          headers={"Authorization": f"Bearer {mgmt_key}", "Content-Type": "application/json"},
                          json={"query": POLLER_SQL % window_s}, timeout=20)
        r.raise_for_status()
        return r.json()
    except Exception as e:
        return [{"error": str(e)[:200]}]


start = time.time()
last = {}
LOG.parent.mkdir(exist_ok=True)
print(f"pick watcher — {args.event} — log {LOG}", flush=True)

while True:
    now = datetime.now(timezone.utc).isoformat()
    try:
        fights = sb.table("fights").select(FIGHT_COLS).eq("event_name", args.event).execute().data
        # event_name on the pick also catches picks whose fight row was deleted (fight_id NULL)
        picks = sb.table("user_fight_predictions").select(PICK_COLS).eq("event_name", args.event).execute().data
    except Exception as e:
        print(f"{now} query failed: {e}", flush=True)
        time.sleep(args.interval)
        continue

    changes = []
    for kind, rows in (("fight", fights), ("pick", picks)):
        for r in rows:
            key = (kind, r["id"])
            if last.get(key) != r:
                changes.append({"t": now, "kind": kind, "prev": last.get(key), "row": r})
                last[key] = r
    seen = {("fight", f["id"]) for f in fights} | {("pick", p["id"]) for p in picks}
    for key in [k for k in last if k not in seen]:
        changes.append({"t": now, "kind": key[0], "gone": last.pop(key)})

    health = poller_health(args.interval)
    if health is not None:
        changes.append({"t": now, "kind": "poller", "rows": health})

    with LOG.open("a", encoding="utf-8") as fh:
        for c in changes:
            fh.write(json.dumps(c, ensure_ascii=False, default=str) + "\n")

    ended = sum(1 for f in fights if f["fight_ended_at"])
    started = sum(1 for f in fights if f["fight_started_at"])
    won = sum(1 for f in fights if f["winner"] is not None)
    codes = ",".join(f"{h.get('status_code')}x{h.get('n')}" for h in (health or []) if 'n' in h) or "-"
    print(f"{now[11:19]}Z  fights {len(fights)}  started {started}  ended {ended}  winner {won}  "
          f"picks {len(picks)}  changes {len(changes)}  poller[{codes}]", flush=True)

    if fights and all(f["fight_ended_at"] and f["winner"] is not None for f in fights):
        print("All bouts ended with winners. Watcher complete.", flush=True)
        break
    if time.time() - start > args.max_hours * 3600:
        print(f"{args.max_hours}h cap reached. Watcher stopping.", flush=True)
        break
    time.sleep(args.interval)
