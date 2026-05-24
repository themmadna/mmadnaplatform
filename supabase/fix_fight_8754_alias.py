"""
fix_fight_8754_alias.py — Resolve the Patricio Pitbull / Patricio Freire alias
duplicate on fight 8754 (UFC 327: Prochazka vs Ulberg).

Audit ref: memory/audits/2026-05-16/04-data-quality.md §4, followups #6 (S-P1-6)

Background:
  Fight 8754 (Pico vs Pitbull, decision win for Pico) was scraped under two name
  variants:
    - fights.bout              = "Patricio Freire vs Aaron Pico"   (alias)
    - fight_meta_details.bout  = "Patricio Pitbull vs Aaron Pico"  (canonical)
    - round_fight_stats        = 12 rows (3R x 2 fighters x 2 bout variants)
                                 -- both sets identical; both have
                                 fighter_name='Patricio Pitbull' and same stats
    - judge_scores.bout        = "Aaron Pico vs Patricio Freire" (mmadecisions;
                                 joins via date, not bout -- irrelevant)

  Symptom in production:
    - fight_dna_metrics view aggregates rfs by (event_name, bout) then joins to
      fights.bout. Currently it picks up the "Freire" rfs set (matches fights.bout)
      and returns correct single-fight stats -- so live fight detail UI is fine.
    - Any per-fighter rollup that GROUP BYs round_fight_stats.fighter_name
      double-counts Pitbull's strikes for this fight (6 rows instead of 3).
    - The bout-reversal census reports 1 "neither" combo (this fight) -- the only
      one in the entire 8685-row joined set.

  Canonical pick: "Patricio Pitbull"
    - matches fmd.bout
    - matches fmd.fighter1_name
    - matches round_fight_stats.fighter_name on BOTH duplicate sets
    - matches what ufcstats currently shows on the fight-details page

  No user data is attached to this fight (0 votes / 0 round_scores / 0 scorecard
  state / 0 ratings row). So no risk of orphaning user-facing data.

Fix (single transaction):
  1) UPDATE fights.bout to the canonical name
  2) DELETE the 6 stale rfs rows under the Freire bout text

Why UPDATE before DELETE:
  The fight_dna_metrics view joins fights.bout = rfs.bout. If we DELETE first
  and the script is interrupted before the UPDATE, the view briefly returns no
  rows for this fight. Doing both in a single transaction makes that impossible,
  but the order is still defensive.

Run once:
    python supabase/fix_fight_8754_alias.py

Idempotent: re-running after success is a no-op (script detects fights.bout
already canonical and rfs Freire rows already gone, then exits).
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

CANONICAL_BOUT = "Patricio Pitbull vs Aaron Pico"
ALIAS_BOUT     = "Patricio Freire vs Aaron Pico"
EVENT_NAME     = "UFC 327: Prochazka vs Ulberg"
FIGHT_ID       = 8754


def run_sql(sql: str):
    r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": sql}, timeout=30)
    if not r.ok:
        print(f"FAIL query {r.status_code}: {r.text}")
        sys.exit(1)
    return r.json()


# ---------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------
print("Pre-flight: gathering current state...")

PREFLIGHT_SQL = """
SELECT
  (SELECT bout FROM fights WHERE id = 8754)                                       AS fights_bout,
  (SELECT winner FROM fights WHERE id = 8754)                                     AS fights_winner,
  (SELECT bout FROM fight_meta_details
   WHERE fight_url = (SELECT fight_url FROM fights WHERE id = 8754))              AS fmd_bout,
  (SELECT COUNT(*) FROM round_fight_stats
   WHERE event_name = 'UFC 327: Prochazka vs Ulberg'
     AND bout = 'Patricio Freire vs Aaron Pico')                                  AS rfs_alias_rows,
  (SELECT COUNT(*) FROM round_fight_stats
   WHERE event_name = 'UFC 327: Prochazka vs Ulberg'
     AND bout = 'Patricio Pitbull vs Aaron Pico')                                 AS rfs_canonical_rows,
  (SELECT COUNT(*) FROM user_votes WHERE fight_id = 8754)                         AS user_votes,
  (SELECT COUNT(*) FROM user_round_scores WHERE fight_id = 8754)                  AS user_round_scores,
  (SELECT COUNT(*) FROM user_fight_scorecard_state WHERE fight_id = 8754)         AS user_scorecard_state,
  (SELECT COUNT(*) FROM fight_ratings WHERE fight_id = 8754)                      AS fight_ratings;
