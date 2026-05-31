"""
cleanup_song_figueiredo_swaps.py — Delete 3 stale "upcoming" rows left by late
opponent swaps on UFC Fight Night: Song vs Figueiredo (2026-05-30).

Background:
  Three bouts had late opponent changes. ESPN re-created each competition under a
  new id, so the live poller could match neither espn_competition_id (we stored the
  old one) nor boutMatchesComp (needs both fighters). The original rows are frozen as
  status='upcoming', never started, while the *real* fights happened under a different
  second fighter:

    fight 8835  Muslim Salikhov vs Jake Matthews   ->  Jake Matthews vs Carlston Harris
    fight 8840  Rei Tsuruya vs Jesus Aguilar        ->  Rei Tsuruya vs Luis Gurule
    fight 8842  Zhu Kangjie vs Ramon Taveras        ->  Zhu Kangjie vs Rodrigo Vera

  Verified vs the ESPN scoreboard (all 13 bouts FINAL; only the 2nd fighter differs on
  these three). The frontend already HIDES never-started bouts once an event concludes,
  so this is DB hygiene, not a display fix.

Safety — this script REFUSES to delete until the real replacement bouts have landed:
  Pre-flight A: each target row still exists, status='upcoming', never started/ended.
  Pre-flight B: 0 user data attached (votes / round scores / scorecard state / ratings).
  Pre-flight C: each replacement bout (surviving fighter + NEW opponent) now exists as a
                completed fight for this event. If any is missing, ufcstats hasn't posted
                yet — the script aborts and asks you to re-run after the next scrape.
  Only if A, B, and C all pass does it DELETE the 3 stale rows.

Run (after ufcstats has posted + a scrape inserted the real bouts):
    python supabase/cleanup_song_figueiredo_swaps.py

Idempotent: if the target rows are already gone it reports and exits 0.
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

EVENT_LIKE = "%SONG%FIGUEIREDO%"

# target id -> (surviving fighter, NEW opponent) — used to confirm the real bout landed
TARGETS = {
    8835: ("Matthews", "Harris"),   # Jake Matthews vs Carlston Harris
    8840: ("Tsuruya", "Gurule"),    # Rei Tsuruya vs Luis Gurule
    8842: ("Zhu", "Vera"),          # Zhu Kangjie vs Rodrigo Vera
}
TARGET_IDS = list(TARGETS.keys())
IDS_SQL = ",".join(str(i) for i in TARGET_IDS)


def run_sql(sql: str):
    r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": sql}, timeout=30)
    if not r.ok:
        print(f"FAIL query {r.status_code}: {r.text}")
        sys.exit(1)
    return r.json()


# ---------------------------------------------------------------
# Idempotency check — already deleted?
# ---------------------------------------------------------------
existing = run_sql(f"SELECT id, bout, status, fight_started_at, fight_ended_at "
                   f"FROM fights WHERE id IN ({IDS_SQL}) ORDER BY id;")
if not existing:
    print("OK target rows already deleted — nothing to do.")
    sys.exit(0)

found_ids = {int(r["id"]) for r in existing}
print(f"Found {len(existing)} target row(s): {sorted(found_ids)}")
for r in existing:
    print(f"  id={r['id']}  {r['bout']!r}  status={r['status']}  "
          f"started={r['fight_started_at']}  ended={r['fight_ended_at']}")

# ---------------------------------------------------------------
# Pre-flight A — still upcoming + never started/ended
# ---------------------------------------------------------------
bad = [r for r in existing
       if r["status"] != "upcoming" or r["fight_started_at"] or r["fight_ended_at"]]
if bad:
    print("\nFAIL pre-flight A: a target row is no longer a clean never-started 'upcoming' "
          "row. Investigate before deleting — do NOT force.")
    sys.exit(1)
print("OK pre-flight A: all targets are clean 'upcoming', never started/ended.")

# ---------------------------------------------------------------
# Pre-flight B — zero user data attached
# ---------------------------------------------------------------
USER_DATA_SQL = f"""
SELECT 'user_votes' AS tbl, COUNT(*) AS n FROM user_votes WHERE fight_id IN ({IDS_SQL})
UNION ALL SELECT 'user_round_scores', COUNT(*) FROM user_round_scores WHERE fight_id IN ({IDS_SQL})
UNION ALL SELECT 'user_fight_scorecard_state', COUNT(*) FROM user_fight_scorecard_state WHERE fight_id IN ({IDS_SQL})
UNION ALL SELECT 'fight_ratings', COUNT(*) FROM fight_ratings WHERE fight_id IN ({IDS_SQL});
"""
user_rows = run_sql(USER_DATA_SQL)
total_user = sum(int(r["n"]) for r in user_rows)
for r in user_rows:
    print(f"  {r['tbl']}: {r['n']}")
if total_user > 0:
    print("\nFAIL pre-flight B: user data is attached to a target row. Stop — a real user "
          "scored/voted on this row. Investigate before deleting.")
    sys.exit(1)
print("OK pre-flight B: 0 user data on all targets.")

# ---------------------------------------------------------------
# Pre-flight C — the real replacement bouts have landed (completed)
# ---------------------------------------------------------------
print("\nPre-flight C: confirming each replacement bout exists as a completed fight...")
missing = []
for fid, (survivor, new_opp) in TARGETS.items():
    q = f"""
    SELECT id, bout, status FROM fights
    WHERE event_name ILIKE '{EVENT_LIKE}'
      AND status = 'completed'
      AND bout ILIKE '%{survivor}%'
      AND bout ILIKE '%{new_opp}%';
    """
    rows = run_sql(q)
    if rows:
        print(f"  ✓ {survivor} vs {new_opp}: found completed fight id={rows[0]['id']} ({rows[0]['bout']!r})")
    else:
        print(f"  ✗ {survivor} vs {new_opp}: NOT found as completed fight")
        missing.append(f"{survivor} vs {new_opp}")

if missing:
    print(f"\nABORT — the real replacement bout(s) haven't landed yet: {missing}")
    print("       ufcstats hasn't posted these results, or a scrape hasn't run since.")
    print("       Re-run this script after the next successful --live / master scrape.")
    sys.exit(2)
print("OK pre-flight C: all 3 replacement bouts present as completed fights.")

# ---------------------------------------------------------------
# Delete (CASCADE covers any user data; pre-flight B confirmed 0)
# ---------------------------------------------------------------
print(f"\nDeleting stale rows {sorted(found_ids)}...")
run_sql(f"DELETE FROM fights WHERE id IN ({IDS_SQL});")

# ---------------------------------------------------------------
# Verify
# ---------------------------------------------------------------
remaining = run_sql(f"SELECT id FROM fights WHERE id IN ({IDS_SQL});")
if remaining:
    print(f"FAIL verify: rows still present: {[r['id'] for r in remaining]}")
    sys.exit(1)
print("OK deleted. The 3 stale opponent-swap rows are gone; the real bouts remain.")
print("   This also lets is_live_window() / poll-live-fights guard-3 short-circuit again.")
