"""
migrate_leaderboard_eligibility.py
  — Change leaderboard_eligible generated column to drop the scored_blind requirement.

Old: scored_blind AND NOT forfeited AND NOT modified_after_reveal
New: NOT forfeited AND NOT modified_after_reveal

Rationale: for historical fights, handleReveal() never fires (judgesRevealed is
forced true at load time), so scored_blind was never written to TRUE even when
the user scored blind. Eligibility is now determined solely by whether the user
forfeited or edited after reveal.

Safe to re-run (DROP IF EXISTS + ADD IF NOT EXISTS pattern).

Run once:
    python supabase/migrate_leaderboard_eligibility.py
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

MIGRATION_SQL = """
ALTER TABLE user_fight_scorecard_state DROP COLUMN IF EXISTS leaderboard_eligible;
ALTER TABLE user_fight_scorecard_state
  ADD COLUMN leaderboard_eligible boolean
  GENERATED ALWAYS AS (NOT forfeited AND NOT modified_after_reveal) STORED;
"""

r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": MIGRATION_SQL}, timeout=30)
if r.ok:
    print("✅ leaderboard_eligible redefined: NOT forfeited AND NOT modified_after_reveal")
    print("   All existing rows recomputed. Historical non-forfeited fights now eligible.")
else:
    print(f"❌ Migration failed {r.status_code}: {r.text}")
    sys.exit(1)
