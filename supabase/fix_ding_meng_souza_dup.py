"""
fix_ding_meng_souza_dup.py — Merge the Ding Meng name-variant duplicate on
UFC Fight Night: Song vs Figueiredo (2026-05-30).

Background
----------
ufcstats names Ding Meng's opponent "Jose Souza"; ESPN names him "Jose Henrique"
(same fighter, two source names — NOT a replaced opponent; ESPN comp 401871900
is FINAL as "Ding Meng vs Jose Henrique"). Result: two rows for one fight:

  id 8838  "Ding Meng vs Jose Henrique"  status=upcoming, winner=NULL
           carries the ESPN live data (espn_competition_id, card_position,
           scheduled_rounds, fight_started_at, fight_ended_at) but a bogus
           fighter-details fight_url with 0 fmd / 0 rfs.
  id 8856  "Jose Souza vs Ding Meng"     status=completed, winner=Jose Souza
           carries the real fight_url + 1 fmd + 6 rfs (split decision, 3 rounds),
           but NO ESPN comp_id / timestamps / card_position.

Both rows have ZERO user data (votes/scores/state/ratings), so the merge is
lossless. We keep 8856 (the canonical completed row), port the ESPN live fields
from 8838 onto it, and delete 8838.

Safety
------
- Read-only pre-flight asserts both rows match the expected state and that
  neither carries user data; aborts otherwise.
- Idempotent: if 8838 is already gone and 8856 already has the comp_id, exits clean.
- Single-transaction UPDATE-then-DELETE so the card never briefly loses the fight.

Usage
-----
    python supabase/fix_ding_meng_souza_dup.py            # read-only pre-flight
    python supabase/fix_ding_meng_souza_dup.py --apply    # perform the merge
"""

import sys, os, json, argparse, requests
from pathlib import Path
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
load_dotenv(dotenv_path=Path(__file__).parent.parent / '.env')

supabase_url = os.environ.get("REACT_APP_SUPABASE_URL", "")
mgmt_key     = os.environ.get("SUPABASE_MANAGEMENT_KEY", "")
if not supabase_url or not mgmt_key:
    raise SystemExit("Missing REACT_APP_SUPABASE_URL or SUPABASE_MANAGEMENT_KEY in .env")

project_ref = supabase_url.replace("https://", "").split(".")[0]
QUERY_URL = f"https://api.supabase.com/v1/projects/{project_ref}/database/query"
HEADERS = {"Authorization": f"Bearer {mgmt_key}", "Content-Type": "application/json"}

ORPHAN_ID = 8838   # "Ding Meng vs Jose Henrique" — ESPN-named live-poll leftover
CANON_ID  = 8856   # "Jose Souza vs Ding Meng"   — canonical completed row
EXPECTED_COMP = "401871900"


def q(sql):
    r = requests.post(QUERY_URL, headers=HEADERS, json={"query": sql})
    if r.status_code not in (200, 201):
        raise SystemExit(f"Query failed {r.status_code}: {r.text[:300]}")
    return r.json()


