"""
deploy_fight_dna_metrics.py - S-P2-11 view refactor.

Refactors the fight_dna_metrics view to join round_fight_stats via
fight_url instead of (event_name, bout) text. Eliminates the bout
reversal trap (Convention #9) from the view definition.

Prerequisite
------------
rfs.fight_url must be canonical. Two backfills must have run first:
  - supabase/backfill_rfs_fight_url.py            (S-P1-5, 2026-05-24) - populated NULLs
  - supabase/fix_rfs_fight_url_misstamps.py       (S-P1-18, 2026-05-24) - fixed wrong stamps

Without those, this script would silently relocate ~1239 rfs rows' stats
to the wrong fights -- 215 fights would lose stats entirely.

Behavior change
---------------
None for the application. Per-fight DNA values and ufc_baselines remain
identical (verified by side-by-side parity probe before deploy).

The benefit is structural: future bout-alias bugs at the view layer are
no longer possible because the join key is the canonical fight_url FK.

Idempotent: CREATE OR REPLACE VIEW. Re-running is a no-op.

Run:
    python supabase/deploy_fight_dna_metrics.py
"""

import json
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
    r = requests.post(MGMT_QUERY_URL, headers=HEADERS, json={"query": sql}, timeout=60)
    if not r.ok:
        print(f"FAIL query {r.status_code}: {r.text}")
        sys.exit(1)
    return r.json()


# ---------------------------------------------------------------
# Pre-flight: rfs.fight_url must be clean
# ---------------------------------------------------------------
print("Pre-flight: confirming rfs.fight_url is canonical...\n")

null_check = run_sql("""
SELECT COUNT(*) AS null_rows
FROM round_fight_stats
WHERE fight_url IS NULL;
""")
nulls = null_check[0]["null_rows"]
if nulls > 0:
    print(f"FAIL - {nulls} rfs rows have NULL fight_url. Run supabase/backfill_rfs_fight_url.py first.")
    sys.exit(1)
print(f"  NULL fight_url rows: {nulls}")

misstamp_check = run_sql("""
SELECT COUNT(*) AS misstamps
FROM round_fight_stats rfs
JOIN fights f ON f.fight_url = rfs.fight_url
WHERE rfs.event_name <> f.event_name;
""")
ms = misstamp_check[0]["misstamps"]
if ms > 0:
    print(f"FAIL - {ms} rfs rows have fight_url pointing to a different event. Run supabase/fix_rfs_fight_url_misstamps.py first.")
    sys.exit(1)
print(f"  cross-event misstamps:  {ms}")


# ---------------------------------------------------------------
# Snapshot the live view: row count + sampled values + ufc_baselines
# ---------------------------------------------------------------
print("\nSnapshotting live fight_dna_metrics values (before deploy)...")

pre_count = run_sql("SELECT COUNT(*) AS n FROM fight_dna_metrics;")[0]["n"]
print(f"  row count: {pre_count}")

# Sample: 5 oldest + 5 newest completed + fight 8754 (Pitbull alias) +
# 5 random decisions + 5 random finishes - hand-verifiable diff after deploy.
SAMPLE_SQL = """
WITH picks AS (
  (SELECT fight_id FROM fight_dna_metrics WHERE status = 'completed'
   ORDER BY fight_id ASC LIMIT 5)
  UNION
  (SELECT fight_id FROM fight_dna_metrics WHERE status = 'completed'
   ORDER BY fight_id DESC LIMIT 5)
  UNION
  SELECT 8754
)
SELECT v.fight_id,
       ROUND(v.metric_pace::numeric, 6)      AS pace,
       ROUND(v.metric_violence::numeric, 6)  AS viol,
       ROUND(v.metric_intensity::numeric, 6) AS intens,
       ROUND(v.metric_control::numeric, 6)   AS ctrl,
       v.metric_finish                        AS fin,
       ROUND(v.metric_duration::numeric, 6)  AS dur,
       v.raw_head_strikes AS hd,
       v.raw_body_strikes AS bd,
       v.raw_leg_strikes  AS lg
FROM fight_dna_metrics v
JOIN picks p USING (fight_id)
ORDER BY v.fight_id;
"""

pre_sample = run_sql(SAMPLE_SQL)
pre_sample_map = {r["fight_id"]: r for r in pre_sample}
print(f"  sampled {len(pre_sample_map)} fights for parity check")

pre_baselines = run_sql("""
SELECT ROUND("strikePace"::numeric, 6)     AS strike_pace,
       ROUND("violenceIndex"::numeric, 6)  AS violence_index,
       ROUND("intensityScore"::numeric, 6) AS intensity_score,
       ROUND("engagementStyle"::numeric, 6) AS engagement_style,
       ROUND("finishRate"::numeric, 6)     AS finish_rate,
       ROUND("avgFightTime"::numeric, 6)   AS avg_fight_time
FROM ufc_baselines;
""")[0]
print(f"  ufc_baselines snapshot: {pre_baselines}")


