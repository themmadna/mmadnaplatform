# Audit Remediation Plan — 2026-05-16

Consolidated execution plan for the two May 16 audits:
- Supabase backend: [`memory/audits/2026-05-16/`](2026-05-16/)
- App frontend: [`memory/audits/2026-05-16-app/`](2026-05-16-app/)

**Status markers:** `[ ]` not started · `[~]` in progress · `[x]` complete · `[!]` blocked
**Last updated:** 2026-05-24 (S-P1-7 done — user_votes.fight_id now CASCADE)

---

## Hard dependencies

- Supabase P1 #5 (`rfs.fight_url` backfill) → P2 #11 (view refactor) → P2 #13 (new index)
- App F5 (delete `copys/` dirs) → F12–F14 (consolidate helpers)
- Supabase P0 #1 + #2 are one migration (both close the user_votes leak)

## Soft cross-effects to watch

- Supabase P1 #6 rewrites `fights.bout` for fight 8754 → re-grep any frontend bout-string matching after
- App F5 deleting `dataService.JS copys/` — confirm no deploy scripts/scrapers import from there

---

## Phase A — Supabase P0 security batch (single migration)

- [x] **S-P0-1** Drop `user_votes_backup` + `fight_ratings_backup` tables ✅ 2026-05-16
  - Pre-flight: user_votes live=240 vs backup=130 · fight_ratings live=8560 vs backup=8500
  - Script: `supabase/cleanup_backup_tables.py`
  - Also removed stale note from `context/schema.md`
  - Ref: `2026-05-16/01-security.md §1`, followups #1
- [x] **S-P0-2** Drop 4 stale `user_votes` policies (Votes viewable by everyone, etc.) ✅ 2026-05-16
  - Prepended 4 `DROP POLICY IF EXISTS` into `supabase/deploy_rls_policies.py` (idempotent on redeploy)
  - Ran script; verified `pg_policies` for user_votes now contains exactly the 4 `_own` policies
  - Ref: `2026-05-16/01-security.md §2`, followups #2
- [x] **S-P0-3** Drop deprecated `get_user_judging_profile(uuid)` overload ✅ 2026-05-16
  - Prepended `DROP FUNCTION IF EXISTS public.get_user_judging_profile(uuid);` into `supabase/deploy_judging_profile.py` and ran it
  - Verified via pg_proc: only the no-arg overload remains
  - Ref: `2026-05-16/01-security.md §3`, followups #3

## Phase B — Supabase P1 data fixes

- [x] **S-P1-4** ~~Backfill `fights.winner` for ids 8281, 8269, 8761~~ — **RESOLVED 2026-05-23**
  - Audit premise was wrong: all 3 are genuine draws (both fighters "D" on ufcstats). `fights.winner = NULL` is correct.
  - `supabase/fix_fmd_result_draws.py` corrected `fmd.result` from `'unknown'` → `'draw'` for 8269 + 8281 (8761 already had it).
  - Frontend: `ScorecardComparison` + `FightDetailView` now render "Draw — {method}" when winner NULL on a decision.
  - Scraper: added `rescrape_null_winner_decisions()` in `master file for data update.py`; called from `sync_meta` after the insert loop. Re-scrapes any NULL-winner decision; updates only if parse returns a winner (real draws untouched).
  - Two new follow-ups split out: **#16** method_details parser bug, **#17** judge_scores fighter inversion on fight 8761.
- [ ] **S-P1-6** Resolve fight 8754 Patricio Pitbull alias duplicate rfs rows
  - Followups #6
- [x] **S-P1-5** Add `fight_url` to Phase 4 upsert in `master file for data update.py` + one-time backfill of ~270 rows ✅ 2026-05-24
  - Phase 4 upsert stamps `fight_url` from `task['fight_url']` (already returned by `fight_scraping_status`); zero extra HTTP
  - `supabase/backfill_rfs_fight_url.py` cleared 334 rows across 6 events (270 from audit + 64 from a 6th event); pre-flight aborts if any (event, bout) can't be matched
  - Post-state: 0 NULL `fight_url` rows in rfs
  - Unblocks Phase C: S-P2-11 (view refactor) + S-P2-13 (index)
  - Followups #5
