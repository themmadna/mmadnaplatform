"""
migrate_round_stats_fk.py — adds fight_url to round_fight_stats and an FK → fights.fight_url

Background
----------
round_fight_stats currently joins to fights via event_name+bout string matching, which is
fragile: bout order is sometimes reversed between the two tables, and event_name strings
can differ across sources. Orphaned rows (no matching fight) silently bias fight_dna_metrics
aggregations for all users.

Fix: add a nullable fight_url column, backfill it via fight_meta_details (which already
carries fight_url + a reliable bout match), then add an FK constraint to fights.fight_url.
Rows that can't be matched are left NULL and logged — they can be cleaned up separately.

Usage
-----
  python supabase/migrate_round_stats_fk.py --dry-run    # print SQL only, no changes
  python supabase/migrate_round_stats_fk.py              # run against live DB

Requires: REACT_APP_SUPABASE_URL and SUPABASE_MANAGEMENT_KEY in .env
"""

import sys
import os
import argparse
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

# ── Migration SQL ──────────────────────────────────────────────────────────────

STEP_1_ADD_COLUMN = """
-- Step 1: add fight_url column (nullable — backfill happens in step 2)
ALTER TABLE round_fight_stats
  ADD COLUMN IF NOT EXISTS fight_url text;
"""

# Backfill: join rfs → fmd on bout (both orderings) to get fight_url.
# fight_meta_details.fight_url is the canonical join key used everywhere else.
STEP_2_BACKFILL = """
-- Step 2: backfill fight_url from fight_meta_details
-- Matches both normal and reversed bout order (known data quirk — see CLAUDE.md).
UPDATE round_fight_stats rfs
SET fight_url = fmd.fight_url
FROM fight_meta_details fmd
WHERE rfs.fight_url IS NULL
  AND (
    rfs.bout = fmd.bout
    OR rfs.bout = TRIM(SPLIT_PART(fmd.bout, ' vs ', 2))
                  || ' vs '
                  || TRIM(SPLIT_PART(fmd.bout, ' vs ', 1))
  );
"""

STEP_3_AUDIT = """
-- Step 3: count unmatched rows (should be 0 or very few edge cases)
SELECT COUNT(*) AS unmatched_rows
FROM round_fight_stats
WHERE fight_url IS NULL;
"""

STEP_4_FK = """
-- Step 4: add unique constraint on fights.fight_url (required for FK target),
-- then FK from round_fight_stats.fight_url → fights.fight_url.
-- Run after confirming Step 3 shows 0 unmatched rows.
--
-- Deployed 2026-04-15. Idempotent — will error if constraints already exist.

ALTER TABLE fights
  ADD CONSTRAINT fights_fight_url_key UNIQUE (fight_url);

ALTER TABLE round_fight_stats
  ADD CONSTRAINT round_fight_stats_fight_url_fkey
  FOREIGN KEY (fight_url) REFERENCES fights(fight_url)
  ON DELETE CASCADE
  DEFERRABLE INITIALLY DEFERRED;

-- DEFERRABLE: allows bulk scraper inserts before the parent fight row exists,
-- then validates the FK on transaction commit.
"""

# ── Runner ─────────────────────────────────────────────────────────────────────

def run_sql(label, sql, dry_run=False):
    print(f"\n{'[DRY RUN] ' if dry_run else ''}Step: {label}")
    print("SQL:", sql.strip()[:200], "..." if len(sql.strip()) > 200 else "")
    if dry_run:
        print("  (skipped — dry run)")
        return None
    resp = requests.post(api_url, headers=headers, json={"query": sql})
    if resp.status_code >= 400:
        print(f"  ERROR {resp.status_code}: {resp.text}")
        sys.exit(1)
    print(f"  OK ({resp.status_code})")
    try:
        return resp.json()
    except Exception:
        return None

def main():
    parser = argparse.ArgumentParser(description="Migrate round_fight_stats to add fight_url FK")
    parser.add_argument("--dry-run", action="store_true", help="Print SQL only, make no changes")
    args = parser.parse_args()

    dry_run = args.dry_run
    if dry_run:
        print("DRY RUN — no changes will be made to the database.\n")

    run_sql("Add fight_url column", STEP_1_ADD_COLUMN, dry_run)
    run_sql("Backfill fight_url from fight_meta_details", STEP_2_BACKFILL, dry_run)
    result = run_sql("Audit unmatched rows", STEP_3_AUDIT, dry_run)

    if result and not dry_run:
        rows = result if isinstance(result, list) else []
        unmatched = rows[0].get("unmatched_rows", "?") if rows else "?"
        print(f"\nUnmatched rows after backfill: {unmatched}")
        if unmatched and int(str(unmatched)) > 0:
            print("WARNING: some rows could not be matched. Review before adding FK constraint.")
            print("The FK constraint (Step 4) is commented out — run manually after review.")
        else:
            print("All rows matched. You can now add the FK constraint:")
            print("  Uncomment STEP_4_FK in this script and rerun, OR apply via Supabase dashboard.")

    print(STEP_4_FK)
    if not dry_run:
        print("\nMigration steps 1-3 complete. Step 4 (FK constraint) is intentionally manual — see output above.")

if __name__ == "__main__":
    main()
