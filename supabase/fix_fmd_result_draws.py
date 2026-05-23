"""
fix_fmd_result_draws.py — Set fmd.result = 'draw' on the 2 fights where it's
incorrectly stored as 'unknown'.

Context: 2026-05-23 investigation of audit S-P1-4. The audit flagged 3 fights with
NULL `fights.winner` as a Phase 3 parser failure. User confirmed all 3 are actually
draws on ufcstats (both fighters have "D" status). NULL winner is correct.

However, `fmd.result` for 2 of the 3 is "unknown" rather than "draw" — a separate
historical inconsistency (the current parser only emits "win" or "draw"; "unknown"
must come from an older code path or a one-off backfill).

Affected rows:
  fight_id 8269 — UFC Fight Night: Royval vs Kape — Nzechukwu vs Buchecha
  fight_id 8281 — UFC 323: Dvalishvili vs Yan 2  — Blachowicz vs Guskov

Already correct (no change): fight_id 8761 — fmd.result = 'draw'

Pre-flight (abort if any fail):
  - Each fight must still have winner NULL and result = 'unknown'
  - Each fight must be method LIKE 'Decision%' (sanity check it's not a TKO)

Run once:
    python supabase/fix_fmd_result_draws.py
"""

import sys
import os
import requests
import json
from pathlib import Path
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
load_dotenv(dotenv_path=Path(__file__).parent.parent / '.env')

supabase_url = os.environ.get("REACT_APP_SUPABASE_URL", "")
mgmt_key = os.environ.get("SUPABASE_MANAGEMENT_KEY", "")
if not supabase_url or not mgmt_key:
    raise SystemExit("Missing REACT_APP_SUPABASE_URL or SUPABASE_MANAGEMENT_KEY in .env")

project_ref = supabase_url.replace("https://", "").split(".")[0]
URL = f"https://api.supabase.com/v1/projects/{project_ref}/database/query"
HEADERS = {"Authorization": f"Bearer {mgmt_key}", "Content-Type": "application/json"}

TARGET_IDS = (8269, 8281)


def run_sql(sql: str):
    r = requests.post(URL, headers=HEADERS, json={"query": sql}, timeout=30)
    if not r.ok:
        print(f"❌ {r.status_code}: {r.text}")
        sys.exit(1)
    return r.json()


# ---------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------
print("Pre-flight: verifying current state of target rows...")

PRE_SQL = f"""
SELECT f.id, f.bout, f.winner AS fights_winner,
       fmd.winner AS fmd_winner, fmd.result, fmd.method
FROM fights f
JOIN fight_meta_details fmd ON fmd.fight_url = f.fight_url
WHERE f.id IN {TARGET_IDS}
ORDER BY f.id;
"""

rows = run_sql(PRE_SQL)
if len(rows) != 2:
    print(f"❌ Expected 2 rows, got {len(rows)}")
    sys.exit(1)

for r in rows:
    print(f"  id={r['id']:<6} bout={r['bout']!r}")
    print(f"      fights.winner={r['fights_winner']!r}  fmd.winner={r['fmd_winner']!r}  "
          f"fmd.result={r['result']!r}  fmd.method={r['method']!r}")
    if r['fights_winner'] is not None or r['fmd_winner'] is not None:
        print(f"  ❌ Abort: id={r['id']} has a winner now — re-evaluate before continuing.")
        sys.exit(1)
    if r['result'] != 'unknown':
        print(f"  ❌ Abort: id={r['id']} result={r['result']!r}, expected 'unknown'. Already fixed?")
        sys.exit(1)
    if not (r['method'] or '').lower().startswith('decision'):
        print(f"  ❌ Abort: id={r['id']} method={r['method']!r} doesn't look like a decision.")
        sys.exit(1)

print("\n✅ Pre-flight passed. Proceeding with UPDATE.\n")


# ---------------------------------------------------------------
# Update
# ---------------------------------------------------------------
UPDATE_SQL = f"""
UPDATE fight_meta_details fmd
SET result = 'draw'
FROM fights f
WHERE fmd.fight_url = f.fight_url
  AND f.id IN {TARGET_IDS}
  AND fmd.result = 'unknown'
  AND fmd.winner IS NULL
  AND f.winner IS NULL
RETURNING fmd.id, f.id AS fight_id, fmd.result;
"""

updated = run_sql(UPDATE_SQL)
print(f"Updated {len(updated)} rows:")
for u in updated:
    print(f"  fight_id={u['fight_id']}  fmd.id={u['id']}  result={u['result']!r}")


# ---------------------------------------------------------------
# Verify
# ---------------------------------------------------------------
verify = run_sql(PRE_SQL)  # reuse pre-flight SQL
print("\nPost-state:")
for r in verify:
    print(f"  id={r['id']:<6} fmd.result={r['result']!r}  fmd.winner={r['fmd_winner']!r}  "
          f"fights.winner={r['fights_winner']!r}")
    if r['result'] != 'draw':
        print(f"  ❌ Verify failed: id={r['id']} result={r['result']!r}")
        sys.exit(1)

print("\n✅ All 2 rows now have fmd.result = 'draw'.")
