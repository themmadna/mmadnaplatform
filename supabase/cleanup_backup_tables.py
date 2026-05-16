"""
cleanup_backup_tables.py — Drop leftover backup tables from the April 2026 migration.

Audit ref: memory/audits/2026-05-16/01-security.md §1, followups #1

Background:
  - user_votes_backup     (130 rows, real user UUIDs)
  - fight_ratings_backup  (8500 rows, aggregate counts)

Both have RLS disabled and anon has SELECT/INSERT/UPDATE/DELETE/TRUNCATE.
Anyone with the React bundle's anon key can read every historical vote with
user_id intact. The tables are leftover snapshots — superseded by the live
user_votes / fight_ratings tables. No code references them.

Run once:
    python supabase/cleanup_backup_tables.py

Pre-flight checks (abort if any fail):
  - user_votes count >= user_votes_backup count
  - fight_ratings count >= fight_ratings_backup count
  - Both backup tables exist
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
        print(f"❌ Query failed {r.status_code}: {r.text}")
        sys.exit(1)
    return r.json()


# ---------------------------------------------------------------
# Pre-flight
# ---------------------------------------------------------------
print("Pre-flight: counting live vs backup tables...")

PREFLIGHT_SQL = """
SELECT
  (SELECT COUNT(*) FROM user_votes)                                                AS live_user_votes,
  (SELECT COUNT(*) FROM user_votes_backup)                                         AS backup_user_votes,
  (SELECT COUNT(*) FROM fight_ratings)                                             AS live_fight_ratings,
  (SELECT COUNT(*) FROM fight_ratings_backup)                                      AS backup_fight_ratings,
  (SELECT to_regclass('public.user_votes_backup') IS NOT NULL)                     AS user_votes_backup_exists,
  (SELECT to_regclass('public.fight_ratings_backup') IS NOT NULL)                  AS fight_ratings_backup_exists;
"""

rows = run_sql(PREFLIGHT_SQL)
if not rows:
    print("❌ Pre-flight returned no rows")
    sys.exit(1)

row = rows[0]
live_uv     = int(row["live_user_votes"])
backup_uv   = int(row["backup_user_votes"])
live_fr     = int(row["live_fight_ratings"])
backup_fr   = int(row["backup_fight_ratings"])
uv_exists   = bool(row["user_votes_backup_exists"])
fr_exists   = bool(row["fight_ratings_backup_exists"])

print(f"  user_votes              live={live_uv:>6}  backup={backup_uv:>6}")
print(f"  fight_ratings           live={live_fr:>6}  backup={backup_fr:>6}")
print(f"  user_votes_backup       exists={uv_exists}")
print(f"  fight_ratings_backup    exists={fr_exists}")

if not uv_exists and not fr_exists:
    print("✅ Both backup tables already dropped — nothing to do.")
    sys.exit(0)

if live_uv < backup_uv:
    print(f"❌ Abort: live user_votes ({live_uv}) < backup ({backup_uv}). Live data may be missing.")
    sys.exit(1)

if live_fr < backup_fr:
    print(f"❌ Abort: live fight_ratings ({live_fr}) < backup ({backup_fr}). Live data may be missing.")
    sys.exit(1)

print("✅ Pre-flight passed. Proceeding with DROP.")


# ---------------------------------------------------------------
# Drop
# ---------------------------------------------------------------
DROP_SQL = """
DROP TABLE IF EXISTS public.user_votes_backup;
DROP TABLE IF EXISTS public.fight_ratings_backup;
"""

run_sql(DROP_SQL)


# ---------------------------------------------------------------
# Verify
# ---------------------------------------------------------------
VERIFY_SQL = """
SELECT
  (SELECT to_regclass('public.user_votes_backup') IS NOT NULL)    AS user_votes_backup_exists,
  (SELECT to_regclass('public.fight_ratings_backup') IS NOT NULL) AS fight_ratings_backup_exists;
"""
rows = run_sql(VERIFY_SQL)
row = rows[0]
if not row["user_votes_backup_exists"] and not row["fight_ratings_backup_exists"]:
    print("✅ Dropped: user_votes_backup, fight_ratings_backup")
else:
    print(f"❌ Drop incomplete: {row}")
    sys.exit(1)