def user_data_counts(fid):
    rows = q(f"""
        SELECT
          (SELECT count(*) FROM user_votes WHERE fight_id={fid}) v,
          (SELECT count(*) FROM user_round_scores WHERE fight_id={fid}) s,
          (SELECT count(*) FROM user_fight_scorecard_state WHERE fight_id={fid}) st,
          (SELECT count(*) FROM fight_ratings WHERE fight_id={fid}) r;
    """)[0]
    return rows["v"], rows["s"], rows["st"], rows["r"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="perform the merge (default: read-only pre-flight)")
    args = ap.parse_args()

    rows = {r["id"]: r for r in q(f"""
        SELECT id, bout, status, winner, fight_url, espn_competition_id,
               card_position, scheduled_rounds, fight_started_at, fight_ended_at
        FROM fights WHERE id IN ({ORPHAN_ID},{CANON_ID});
    """)}

    canon = rows.get(CANON_ID)
    orphan = rows.get(ORPHAN_ID)

    # Idempotency: orphan already merged away.
    if orphan is None:
        if canon and canon["espn_competition_id"] == EXPECTED_COMP:
            print(f"✅ Already merged — {ORPHAN_ID} gone and {CANON_ID} has comp_id {EXPECTED_COMP}. No-op.")
            return
        raise SystemExit(f"❌ Orphan {ORPHAN_ID} missing but {CANON_ID} not in expected merged state — aborting, investigate.")

    # --- Pre-flight assertions ---
    problems = []
    if not canon:
        problems.append(f"canonical row {CANON_ID} not found")
    else:
        if canon["status"] != "completed":   problems.append(f"{CANON_ID} status={canon['status']} (want completed)")
        if canon["winner"] != "Jose Souza":  problems.append(f"{CANON_ID} winner={canon['winner']!r} (want 'Jose Souza')")
    if orphan["status"] != "upcoming":             problems.append(f"{ORPHAN_ID} status={orphan['status']} (want upcoming)")
    if orphan["espn_competition_id"] != EXPECTED_COMP:
        problems.append(f"{ORPHAN_ID} comp_id={orphan['espn_competition_id']} (want {EXPECTED_COMP})")

    cu = user_data_counts(CANON_ID); ou = user_data_counts(ORPHAN_ID)
    if any(cu): problems.append(f"{CANON_ID} has user data {cu} (want all 0)")
    if any(ou): problems.append(f"{ORPHAN_ID} has user data {ou} (want all 0)")

    fmd_rfs = q(f"""
        SELECT (SELECT count(*) FROM fight_meta_details WHERE fight_url='{canon['fight_url']}') fmd,
               (SELECT count(*) FROM round_fight_stats   WHERE fight_url='{canon['fight_url']}') rfs;
    """)[0] if canon else {"fmd":0,"rfs":0}
    if fmd_rfs["fmd"] < 1: problems.append(f"{CANON_ID} fight_url has {fmd_rfs['fmd']} fmd rows (want >=1)")
    if fmd_rfs["rfs"] < 1: problems.append(f"{CANON_ID} fight_url has {fmd_rfs['rfs']} rfs rows (want >=1)")

    print("--- PRE-FLIGHT ---")
    print(f"orphan {ORPHAN_ID}: {orphan['bout']!r} status={orphan['status']} comp={orphan['espn_competition_id']} "
          f"card_pos={orphan['card_position']} rounds={orphan['scheduled_rounds']} "
          f"started={orphan['fight_started_at']} ended={orphan['fight_ended_at']} user_data={ou}")
    print(f"canon  {CANON_ID}: {canon['bout']!r} status={canon['status']} winner={canon['winner']} "
          f"fmd={fmd_rfs['fmd']} rfs={fmd_rfs['rfs']} comp={canon['espn_competition_id']} user_data={cu}")

    if problems:
        print("\n❌ PRE-FLIGHT FAILED — not safe to merge:")
        for p in problems: print("   •", p)
        raise SystemExit(1)
    print("\n✅ PRE-FLIGHT PASSED — safe to merge (no user data at risk).")

    if not args.apply:
        print("\nDry run. Re-run with --apply to perform the merge.")
        return

    # --- Merge: single transaction, UPDATE then DELETE ---
    print("\n🔧 Applying merge...")
    q(f"""
        BEGIN;
        UPDATE fights c SET
          espn_competition_id = o.espn_competition_id,
          card_position       = o.card_position,
          scheduled_rounds    = o.scheduled_rounds,
          fight_started_at    = o.fight_started_at,
          fight_ended_at      = o.fight_ended_at
        FROM fights o
        WHERE c.id = {CANON_ID} AND o.id = {ORPHAN_ID}
          AND c.espn_competition_id IS NULL;
        DELETE FROM fights WHERE id = {ORPHAN_ID};
        COMMIT;
    """)

    # --- Post-verify ---
    post = {r["id"]: r for r in q(f"""
        SELECT id, bout, status, winner, espn_competition_id, card_position,
               scheduled_rounds, fight_started_at, fight_ended_at
        FROM fights WHERE id IN ({ORPHAN_ID},{CANON_ID});
    """)}
    n = q("""SELECT count(*) c FROM fights WHERE event_name='UFC Fight Night: Song vs Figueiredo';""")[0]["c"]
    print("--- POST-VERIFY ---")
    print(f"orphan {ORPHAN_ID} present: {ORPHAN_ID in post} (want False)")
    print(f"canon  {CANON_ID}: {json.dumps(post.get(CANON_ID), default=str)}")
    print(f"event fight count now: {n} (was 14)")
    ok = (ORPHAN_ID not in post and post.get(CANON_ID, {}).get("espn_competition_id") == EXPECTED_COMP)
    print("\n" + ("✅ MERGE COMPLETE." if ok else "⚠️  Unexpected post-state — verify manually."))


if __name__ == "__main__":
    main()
