"""
deploy_indexes.py — version-controls and deploys database indexes.

All indexes use CREATE INDEX IF NOT EXISTS — safe to re-run at any time.
fights.fight_url already has a UNIQUE constraint (from migrate_round_stats_fk.py)
which creates its index automatically; not duplicated here.

Run: python supabase/deploy_indexes.py
Requires: REACT_APP_SUPABASE_URL and SUPABASE_MANAGEMENT_KEY in .env
"""

import sys
import os
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env")

url      = os.environ.get("REACT_APP_SUPABASE_URL", "")
mgmt_key = os.environ.get("SUPABASE_MANAGEMENT_KEY", "")

if not url or not mgmt_key:
    raise SystemExit("Missing REACT_APP_SUPABASE_URL or SUPABASE_MANAGEMENT_KEY in .env")

project_ref = url.replace("https://", "").split(".")[0]
api_url = f"https://api.supabase.com/v1/projects/{project_ref}/database/query"
headers = {"Authorization": f"Bearer {mgmt_key}", "Content-Type": "application/json"}

# ── SQL ────────────────────────────────────────────────────────────────────────

INDEXES_SQL = """
-- judge_scores: date is the join key for all RPC queries (±1 day window, never eq)
CREATE INDEX IF NOT EXISTS idx_judge_scores_date
  ON judge_scores (date);

-- judge_scores: judge name is filtered on every judge profile query
CREATE INDEX IF NOT EXISTS idx_judge_scores_judge
  ON judge_scores (judge);

-- fight_meta_details: fight_url is the canonical join key across all tables
CREATE INDEX IF NOT EXISTS idx_fight_meta_details_fight_url
  ON fight_meta_details (fight_url);

-- fight_meta_details: weight_class_clean is the division filter for Phase 5 analytics
CREATE INDEX IF NOT EXISTS idx_fight_meta_details_weight_class_clean
  ON fight_meta_details (weight_class_clean);

-- round_fight_stats: (event_name, bout) is the join used by the fight_dna_metrics view
CREATE INDEX IF NOT EXISTS idx_round_fight_stats_event_bout
  ON round_fight_stats (event_name, bout);

-- user_round_scores: (user_id, fight_id) is the primary filter for all scoring RPCs
CREATE INDEX IF NOT EXISTS idx_user_round_scores_user_fight
  ON user_round_scores (user_id, fight_id);
"""

# ── Deploy ─────────────────────────────────────────────────────────────────────

def run_sql(label, sql):
    print(f"Deploying: {label}...")
    resp = requests.post(api_url, headers=headers, json={"query": sql})
    if resp.status_code >= 400:
        print(f"  ERROR {resp.status_code}: {resp.text}")
        sys.exit(1)
    print(f"  OK ({resp.status_code})")

run_sql("all indexes (IF NOT EXISTS — safe to re-run)", INDEXES_SQL)
print("\nAll indexes deployed successfully.")