"""

rows = run_sql(PREFLIGHT_SQL)
if not rows:
    print("FAIL pre-flight returned no rows")
    sys.exit(1)

r = rows[0]
fights_bout         = r["fights_bout"]
fights_winner       = r["fights_winner"]
fmd_bout            = r["fmd_bout"]
rfs_alias_rows      = int(r["rfs_alias_rows"])
rfs_canonical_rows  = int(r["rfs_canonical_rows"])
user_votes          = int(r["user_votes"])
user_round_scores   = int(r["user_round_scores"])
user_scorecard      = int(r["user_scorecard_state"])
ratings_row         = int(r["fight_ratings"])

print(f"  fights.bout                    = {fights_bout!r}")
print(f"  fights.winner                  = {fights_winner!r}")
print(f"  fmd.bout (joined on fight_url) = {fmd_bout!r}")
print(f"  rfs alias rows ('Freire')      = {rfs_alias_rows}")
print(f"  rfs canonical rows ('Pitbull') = {rfs_canonical_rows}")
print(f"  user_votes attached            = {user_votes}")
print(f"  user_round_scores attached     = {user_round_scores}")
print(f"  user_fight_scorecard_state     = {user_scorecard}")
print(f"  fight_ratings row              = {ratings_row}")

# Idempotency check: already fixed?
if fights_bout == CANONICAL_BOUT and rfs_alias_rows == 0 and rfs_canonical_rows == 6:
    print("OK already canonical - nothing to do.")
    sys.exit(0)

# Guardrails
errors = []

if fights_bout not in (CANONICAL_BOUT, ALIAS_BOUT):
    errors.append(f"fights.bout is unexpected: {fights_bout!r}")

if fmd_bout != CANONICAL_BOUT:
    errors.append(f"fmd.bout is not canonical: {fmd_bout!r} (expected {CANONICAL_BOUT!r})")

if rfs_alias_rows != 6:
    errors.append(f"rfs alias rows = {rfs_alias_rows}, expected 6")

if rfs_canonical_rows != 6:
    errors.append(f"rfs canonical rows = {rfs_canonical_rows}, expected 6 -- canonical set is incomplete; aborting")

if user_votes or user_round_scores or user_scorecard or ratings_row:
    errors.append(
        f"user data attached (votes={user_votes}, scores={user_round_scores}, "
        f"state={user_scorecard}, ratings={ratings_row}) -- audit said 0; re-check before deleting"
    )

if errors:
    print("\nFAIL pre-flight guardrails tripped:")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)

print("\nOK pre-flight passed. Applying fix in a single transaction...")


# ---------------------------------------------------------------
# Apply (single transaction)
# ---------------------------------------------------------------
APPLY_SQL = f"""
BEGIN;
  UPDATE public.fights
  SET bout = '{CANONICAL_BOUT}'
  WHERE id = {FIGHT_ID}
    AND bout = '{ALIAS_BOUT}';

  DELETE FROM public.round_fight_stats
  WHERE event_name = '{EVENT_NAME}'
    AND bout = '{ALIAS_BOUT}';
COMMIT;
"""

run_sql(APPLY_SQL)


# ---------------------------------------------------------------
# Verify
# ---------------------------------------------------------------
print("Verifying post-state...")

VERIFY_SQL = """
SELECT
  (SELECT bout FROM fights WHERE id = 8754)                                       AS fights_bout,
  (SELECT COUNT(*) FROM round_fight_stats
   WHERE event_name = 'UFC 327: Prochazka vs Ulberg'
     AND bout = 'Patricio Freire vs Aaron Pico')                                  AS rfs_alias_rows,
  (SELECT COUNT(*) FROM round_fight_stats
   WHERE event_name = 'UFC 327: Prochazka vs Ulberg'
     AND bout = 'Patricio Pitbull vs Aaron Pico')                                 AS rfs_canonical_rows,
  -- bout-reversal census across all joined fights: should now show 0 "neither"
  (SELECT COUNT(*) FROM fights f
   JOIN fight_meta_details m ON m.fight_url = f.fight_url
   WHERE f.bout <> m.bout
     AND f.bout <> TRIM(SPLIT_PART(m.bout, ' vs ', 2)) || ' vs ' ||
                   TRIM(SPLIT_PART(m.bout, ' vs ', 1)))                           AS bout_census_neither,
  -- fight_dna_metrics returns a row with same/correct numbers
  (SELECT raw_head_strikes FROM fight_dna_metrics WHERE fight_id = 8754)          AS dna_head_strikes,
  (SELECT metric_duration  FROM fight_dna_metrics WHERE fight_id = 8754)          AS dna_duration;
"""

rows = run_sql(VERIFY_SQL)
if not rows:
    print("FAIL verify returned no rows")
    sys.exit(1)

v = rows[0]
ok = (
    v["fights_bout"]           == CANONICAL_BOUT and
    int(v["rfs_alias_rows"])     == 0            and
    int(v["rfs_canonical_rows"]) == 6            and
    int(v["bout_census_neither"]) == 0           and
    v["dna_head_strikes"] is not None            and
    v["dna_duration"]     is not None
)

print(f"  fights.bout                    = {v['fights_bout']!r}")
print(f"  rfs alias rows ('Freire')      = {v['rfs_alias_rows']}")
print(f"  rfs canonical rows ('Pitbull') = {v['rfs_canonical_rows']}")
print(f"  bout-reversal 'neither' census = {v['bout_census_neither']}")
print(f"  fight_dna_metrics head strikes = {v['dna_head_strikes']}")
print(f"  fight_dna_metrics duration min = {v['dna_duration']}")

if not ok:
    print("\nFAIL verify mismatch")
    sys.exit(1)

print("\nOK fight 8754 alias resolved.")
print("   - fights.bout canonical (Pitbull); 6 rfs rows survive; 0 'neither' in census;")
print("   - fight_dna_metrics view still returns correct single-fight stats.")