# ---------------------------------------------------------------
# Deploy: CREATE OR REPLACE VIEW
# ---------------------------------------------------------------
# Notes on the new DDL:
#   - rfs aggregation is GROUP BY fight_url (single-key) instead of
#     (event_name, bout) - eliminates Convention #9 bout-reversal risk
#   - WHERE fight_url IS NOT NULL inside the subquery is now redundant
#     (we just verified 0 NULL rows), but kept as defense in depth in
#     case a transient NULL appears between scrape phases
#   - join key f.fight_url = s.fight_url replaces
#     f.event_name = s.event_name AND f.bout = s.bout
#   - The fight_meta_details join (m) is unchanged - it already joined
#     via fight_url
#   - Column list and types preserved exactly so ufc_baselines and any
#     frontend query keeps working without a column-rename migration

DDL = """
CREATE OR REPLACE VIEW fight_dna_metrics AS
SELECT f.id AS fight_id,
    f.status,
    COALESCE(s.total_sig_att::double precision / NULLIF(((COALESCE(m.round, '1'::text)::integer - 1) * 300 + split_part(COALESCE(m."time", '5:00'::text), ':'::text, 1)::integer * 60 + split_part(COALESCE(m."time", '5:00'::text), ':'::text, 2)::integer)::double precision / 60.0::double precision, 0::double precision), 0::double precision) AS metric_pace,
    COALESCE((s.total_kd + s.total_sub_att)::double precision / NULLIF(((COALESCE(m.round, '1'::text)::integer - 1) * 300 + split_part(COALESCE(m."time", '5:00'::text), ':'::text, 1)::integer * 60 + split_part(COALESCE(m."time", '5:00'::text), ':'::text, 2)::integer)::double precision / 60.0::double precision, 0::double precision), 0::double precision) AS metric_violence,
    COALESCE((s.total_ground_att + s.total_clinch_att + s.total_sub_att * 5 + s.total_reversals * 5)::double precision / NULLIF(s.total_control_sec::double precision / 60.0::double precision + 2.0::double precision, 0::double precision), 0::double precision) AS metric_intensity,
    COALESCE(
        CASE
            WHEN ((COALESCE(m.round, '1'::text)::integer - 1) * 300 + split_part(COALESCE(m."time", '5:00'::text), ':'::text, 1)::integer * 60 + split_part(COALESCE(m."time", '5:00'::text), ':'::text, 2)::integer) > 0
              THEN s.total_control_sec::double precision / ((COALESCE(m.round, '1'::text)::integer - 1) * 300 + split_part(COALESCE(m."time", '5:00'::text), ':'::text, 1)::integer * 60 + split_part(COALESCE(m."time", '5:00'::text), ':'::text, 2)::integer)::double precision * 100::double precision
            ELSE 0::double precision
        END, 0::double precision) AS metric_control,
    CASE
        WHEN m.method ILIKE '%KO%'
          OR m.method ILIKE '%Submission%'
          OR m.method ILIKE '%TKO%' THEN 100
        ELSE 0
    END AS metric_finish,
    COALESCE(((COALESCE(m.round, '1'::text)::integer - 1) * 300 + split_part(COALESCE(m."time", '5:00'::text), ':'::text, 1)::integer * 60 + split_part(COALESCE(m."time", '5:00'::text), ':'::text, 2)::integer)::double precision / 60.0::double precision, 0::double precision) AS metric_duration,
    COALESCE(s.total_head_att, 0::bigint) AS raw_head_strikes,
    COALESCE(s.total_body_att, 0::bigint) AS raw_body_strikes,
    COALESCE(s.total_leg_att, 0::bigint) AS raw_leg_strikes
FROM fights f
LEFT JOIN (
    SELECT fight_url,
           sum(COALESCE(sig_strikes_attempted, 0))         AS total_sig_att,
           sum(COALESCE(takedowns_attempted, 0))           AS total_td_attempts,
           sum(COALESCE(kd, 0))                            AS total_kd,
           sum(COALESCE(sub_attempts, 0))                  AS total_sub_att,
           sum(COALESCE(control_time_sec, 0))              AS total_control_sec,
           sum(COALESCE(sig_strikes_ground_attempted, 0))  AS total_ground_att,
           sum(COALESCE(sig_strikes_clinch_attempted, 0))  AS total_clinch_att,
           sum(COALESCE(reversals, 0))                     AS total_reversals,
           sum(COALESCE(sig_strikes_head_attempted, 0))    AS total_head_att,
           sum(COALESCE(sig_strikes_body_attempted, 0))    AS total_body_att,
           sum(COALESCE(sig_strikes_leg_attempted, 0))     AS total_leg_att
    FROM round_fight_stats
    WHERE fight_url IS NOT NULL
    GROUP BY fight_url
) s ON s.fight_url = f.fight_url
LEFT JOIN fight_meta_details m ON m.fight_url = f.fight_url;
"""

print("\nDeploying refactored view (CREATE OR REPLACE)...")
run_sql(DDL)
print("  deploy OK")