- [x] **S-P1-7** Switch `user_votes.fight_id` FK to `ON DELETE CASCADE` ✅ 2026-05-24
  - `supabase/migrate_user_votes_cascade.py` — pre-flight (240 rows, 0 orphans, current NO ACTION) + single-tx DROP/ADD + post-verify (`confdeltype='c'`)
  - Sibling parity restored: `user_round_scores` / `user_fight_scorecard_state` / `fight_ratings` / `user_votes` all CASCADE on `fight_id`
  - `context/schema.md` updated with `ON DELETE CASCADE` on all four `fight_id` FK rows
  - Followups #7

## Phase C — Supabase P2 tech debt (depends on B)

- [ ] **S-P2-11** Refactor `fight_dna_metrics` view to join via `fight_url` (needs S-P1-5)
  - Followups #11
- [ ] **S-P2-13** Add `idx_round_fight_stats_fight_url` + `idx_user_votes_fight_id`
  - Followups #13
- [ ] **S-P2-8** Lock `search_path` on all 7 SECURITY DEFINER functions
  - Followups #8
- [ ] **S-P2-9** Revoke anon EXECUTE on user-scoped RPCs (4 functions)
  - Followups #9
- [ ] **S-P2-10** Drop redundant `fight_ratings` SELECT policy
  - Followups #10
- [ ] **S-P2-12** Add `fight_meta_details.fight_url → fights.fight_url ON DELETE CASCADE`
  - Followups #12
- [ ] **S-P2-14** Revoke EXECUTE on `update_fight_ratings()` from PUBLIC/anon/authenticated
  - Followups #14

## Phase D — App dead code cleanup (do first)

- [ ] **A-F4** Delete `src/App.test.js` (stale snapshot, not a test)
- [ ] **A-F5** Delete `src/App.js copys/` + `src/dataService.JS copys/` (~220 KB)

## Phase E — App.js cluster

- [ ] **A-F6** Sign-out clears `ufc_guest_*` sessionStorage keys (`App.js:787-790`)
- [ ] **A-F7** Memoize inline `FightCard`/`DualBar`/`StatRow`/`RangeSlider`; `useCallback` handlers
- [ ] **A-F8** Split For-You effect — load recs only on entering For-You (`App.js:526-548`)
- [ ] **A-F22** Add `aria-label="Clear search"` to × button (`App.js:981-984`)

## Phase F — FightDetailView.js cluster

- [ ] **A-F3** Delete debug `console.log`s on lines 407-409 (keep warn on 404)
- [ ] **A-F15** Migrate direct supabase calls to `dataService` (lines 227, 362)
- [ ] **A-F17** Pause ESPN polling on `visibilitychange` hidden
- [ ] **A-F25** `console.warn` on unknown ESPN status codes (lines 332-377)

## Phase G — Modals a11y (RoundScoringPanel.js)

- [ ] **A-F2 + A-F19** Add `role="dialog"`, `aria-modal`, `aria-labelledby`, Escape handler, focus trap, focus restore for both modals (forfeit + edit-after-reveal, lines 516-583)

## Phase H — Pulse regression + Judges cluster (5 components)

Files: `Login.js`, `JudgeDirectory.js`, `JudgeProfileView.js`, `JudgeComparison.js`, `UserJudgeComparison.js`

- [ ] **A-F1** Replace `#D4AF37` gold + `text-white/30-40` with Pulse tokens; fix DualBar colors
- [ ] **A-F18** Cache `getJudgeDirectory` in App state or module-scoped Map
- [ ] **A-F23** Replace plain-text loading with Pulse skeleton loaders
- [ ] **A-F20** Add `aria-expanded` to Leaderboard/JudgingDNA/ScoringInsights expandable rows
- [ ] **A-F21** Add `aria-sort` to active JudgeDirectory column header
- [ ] **A-F26** Wrap Recharts (FingerprintRadar, DriftSparkline) with `role="img"` + aria-label

## Phase I — Shared utilities consolidation (after Phase D)

- [ ] **A-F12** Consolidate 3 `normName` variants → `src/lib/normalizeName.js`
- [ ] **A-F13** Move `boutMatchesComp` → `src/lib/espnMatch.js` (use richer FightDetailView version)
- [ ] **A-F14** Move `getInitials` → `src/lib/names.js`

