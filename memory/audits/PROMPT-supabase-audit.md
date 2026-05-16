# Supabase Audit — Reusable Prompt

Paste the block below at the start of a fresh session to run a comprehensive
Supabase audit against this project. Read-only — produces a written report, no
migrations applied.

Re-run any time after meaningful schema, RPC, or RLS changes. Output goes to
`memory/audits/<date>/` so prior audits stay intact.

---

```
Run a comprehensive Supabase audit for this UFC web app. Read-only investigation —
do NOT apply migrations, deploy SQL, change grants, or rotate keys. Output is a
written report; fixes come after I review.

## Access
Keys are in `.env`:
- `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY` (frontend surface)
- `SUPABASE_SERVICE_KEY` (bypasses RLS — use for inventory queries)
- `SUPABASE_MANAGEMENT_KEY` (project-level API — for settings, logs, function metadata)
Use Python 3.9 at `C:/Users/sabzu/AppData/Local/Programs/Python/Python39/python.exe`
with the `supabase` client, mirroring `supabase/fetch_schema.py` and the existing
deploy scripts. For anything the SDK can't reach (pg_cron, pg_net, RLS policies,
trigger bodies, function source), query `pg_catalog` / `information_schema` via
the service key, or hit the Management API.

## Prior context — read first
- `CLAUDE.md` — the 9 numbered "Key Conventions" are the most common bug sources;
  every audit finding should cross-check against them
- `context/schema.md` — canonical table/view list
- `context/rpc-functions.md` — canonical RPC list with signatures and return shapes
- `context/scrapers.md` — what writes to which tables
- `memory/audits/2026-04-14/` — prior security audit (P0 fixed, P1/P2 backlog).
  Do not redo P0 verification work; instead confirm the fixes are still in place
  and focus on what wasn't covered.
- `memory/PROGRESS.md` — the "Security Hardening" section lists what's already done

## Scope — cover all of these
1. **Security**
   - RLS: every user-data table has RLS enabled with sane policies (compare to
     the April audit's `deploy_rls_policies.py`)
   - Function security: `SECURITY DEFINER` functions — are search_path locked,
     grants minimal, anon access only where intended (recall the
     `get_leaderboard_user_detail` anon revoke from #17)
   - Grants on views and tables — anything anon can read that shouldn't be
   - Service key usage: any scraper or Edge Function leaking it client-side
   - Edge Functions: `poll-live-fights`, `record-fight-status` — auth checks,
     error handling, secret handling
   - Anon key surface: list every table/view/function reachable as anon and
     confirm each one is intentional

2. **Schema integrity**
   - FK coverage — are joins in `dataService.js` and views protected by FKs, or
     just convention? (Recall #20 — `round_fight_stats → fights` FK was added.)
   - NOT NULL gaps on columns that the app assumes are non-null
   - Orphan rows: round_fight_stats without a parent fight, judge_scores without
     a fight match, user_round_scores pointing at deleted fights, etc.
   - Dead tables / dead columns — anything in the DB no view, RPC, or scraper
     touches
   - Index coverage — common join keys (fight_url, event_name+bout, date) and
     filter columns; cross-check against `deploy_indexes.py`

3. **Views & RPCs — behavior, not just shape**
   - For each view: re-derive its definition, then run a sample query and
     sanity-check row counts vs the underlying tables
   - For each RPC: confirm the live signature matches `context/rpc-functions.md`
     and the call sites in `src/dataService.js`. Flag drift in either direction.
   - RPCs that swallow errors and return empty / silently degrade (recall #18)
   - Convention #2: every join from judge_scores to fights MUST use
     `date ±1 day`, never `event_name = event_name`. Audit every view and RPC
     for violations.
   - Convention #9: every join between `fight_meta_details.bout` and
     `round_fight_stats.bout` MUST handle the reversed-bout case. Audit.

4. **Data quality**
   - Sample 20 random fights end-to-end (fights → fight_meta_details →
     round_fight_stats → judge_scores) and check for: reversed bouts, missing
     winners, weight_class vs weight_class_clean drift, name mismatches across
     ufcstats and mmadecisions
   - Count fights with no `round_fight_stats` (expected: live-only, or
     scraper bugs?)
   - Count decisions with no `judge_scores` row within ±1 day
   - Look for cancelled/replaced matchups that the post-event audit memory
     ([[feedback_post_scrape_audit]]) flags as easy to miss

5. **Operational**
   - pg_cron jobs (poll-live-fights minute cron) — running, last run status,
     errors
   - pg_net config (used by the cron call) — sane timeouts, no leaked URLs
   - Triggers — every trigger source matches `deploy_triggers.py` (recall #19);
     flag any drift
   - Storage buckets — anything used / unused / publicly readable

## Deliverable
Write findings to `memory/audits/<today's date>/` (create the directory). Structure:
- `00-summary.md` — executive summary, P0/P1/P2 counts, top 5 risks
- `01-security.md`
- `02-schema.md`
- `03-views-rpcs.md`
- `04-data-quality.md`
- `05-operational.md`
- `99-followups.md` — backlog with proposed fixes, but DO NOT write deploy scripts
  unless I ask

Severity guide: P0 = data leak / corruption / auth bypass. P1 = wrong-data
risk / silent failure. P2 = tech debt / hygiene.

Keep prose tight. Every finding cites a table/view/RPC name and a query or file
path I can re-run to verify. Don't pad with restated context.
```
