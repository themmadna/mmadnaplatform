# Audit Remediation Plan — 2026-05-16

Consolidated execution plan for the two May 16 audits:
- Supabase backend: [`memory/audits/2026-05-16/`](2026-05-16/)
- App frontend: [`memory/audits/2026-05-16-app/`](2026-05-16-app/)

**Status markers:** `[ ]` not started · `[~]` in progress · `[x]` complete · `[!]` blocked
**Last updated:** 2026-05-16

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

- [ ] **S-P1-4** Backfill `fights.winner` for ids 8281, 8269, 8761
  - Verify each against `fmd.method_details` first
  - Followups #4
- [ ] **S-P1-6** Resolve fight 8754 Patricio Pitbull alias duplicate rfs rows
  - Followups #6
- [ ] **S-P1-5** Add `fight_url` to Phase 4 upsert in `master file for data update.py` + one-time backfill of ~270 rows
  - Followups #5
- [ ] **S-P1-7** Switch `user_votes.fight_id` FK to `ON DELETE CASCADE`
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

---

## Progress log

- 2026-05-16 — Plan drafted from May 16 audits. No phases started.
- 2026-05-16 — **S-P0-1 done.** Dropped `user_votes_backup` (130 rows) and `fight_ratings_backup` (8500 rows). Pre-flight confirmed live ≥ backup. Updated `context/schema.md`.
- 2026-05-16 — **S-P0-2 done.** Dropped 4 legacy `user_votes` policies via `deploy_rls_policies.py` (DROPs now baked in for idempotent redeploy). `pg_policies` verified: only `user_votes_{select,insert,update,delete}_own` remain. Trigger `update_fight_ratings` unaffected (SECURITY DEFINER, bypasses RLS).
- 2026-05-16 — **S-P0-3 done.** Dropped deprecated `get_user_judging_profile(uuid)` overload via patched `deploy_judging_profile.py`. `pg_proc` verified: only the no-arg overload remains. Frontend was already on the no-arg call (`dataService.js:271`). **Phase A complete.**
