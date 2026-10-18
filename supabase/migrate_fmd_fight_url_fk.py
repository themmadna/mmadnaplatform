"""
migrate_fmd_fight_url_fk.py — S-P2-12: FK fight_meta_details.fight_url → fights.fight_url.

Why: every fmd row already belongs to a fights row (0 orphans, verified 2026-05-16 and again
2026-10-18), but nothing enforced it. The FK makes that a rule and cleans up after the
scraper's auto-delete of a cancelled fight. Mirrors round_fight_stats_fight_url_fkey exactly:
ON DELETE CASCADE, DEFERRABLE INITIALLY DEFERRED (checked at commit, so a write order inside
one transaction never trips it).

Why it can't break the scraper (checked 2026-10-18):
  - sync_meta() inserts fmd only for completed fights, using that fights row's own fight_url
    (parse_fight_meta_details returns the URL it was given).
  - fights.fight_url is only rewritten on the upcoming → completed transition, and upcoming
    fights never have an fmd row — so no fmd row ever points at a URL that changes.
  - The only fights DELETE is the auto-delete of cancelled (never-completed) bouts.
  - fights.fight_url already has a UNIQUE index (fights_fight_url_key); fmd.fight_url is
    indexed (idx_fight_meta_details_fight_url), so the cascade doesn't scan.

Pre-flight aborts on: missing unique index, NULL or orphaned fmd.fight_url. After adding the
FK, a rolled-back test proves it rejects an unknown URL and that deleting a fight takes its
fmd row with it.

Run once:
    python supabase/migrate_fmd_fight_url_fk.py

Idempotent: safe to re-run (skips the ADD if the constraint exists).

To undo:
    ALTER TABLE fight_meta_details DROP CONSTRAINT IF EXISTS fight_meta_details_fight_url_fkey;
"""

import re
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

FK_NAME = "fight_meta_details_fight_url_fkey"


def run_sql(sql: str):
    r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": sql}, timeout=60)
    if not r.ok:
        print(f"FAIL query {r.status_code}: {r.text}")
        sys.exit(1)
    return r.json()


print("Pre-flight:")
uniq = run_sql("""
    SELECT 1 FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = 'public.fights'::regclass AND i.indisunique
      AND i.indnatts = 1 AND a.attname = 'fight_url';
""")
print("  fights.fight_url unique:", bool(uniq))
stats = run_sql("""
    SELECT count(*) AS n,
           count(*) FILTER (WHERE m.fight_url IS NULL) AS nulls,
           count(*) FILTER (WHERE m.fight_url IS NOT NULL
                            AND NOT EXISTS (SELECT 1 FROM fights f WHERE f.fight_url = m.fight_url)) AS orphans
    FROM fight_meta_details m;
""")[0]
print(f"  fmd rows: {stats['n']}  null fight_url: {stats['nulls']}  orphans: {stats['orphans']}")
if not uniq or stats['nulls'] or stats['orphans']:
    print("\nABORT — fix the pre-flight failures above first. Nothing changed.")
    sys.exit(1)

existing = run_sql(f"""
    SELECT pg_get_constraintdef(oid) AS d FROM pg_constraint
    WHERE conrelid = 'public.fight_meta_details'::regclass AND conname = '{FK_NAME}';
""")
if existing:
    print(f"\n{FK_NAME} already exists — skipping ADD.")
else:
    print("\nAdding FK...")
    run_sql(f"""
        ALTER TABLE fight_meta_details
          ADD CONSTRAINT {FK_NAME}
          FOREIGN KEY (fight_url) REFERENCES fights(fight_url)
          ON DELETE CASCADE
          DEFERRABLE INITIALLY DEFERRED;
    """)
    print("  done.")

print("\nVerifying...")
d = run_sql(f"""
    SELECT pg_get_constraintdef(oid) AS d, convalidated FROM pg_constraint
    WHERE conrelid = 'public.fight_meta_details'::regclass AND conname = '{FK_NAME}';
""")
print("  constraint:", d[0]['d'] if d else "MISSING", "| validated:", d[0]['convalidated'] if d else None)
ok_fk = bool(d) and d[0]['convalidated'] and 'ON DELETE CASCADE' in d[0]['d']
after = run_sql("SELECT count(*) AS n FROM fight_meta_details;")[0]['n']
print(f"  fmd rows: {after} (before: {stats['n']})")

# Rolled back: the DO block always raises, carrying its report out on the error.
print("\nBehaviour test (rolled back):")
r = requests.post(MGMT_QUERY_URL, headers=HEADERS, timeout=60, json={"query": """
DO $t$
DECLARE
  m_id uuid; m_url text; reject text := 'NOT rejected'; gone boolean;
BEGIN
  SET CONSTRAINTS ALL IMMEDIATE;
  -- fmd.id is a uuid; any completed fight with metadata will do.
  SELECT m.id, m.fight_url INTO m_id, m_url
    FROM fight_meta_details m JOIN fights f ON f.fight_url = m.fight_url
   ORDER BY f.id DESC LIMIT 1;

  BEGIN
    UPDATE fight_meta_details SET fight_url = 'https://example.invalid/no-such-fight' WHERE id = m_id;
  EXCEPTION WHEN foreign_key_violation THEN
    reject := 'rejected';
  END;

  DELETE FROM fights WHERE fight_url = m_url;
  gone := NOT EXISTS (SELECT 1 FROM fight_meta_details WHERE id = m_id);

  RAISE EXCEPTION 'FKTEST unknown_url=% cascade=%', reject, CASE WHEN gone THEN 'deleted' ELSE 'NOT deleted' END;
END
$t$;
"""})
m = re.search(r"FKTEST unknown_url=(NOT rejected|rejected) cascade=(NOT deleted|deleted)", r.text)
report = m.group(0) if m else f"no FKTEST line (HTTP {r.status_code}): {r.text[:500]}"
print("  " + report)
ok_test = report == "FKTEST unknown_url=rejected cascade=deleted"

if not ok_fk or after != stats['n'] or not ok_test:
    print("\nVERIFY FAILED — check the output above. Undo SQL is in this script's docstring.")
    sys.exit(1)
print("\nS-P2-12 complete.")
