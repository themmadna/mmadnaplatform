"""
migrate_weight_class.py — Add weight_class_clean, is_title_fight, is_interim_title to fight_meta_details.

Run once:
    python supabase/migrate_weight_class.py
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


def run_sql(sql, label):
    r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": sql})
    if r.ok:
        print(f"✅ {label}")
        return r.json()
    else:
        print(f"❌ {label}: {r.status_code} {r.text}")
        return None


MIGRATION_SQL = """
ALTER TABLE fight_meta_details
  ADD COLUMN IF NOT EXISTS weight_class_clean text,
  ADD COLUMN IF NOT EXISTS is_title_fight boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_interim_title boolean DEFAULT false;
"""

BACKFILL_SQL = """
UPDATE fight_meta_details SET
  is_title_fight   = (weight_class ILIKE '%title%' OR weight_class ILIKE '%championship%'),
  is_interim_title = (weight_class ILIKE '%interim%'),
  weight_class_clean = TRIM(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(weight_class, '\\s*Bout\\s*$',            '', 'i'),
            '\\s*(Title|Championship)\\s*$', '',                         'i'),
          '\\s*Title\\s*',                   ' ',                        'i'),
        '^UFC\\s+Interim\\s+',               '',                         'i'),
      '^UFC\\s+',                            '',                         'i')
  );
"""

VERIFY_SQL = """
SELECT weight_class, weight_class_clean, is_title_fight, is_interim_title, COUNT(*) AS cnt
FROM fight_meta_details
GROUP BY 1, 2, 3, 4
ORDER BY cnt DESC
LIMIT 40;
"""

run_sql(MIGRATION_SQL, "Add columns")
run_sql(BACKFILL_SQL, "Backfill weight_class_clean / is_title_fight / is_interim_title")
result = run_sql(VERIFY_SQL, "Verify (top 40 groups)")

if result:
    print("\n--- Verification ---")
    for row in result:
        print(f"  {row.get('weight_class','')!r:50s} -> {row.get('weight_class_clean','')!r:30s}  title={row.get('is_title_fight')}  interim={row.get('is_interim_title')}  n={row.get('cnt')}")
