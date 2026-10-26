"""Deploy the judge_scores_coverage view (per-fight matching rewrite, 2026-10-26).

Runs supabase/views/judge_scores_coverage.sql via the Management API, then verifies:
  - grants on the view are unchanged (CREATE OR REPLACE keeps them),
  - status counts are sane,
  - Yan vs Dvalishvili 3 (UFC 333) counts its own 30 rows, not the date's.

    python supabase/deploy_judge_scores_coverage.py
"""
import os
import sys
from pathlib import Path

import requests
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
VIEW_SQL = Path(__file__).parent / "views" / "judge_scores_coverage.sql"


def run_sql(sql: str):
    r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": sql}, timeout=120)
    if not r.ok:
        print(f"FAIL query {r.status_code}: {r.text}")
        sys.exit(1)
    return r.json()


GRANTS_SQL = """
SELECT grantee, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privs
FROM information_schema.role_table_grants
WHERE table_name = 'judge_scores_coverage'
GROUP BY grantee ORDER BY grantee;
"""

grants_before = run_sql(GRANTS_SQL)

print(f"Deploying {VIEW_SQL.name}...")
run_sql(VIEW_SQL.read_text(encoding='utf-8'))
print("  view replaced")

grants_after = run_sql(GRANTS_SQL)
if grants_after != grants_before:
    print(f"FAIL - grants changed:\n  before {grants_before}\n  after  {grants_after}")
    sys.exit(1)
print(f"  grants unchanged ({len(grants_after)} roles)")

counts = run_sql("""
SELECT coverage_status, COUNT(*) AS n FROM judge_scores_coverage
GROUP BY 1 ORDER BY 1;
""")
print("\nStatus counts:")
for row in counts:
    print(f"  {row['coverage_status']:<9} {row['n']}")

yan = run_sql("""
SELECT score_rows_on_date, coverage_status, matched_bouts FROM judge_scores_coverage
WHERE event_date = '2026-10-24' AND fighter1_name = 'Petr Yan';
""")
if not yan or yan[0]['score_rows_on_date'] != 30 or yan[0]['coverage_status'] != 'complete':
    print(f"\nFAIL - Yan vs Dvalishvili 3 check: {yan}")
    sys.exit(1)
print(f"\nYan vs Dvalishvili 3: {yan[0]} ✅")
print("\n✅ judge_scores_coverage deployed.")
