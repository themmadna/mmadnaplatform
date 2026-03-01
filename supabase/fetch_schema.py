"""
fetch_schema.py — Dump live Supabase view and function SQL into version-controlled .sql files.

Run once (and again any time you modify a view or function in the Supabase dashboard):
    python supabase/fetch_schema.py

Requires SUPABASE_MANAGEMENT_KEY and REACT_APP_SUPABASE_URL in ufc-web-app/.env.
The Management API key is the account-level token from app.supabase.com/account/tokens.
"""

import os
import requests
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).parent.parent / '.env')

supabase_url = os.environ.get("REACT_APP_SUPABASE_URL", "")
mgmt_key = os.environ.get("SUPABASE_MANAGEMENT_KEY", "")

if not supabase_url or not mgmt_key:
    raise SystemExit("❌ Missing REACT_APP_SUPABASE_URL or SUPABASE_MANAGEMENT_KEY in .env")

# Extract project ref from URL: https://<ref>.supabase.co
project_ref = supabase_url.replace("https://", "").split(".")[0]

MGMT_QUERY_URL = f"https://api.supabase.com/v1/projects/{project_ref}/database/query"
HEADERS = {
    "Authorization": f"Bearer {mgmt_key}",
    "Content-Type": "application/json",
}

HERE = Path(__file__).parent


def run_query(sql: str) -> list[dict]:
    res = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": sql}, timeout=15)
    if not res.ok:
        raise SystemExit(f"❌ Management API error {res.status_code}: {res.text}")
    return res.json()


def fetch_views():
    rows = run_query("""
        SELECT viewname, definition
        FROM pg_views
        WHERE schemaname = 'public'
        ORDER BY viewname;
    """)

    out_dir = HERE / "views"
    out_dir.mkdir(exist_ok=True)

    for row in rows:
        name = row["viewname"]
        sql = f"CREATE OR REPLACE VIEW {name} AS\n{row['definition'].strip()}\n"
        path = out_dir / f"{name}.sql"
        path.write_text(sql, encoding="utf-8")
        print(f"  ✅ views/{name}.sql")

    print(f"Saved {len(rows)} view(s).")


def fetch_functions():
    rows = run_query("""
        SELECT p.proname AS name, pg_get_functiondef(p.oid) AS definition
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
        ORDER BY p.proname;
    """)

    out_dir = HERE / "functions"
    out_dir.mkdir(exist_ok=True)

    for row in rows:
        name = row["name"]
        sql = row["definition"].strip() + "\n"
        path = out_dir / f"{name}.sql"
        path.write_text(sql, encoding="utf-8")
        print(f"  ✅ functions/{name}.sql")

    print(f"Saved {len(rows)} function(s).")


if __name__ == "__main__":
    print(f"Project: {project_ref}")
    print("\nFetching views...")
    fetch_views()
    print("\nFetching functions...")
    fetch_functions()
    print("\nDone. Commit supabase/views/ and supabase/functions/ to git.")