# ---------------------------------------------------------------
# Post-verify: same row count, sampled values identical, baselines stable
# ---------------------------------------------------------------
print("\nPost-verify: row count + sampled values + ufc_baselines...")

post_count = run_sql("SELECT COUNT(*) AS n FROM fight_dna_metrics;")[0]["n"]
print(f"  row count: {post_count} (pre={pre_count})")
if post_count != pre_count:
    print("  FAIL - row count drift")
    sys.exit(1)

post_sample = run_sql(SAMPLE_SQL)
diffs = []
for row in post_sample:
    fid = row["fight_id"]
    if pre_sample_map.get(fid) != row:
        diffs.append((fid, pre_sample_map.get(fid), row))

if diffs:
    print(f"  FAIL - {len(diffs)} sampled fights changed value:")
    for fid, pre_r, post_r in diffs[:5]:
        print(f"    fight_id={fid}")
        print(f"      pre:  {pre_r}")
        print(f"      post: {post_r}")
    sys.exit(1)
print(f"  all {len(post_sample)} sampled fights unchanged")

post_baselines = run_sql("""
SELECT ROUND("strikePace"::numeric, 6)     AS strike_pace,
       ROUND("violenceIndex"::numeric, 6)  AS violence_index,
       ROUND("intensityScore"::numeric, 6) AS intensity_score,
       ROUND("engagementStyle"::numeric, 6) AS engagement_style,
       ROUND("finishRate"::numeric, 6)     AS finish_rate,
       ROUND("avgFightTime"::numeric, 6)   AS avg_fight_time
FROM ufc_baselines;
""")[0]
if post_baselines != pre_baselines:
    print("  FAIL - ufc_baselines drifted:")
    print(f"    pre:  {pre_baselines}")
    print(f"    post: {post_baselines}")
    sys.exit(1)
print(f"  ufc_baselines unchanged: {post_baselines}")

# Full per-fight parity (cheap one-time sanity check).
# Expected behavior change: fight 3436 (UFC Ultimate Japan, Sakuraba vs Silveira
# "Overturned" no-contest) had NO real fight stats. The card also has a true
# rematch (fight 3433, also bout "Kazushi Sakuraba vs Marcus Silveira") which
# has 2 rfs rows correctly stamped to fight 3433's fight_url. The OLD
# (event_name, bout) text join attributed those rfs rows to BOTH fights 3433
# and 3436 (because the bout text matches both fights rows). The NEW fight_url
# join correctly attributes them only to 3433. So fight 3436 dropping to 0
# stats under the new view is a fix, not a regression.
print("\nFull per-fight parity sweep...")
parity = run_sql("""
WITH text_agg AS (
  SELECT f.id AS fight_id,
         COALESCE(SUM(rfs.sig_strikes_attempted), 0) AS sig_att,
         COALESCE(SUM(rfs.kd), 0)                    AS kd,
         COALESCE(SUM(rfs.control_time_sec), 0)      AS ctrl_sec,
         COALESCE(SUM(rfs.sig_strikes_head_attempted), 0) AS head_att
  FROM fights f
  LEFT JOIN round_fight_stats rfs
    ON f.event_name = rfs.event_name AND f.bout = rfs.bout
  GROUP BY f.id
),
url_agg AS (
  SELECT f.id AS fight_id,
         COALESCE(SUM(rfs.sig_strikes_attempted), 0) AS sig_att,
         COALESCE(SUM(rfs.kd), 0)                    AS kd,
         COALESCE(SUM(rfs.control_time_sec), 0)      AS ctrl_sec,
         COALESCE(SUM(rfs.sig_strikes_head_attempted), 0) AS head_att
  FROM fights f
  LEFT JOIN round_fight_stats rfs ON f.fight_url = rfs.fight_url
  GROUP BY f.id
)
SELECT t.fight_id,
       t.sig_att AS old_sig, u.sig_att AS new_sig
FROM text_agg t JOIN url_agg u USING (fight_id)
WHERE NOT (t.sig_att = u.sig_att AND t.kd = u.kd
           AND t.ctrl_sec = u.ctrl_sec AND t.head_att = u.head_att);
""")

# Known-good divergences (fights where the old view double-counted onto
# an overturned no-contest sharing the same bout text on the same card):
EXPECTED_DIVERGENCES = {3436}

unexpected = [r for r in parity if r["fight_id"] not in EXPECTED_DIVERGENCES]
print(f"  divergent fights: {len(parity)} (expected {len(EXPECTED_DIVERGENCES)})")
for r in parity:
    tag = "expected" if r["fight_id"] in EXPECTED_DIVERGENCES else "UNEXPECTED"
    print(f"    [{tag}] fight_id={r['fight_id']}  old_sig={r['old_sig']}  new_sig={r['new_sig']}")

if unexpected:
    print(f"\n  FAIL - {len(unexpected)} unexpected divergent fights")
    sys.exit(1)

print("\nDone - fight_dna_metrics view refactored. Bout-reversal trap removed.")