## Phase J — Misc cleanups

- [ ] **A-F9** `npm audit fix` (no --force) and re-test
- [ ] **A-F10** Decide: wire `reportWebVitals` or remove `web-vitals` dep (`index.js:18`)
- [ ] **A-F11** Remove duplicate `import './index.css'` (`index.js:3,6`)
- [ ] **A-F16** Wrap `getUserScoringData` in try/catch (`dataService.js:152-167`)
- [ ] **A-F24** Surface toast/banner on persistent search/recs failure
- [ ] **A-F27** Review every `eslint-disable react-hooks/exhaustive-deps`

## Phase K — New follow-ups from 2026-05-23 (S-P1-4 investigation)

- [ ] **S-P1-16** `fmd.method_details` parser drops the loser's score (`28 - 29.` → `29.`). Needs ufcstats HTML access to design fix. Followups #16.
- [ ] **S-P1-17** `judge_scores` has Solimar Miranda's fighters inverted on fight 8761. Investigate `scrape_mmadecisions.py` for the layout variant + scan for other affected scorecards. Followups #17.

---

## Progress log

- 2026-05-16 — Plan drafted from May 16 audits. No phases started.
- 2026-05-16 — **S-P0-1 done.** Dropped `user_votes_backup` (130 rows) and `fight_ratings_backup` (8500 rows). Pre-flight confirmed live ≥ backup. Updated `context/schema.md`.
- 2026-05-16 — **S-P0-2 done.** Dropped 4 legacy `user_votes` policies via `deploy_rls_policies.py` (DROPs now baked in for idempotent redeploy). `pg_policies` verified: only `user_votes_{select,insert,update,delete}_own` remain. Trigger `update_fight_ratings` unaffected (SECURITY DEFINER, bypasses RLS).
- 2026-05-16 — **S-P0-3 done.** Dropped deprecated `get_user_judging_profile(uuid)` overload via patched `deploy_judging_profile.py`. `pg_proc` verified: only the no-arg overload remains. Frontend was already on the no-arg call (`dataService.js:271`). **Phase A complete.**
- 2026-05-23 — **S-P1-4 resolved (audit premise was wrong).** Investigation against ufcstats screenshots: all 3 NULL-winner fights (8281, 8269, 8761) are genuine draws — both fighters have "D" status, no winner should be set. Real fixes: (b) `fmd.result = 'draw'` SQL update for 8269 + 8281 via `supabase/fix_fmd_result_draws.py`; (c) `ScorecardComparison` + `FightDetailView` now render "Draw — {method}" when winner NULL on a decision; (e) added `rescrape_null_winner_decisions()` to Phase 3 `sync_meta` so future stale rows get re-checked. Two new follow-ups discovered: S-P1-16 (method_details parser drops loser score) + S-P1-17 (judge_scores fighter inversion on fight 8761).
- 2026-05-24 — **S-P1-5 done.** Phase 4 upsert in `master file for data update.py` now stamps `fight_url` from the `fight_scraping_status` task dict (zero extra HTTP). `supabase/backfill_rfs_fight_url.py` cleared 334 NULL `fight_url` rows across 6 events (audit said 270; a 6th event had landed in the 8-day gap). Pre-flight sanity check confirmed every NULL row mapped to a fights row under bidirectional bout matching. Post-state verified: 0 NULL `fight_url` rows in rfs. Phase C deps (S-P2-11, S-P2-13) now unblocked.
- 2026-05-24 — **S-P1-7 done.** `supabase/migrate_user_votes_cascade.py` flipped `user_votes_fight_id_fkey` from `NO ACTION` to `ON DELETE CASCADE` via a single-transaction DROP/ADD. Pre-flight (240 rows, 0 orphans, current=NO ACTION) and post-verify (`pg_constraint.confdeltype='c'`) both passed. All 4 user-data tables (`user_round_scores` / `user_fight_scorecard_state` / `fight_ratings` / `user_votes`) now share the same `fight_id` delete behavior. `context/schema.md` updated. Scope held: `user_votes.user_id → auth.users` is also NO ACTION but wasn't in the audit's S-P1-7 ask.
