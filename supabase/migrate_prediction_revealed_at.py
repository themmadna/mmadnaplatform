"""
migrate_prediction_revealed_at.py — Remember when a user revealed a pick's result.

Why: a graded pick ("Called it" / "Missed") names the winner, so under spoiler
protection it is hidden until the result is revealed. A result counts as revealed when
spoiler protection is off, the user has scored every round, or they tapped to reveal
it. That last one has to persist: a reveal that re-hid on every reload would make the
Picks tab feel broken. NULL = not explicitly revealed; clearing it (Hide in fight
detail) re-hides the result.

Same semantics as the fight-detail spoiler Reveal: it shows the winner only and has
no effect on scorecard eligibility (that's judges_revealed_at / forfeited on
user_fight_scorecard_state — a different, consequential reveal).

Run once:
    python supabase/migrate_prediction_revealed_at.py

Idempotent. To undo:
    ALTER TABLE user_fight_predictions DROP COLUMN revealed_at;
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
        print(f"FAIL query {r.status_code}: {r.text}")
        sys.exit(1)
    return r.json()


print("Applying migration...")
run_sql("ALTER TABLE user_fight_predictions ADD COLUMN IF NOT EXISTS revealed_at timestamptz;")
print("  done.")

print("\nVerifying...")
col = run_sql("""
    SELECT data_type, is_nullable FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_fight_predictions' AND column_name = 'revealed_at';
""")
if not col:
    print("VERIFY FAILED — revealed_at missing.")
    sys.exit(1)
print("  revealed_at:", col[0]['data_type'], "null=" + col[0]['is_nullable'])
print("\nMigration complete.")
