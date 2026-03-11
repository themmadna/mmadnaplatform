"""
check_scoring_coverage.py — Diagnose round_fight_stats coverage for scored fights.
Also shows distinct users and optionally clears all scored fight data.

Usage:
    python supabase/check_scoring_coverage.py
    python supabase/check_scoring_coverage.py --clear   (deletes all user_round_scores + state)
"""

import sys
import os
import json
import requests
import argparse
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

def run(sql):
    resp = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": sql}, timeout=20)
    if not resp.ok:
        print(f"❌ Error {resp.status_code}: {resp.text}")
        return []
    return resp.json()

parser = argparse.ArgumentParser()
parser.add_argument("--clear", action="store_true", help="Delete all scored fight data")
args = parser.parse_args()

# ── 1. How many distinct users have scored? ──────────────────────────────────
print("\n── Distinct scorers ─────────────────────────────────────────────────")
rows = run("SELECT user_id, COUNT(*) AS rounds FROM user_round_scores GROUP BY user_id ORDER BY rounds DESC;")
for r in rows:
    print(f"  {r['user_id']}  {r['rounds']} rounds")
print(f"  Total users: {len(rows)}")

# ── 2. Per weight class: scored rounds vs rounds with fight stats ─────────────
print("\n── Weight class coverage (scored rounds vs round_fight_stats available) ─")
rows = run("""
SELECT
  COALESCE(fmd.weight_class_clean, fmd.weight_class, 'Unknown') AS weight_class,
  COUNT(DISTINCT urs.fight_id || '-' || urs.round::text)        AS scored_rounds,
  COUNT(DISTINCT CASE WHEN rfs.id IS NOT NULL
        THEN urs.fight_id || '-' || urs.round::text END)        AS rounds_with_stats
FROM user_round_scores urs
JOIN fights f ON f.id = urs.fight_id
LEFT JOIN fight_meta_details fmd ON fmd.fight_url = f.fight_url
LEFT JOIN round_fight_stats rfs
  ON rfs.event_name = fmd.event_name
  AND rfs.bout = fmd.bout
  AND rfs.round = urs.round
GROUP BY weight_class
ORDER BY scored_rounds DESC;
""")
if rows:
    print(f"  {'Weight Class':<25} {'Scored Rds':>10} {'With Stats':>10} {'Coverage':>10}")
    print(f"  {'-'*25} {'-'*10} {'-'*10} {'-'*10}")
    for r in rows:
        scored = r['scored_rounds']
        with_stats = r['rounds_with_stats'] or 0
        pct = f"{int(with_stats/scored*100)}%" if scored else "—"
        print(f"  {r['weight_class']:<25} {scored:>10} {with_stats:>10} {pct:>10}")
else:
    print("  No scored rounds found.")

# ── 3. Optional: clear all scored fight data ─────────────────────────────────
if args.clear:
    print("\n── Clearing all scored fight data ───────────────────────────────────")
    confirm = input("  Type YES to confirm deletion of all user_round_scores and user_fight_scorecard_state: ")
    if confirm.strip() == "YES":
        run("DELETE FROM user_fight_scorecard_state;")
        run("DELETE FROM user_round_scores;")
        print("  ✅ Done — all scored data cleared.")
    else:
        print("  Aborted.")
