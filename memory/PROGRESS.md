# UFC Web App — Project Plan
Last updated: 2026-05-24 (S-P2-11 fight_dna_metrics view refactored to fight_url; S-P1-18 fixed 1237 misstamped rfs.fight_url rows discovered during pre-flight)
Next session: Phase C continues — S-P2-13 indexes (rfs.fight_url, user_votes.fight_id), then S-P2-8 search_path hardening / S-P2-9 anon EXECUTE revokes. Or pivot to app-side F1 Pulse contrast sweep / F2 modal focus trap.
Last refreshed: 2026-05-16

---

## App Audit Backlog — 2026-05-16

Full report in `memory/audits/2026-05-16-app/`. Read-only audit, no fixes applied.

**Checkpoint**
- **Goal:** comprehensive frontend audit — functional bugs, data fetching, components, perf, UI/UX (Pulse), a11y, auth/security, build/deps, tests, Playwright recommendation
- **Constraints:** read-only — no code changes, no deploys; output a written report, fixes come after Bastian reviews
- **Progress:** audit complete; 11 report files written; 0 P0s + 8 P1s + 15 P2s catalogued with proposed (unapplied) fixes in `99-followups.md`
- **Decisions:** none yet — Bastian to triage. Two PROGRESS.md claims overstated reality: Phase 8 (Pulse) is partially regressed across 5 components, and Phase 8f.4 modal focus management is not implemented.
- **NextSteps:** triage the P1s next session. Suggested order: (F3) delete debug `console.log`s — trivial; (F4) delete `App.test.js` non-test; (F5) delete `src/*copys/` dead code; (F6) clear guest sessionStorage on sign-out; (F1) Pulse token sweep across 5 judge/login components; (F2) modal focus trap.

**P1 audit findings** (full detail in `memory/audits/2026-05-16-app/99-followups.md`)
- [ ] **F1.** Pulse design regression in 5 components — `#D4AF37` gold + `text-white/40` failing contrast in JudgeDirectory / JudgeProfileView / JudgeComparison / UserJudgeComparison / Login.js
- [ ] **F2.** RoundScoringPanel modals (forfeit + edit-after-reveal) lack focus trap, Escape handling, and focus restoration
- [x] **F3.** Verbose `console.log` debug block in FightDetailView.js:407-409 fires on every fight detail load ✅ 2026-05-23 — deleted 3 lines; kept `console.warn` for the no-judge-scores-yet ops case
- [x] **F4.** `src/App.test.js` is a stale 200-line App snapshot, not a real test — Jest picks it up via the `.test.js` glob ✅ 2026-05-23 — deleted; `npm test` now runs only `guestStorage.test.js` (23/23)
- [x] **F5.** `src/App.js copys/` + `src/dataService.JS copys/` — 220 KB of committed dead code inside `src/` ✅ 2026-05-23 — `git rm -r` both directories (13 + 6 = 19 files)
- [x] **F6.** `handleSignOut` does not clear guest sessionStorage — leaks votes/scores to next visitor on shared device ✅ 2026-05-23 — added `guestStorage.clearAll()` wiping all 5 `ufc_guest_*` keys; `handleSignOut` calls it + resets userHistory/combatDNA/comparisonData/isGuest state; 2 new tests (23/23 passing); build clean (+31 B)
- [ ] **F7.** Zero memoization across `src/` — render thrash on every state change
- [ ] **F8.** `For You` re-fetches recommendations on every vote (effect re-fires on userHistory change)

**P2 audit findings:** 15 items — `npm audit fix` (40 vulns), inert `web-vitals`, duplicate `index.css` import, three name normalizers, modal aria, expandable-row `aria-expanded`, ESPN poll on hidden tab, etc. See `99-followups.md`.

---

## Supabase Audit Backlog — 2026-05-16

Full report in `memory/audits/2026-05-16/`. Read-only audit, no fixes deployed.

**Checkpoint**
- **Goal:** verify the live Supabase project for security, schema integrity, and data quality after recent changes (Post-Event Automation, etc.)
- **Constraints:** read-only — no migrations, no grant changes, no key rotation; output a written report, fixes come after Bastian reviews
- **Progress:** audit complete; 7 report files written; 3 P0s + 4 P1s + 7 P2s catalogued with proposed (undeployed) fixes in `99-followups.md`
- **Decisions:** none yet — Bastian to triage. P0s are all stale-grant fallout from before the April migration, not new bugs.
- **NextSteps:** triage the P0s next session. Order: (1) drop `user_votes_backup`/`fight_ratings_backup`; (2) drop 4 stale `user_votes` policies; (3) drop deprecated `get_user_judging_profile(uuid)` overload. Then P1 scraper fixes.

**P0 audit findings — fix before next user-facing release**
- [x] **A1.** Drop `user_votes_backup` + `fight_ratings_backup` (anon SELECT+DELETE, contains real user UUIDs) — `01-security.md §1` ✅ 2026-05-16 via `supabase/cleanup_backup_tables.py`; pre-flight live=240/8560 vs backup=130/8500
- [x] **A2.** Drop 4 stale `user_votes` policies including `"Votes are viewable by everyone" qual=true` which OR-overrides own-only — `01-security.md §2` ✅ 2026-05-16 via patched `deploy_rls_policies.py`; verified pg_policies returns only the 4 `_own` policies
- [x] **A3.** Drop deprecated `get_user_judging_profile(p_user_id uuid)` — SECURITY DEFINER, granted to anon, reads `user_round_scores` for any UUID — `01-security.md §3` ✅ 2026-05-16 via patched `deploy_judging_profile.py`; pg_proc verified no-arg overload only

**Phase A — Supabase P0 security batch — Checkpoint**
- **Goal:** Close the 3 P0 leaks identified in the 2026-05-16 Supabase audit (anon-readable backup tables, stale permissive RLS on user_votes, deprecated SECURITY DEFINER overload).
- **Constraints:** Destructive ops (DROP TABLE / DROP POLICY / DROP FUNCTION) — each requires Bastian's go-ahead and a pre-flight check. Tracking lives in `memory/audits/REMEDIATION-PLAN.md`.
- **Progress:** Phase A complete. S-P0-1 dropped both backup tables (pre-flight live=240/8560 vs backup=130/8500). S-P0-2 stripped 4 legacy `user_votes` policies via patched `deploy_rls_policies.py` (pg_policies now shows only the 4 `_own`). S-P0-3 dropped the deprecated `get_user_judging_profile(uuid)` overload via patched `deploy_judging_profile.py` (pg_proc shows no-arg overload only).
- **Decisions:** Established a consistent pattern across all 3 fixes — bake the destructive DROP into the existing deploy script (with `IF EXISTS`) rather than a one-off script. Future redeploys are self-healing: anyone re-running these scripts on a fresh environment will not reintroduce the deprecated objects.
- **NextSteps:** Phase B — Supabase P1 data fixes. Start with S-P1-4 (backfill `fights.winner` for ids 8281, 8269, 8761 after verifying each against `fmd.method_details`). Then S-P1-6 (fight 8754 alias), S-P1-5 (rfs.fight_url scraper fix + 270-row backfill), S-P1-7 (user_votes FK CASCADE).

**Phase B — S-P1-4 resolved (2026-05-23) — Checkpoint**
- **Goal:** Close S-P1-4 (3 NULL-winner decision fights flagged by the 2026-05-16 audit).
- **Constraints:** Verify each fight against ufcstats before writing winners; data-correctness fixes only — no schema changes.
- **Progress:** Audit premise was wrong. Bastian's ufcstats screenshots confirmed all 3 fights (8281, 8269, 8761) are genuine draws — both fighters have "D" status. `fights.winner = NULL` is correct. **Real fixes done:** (b) `supabase/fix_fmd_result_draws.py` set `fmd.result = 'draw'` for 8269 + 8281 (8761 already had it); (c) `ScorecardComparison.js` + `FightDetailView.js` now render "Draw — {method}" when winner NULL on a decision; (e) `master file for data update.py` got `rescrape_null_winner_decisions()` called from `sync_meta` after the insert loop — re-scrapes NULL-winner decisions and updates only when the parse returns a winner. Frontend build clean (+150B JS, +11B CSS), 23/23 tests pass.
- **Decisions:** Avoided the trap of "blindly trusting the audit" — re-verified against the source. The audit's `correct_picks` impact concern is moot because draws shouldn't count toward fight accuracy anyway.
- **NextSteps:** Two new follow-ups (S-P1-16 method_details parser drops loser score; S-P1-17 judge_scores Miranda fighter inversion on fight 8761) added to REMEDIATION-PLAN.md Phase K. Resume Phase B with S-P1-5 (rfs.fight_url) next.

**Phase B — S-P1-5 resolved (2026-05-24) — Checkpoint**
- **Goal:** Close S-P1-5 (270 rfs rows with NULL fight_url + scraper not populating the column on new inserts).
- **Constraints:** No HTTP request increase — value must be sourceable from data already in flight. Backfill must be reversible.
- **Progress:** Phase 4 upsert in `master file for data update.py` now stamps `fight_url` from `task['fight_url']` (already returned by the `fight_scraping_status` view) onto every merged row before upsert. `supabase/backfill_rfs_fight_url.py` cleared 334 historical rows across 6 events (audit's 270 + a 6th event that landed in the interim). Pre-flight sanity check confirmed every NULL row mapped to a fights row under bidirectional bout matching (Convention #9). Post-state: 0 NULL fight_url rows in rfs.
- **Decisions:** Bake the fix into the upsert site, not a post-insert UPDATE — the value was already in the task dict, so it's a zero-cost stamp. Backfill script aborts if any (event, bout) combo can't be matched, so we never end up half-migrated.
- **NextSteps:** Phase C dependencies are now unblocked — S-P2-11 (refactor `fight_dna_metrics` view to join via `fight_url`) and S-P2-13 (add `idx_round_fight_stats_fight_url`) can proceed when ready. Resume Phase B with S-P1-6 (fight 8754 alias) or S-P1-7 (user_votes CASCADE).

**Phase B — S-P1-7 resolved (2026-05-24) — Checkpoint**
- **Goal:** Close S-P1-7 — switch `user_votes.fight_id` FK from `NO ACTION` to `ON DELETE CASCADE` so all 4 user-data tables share one delete behavior.
- **Constraints:** Idempotent script; pre-flight aborts if any orphans exist (re-adding the FK would fail); single-transaction DROP/ADD so we never leave the column unconstrained.
- **Progress:** `supabase/migrate_user_votes_cascade.py` deployed. Pre-flight: 240 rows, 0 orphans, current = NO ACTION. Post-state verified via `pg_constraint`: `confdeltype = 'c'`. Sibling parity now holds across `user_round_scores` / `user_fight_scorecard_state` / `fight_ratings` / `user_votes`. `context/schema.md` updated to note `ON DELETE CASCADE` on all four `fight_id` FKs.
- **Decisions:** Scope held to `fight_id` only — the audit didn't flag `user_votes.user_id` (also NO ACTION on `auth.users`), so leaving it as a future call. No data written or removed; this is a constraint swap, not a backfill.
- **NextSteps:** Phase B has one P1 left: S-P1-6 (fight 8754 Pitbull/Freire alias — 6 duplicate rfs rows + bout-string rewrite on `fights` + `fmd`). After that, Phase C unblocks (view refactor, indexes, search_path hardening).

**Phase B — S-P1-6 resolved (2026-05-24) — Checkpoint**
- **Goal:** Close S-P1-6 — resolve fight 8754 (UFC 327 Pico vs Pitbull) Patricio Pitbull/Patricio Freire alias mismatch. Two name variants in the DB: `fights.bout` said "Freire", `fmd.bout` said "Pitbull", `round_fight_stats` had 12 rows (6 per bout variant, both sets identical). Per-fighter analytics that GROUP BY `fighter_name` double-counted this fight's strikes.
- **Constraints:** Read-only pre-flight to verify audit premise before any DELETE/UPDATE; single-transaction UPDATE-then-DELETE so the `fight_dna_metrics` view never briefly returns no rows; idempotent (re-running after success is a no-op).
- **Progress:** `supabase/fix_fight_8754_alias.py` deployed. Pre-flight confirmed: `fights.bout='Freire...'`, `fmd.bout='Pitbull...'` (already canonical), 6 alias rfs rows + 6 canonical rfs rows, 0 user data attached (no votes/scores/state/ratings). Single-tx swap landed: `fights.bout` updated to "Patricio Pitbull vs Aaron Pico"; the 6 alias rfs rows deleted. Post-verify: bout-reversal census "neither" count = 0 (was 1), `fight_dna_metrics` for fight 8754 unchanged (216 head strikes, 15 min duration — same as before, picked up from the surviving Pitbull set).
- **Decisions:** Canonical = "Patricio Pitbull" (matches `fmd.bout`, both rfs sets' `fighter_name`, current ufcstats page). Held scope to fight 8754 only — the two other Patricio Freire fights (UFC 314 Yair Rodriguez vs Patricio Freire, UFC 318 Patricio Freire vs Dan Ige) use "Freire" consistently across `fights`/`fmd`/`rfs.fighter_name` and were never in the "neither" census, so leaving them. `judge_scores.bout="Aaron Pico vs Patricio Freire"` left as-is — joins via date, not bout. **Phase B complete** (all 4 P1 Supabase items resolved).
- **NextSteps:** Phase C now fully unblocked. Recommended order: S-P2-11 (`fight_dna_metrics` view refactor to join via `fight_url` — removes the (event_name, bout) join entirely and makes this whole class of alias-duplicate bug impossible at the view layer), then S-P2-13 (`idx_round_fight_stats_fight_url` + `idx_user_votes_fight_id`), then S-P2-8 (search_path hardening on 7 SECURITY DEFINER fns) or S-P2-9 (revoke anon EXECUTE).

**Phase C — S-P2-11 + S-P1-18 resolved (2026-05-24) — Checkpoint**
- **Goal:** Close S-P2-11 (refactor `fight_dna_metrics` to join `round_fight_stats` via `fight_url` instead of `(event_name, bout)`, removing Convention #9 risk at the view layer).
- **Constraints:** Refactor must be value-stable for the view's consumers (`ufc_baselines`, all `dataService.js` reads). Per-fight DNA metrics + league baselines must match pre- and post-deploy. Pre-flight must confirm `rfs.fight_url` is canonical before any view change.
- **Progress:** Pre-flight uncovered a separate **pre-existing data bug** that blocked the refactor: 1237 `rfs.fight_url` rows across 220 fighter-pairs were misstamped because the April 2026 FK migration backfilled `rfs.fight_url` using only bout-text matching (no `event_name` filter). For rematches and recurring fighter pairs, Postgres picked the wrong `fmd` row and stamped its URL. The live view masked this because it joined on `(event_name, bout)` text, but a naïve switch to `fight_url` would have lost stats for 215 fights. Surfaced to Bastian with three options; chose the two-step deploy. **(1)** `supabase/fix_rfs_fight_url_misstamps.py` (new — S-P1-18): re-stamped 1237 rows via event-aware bidirectional bout match, single-tx UPDATE. Pre-flight aborts on ambiguity; Ultimate Japan no-contest case (only ambiguous row) is excluded via `NOT EXISTS` guard. Post-verify: 0 remaining misstamps; `fight_dna_metrics` values unchanged for all 219 affected fights (confirms dormant data). **(2)** `supabase/deploy_fight_dna_metrics.py` (new — S-P2-11): CREATE OR REPLACE VIEW with rfs aggregated by `fight_url`. Pre-flight requires 0 NULL `fight_url` + 0 cross-event misstamps. Post-verify: 8712 rows (unchanged), 11 sampled fights identical, `ufc_baselines` identical to 6 decimals, full-sweep parity 1 known-good divergence (fight 3436 = Ultimate Japan overturned no-contest; old view double-counted the rematch's stats, new view correctly attributes 0). DDL keeps column list + types so `ufc_baselines` and frontend queries need no migration.
- **Decisions:** (a) Two-step deploy in one PR rather than deferring S-P2-11 — fixing the data bug without the refactor leaves the latent issue and another deploy on the calendar; refactoring without the fix is a regression. (b) Whitelisted fight 3436 in the deploy script's parity check (`EXPECTED_DIVERGENCES = {3436}`) so re-runs don't false-fail. The divergence is a fix, not regression — view now correctly attributes the same-card rematch's stats to one fights row instead of both. (c) Added S-P1-18 to REMEDIATION-PLAN.md retroactively under Phase B to document the discovery + resolution.
- **NextSteps:** Phase C continues. Recommended next: S-P2-13 (`idx_round_fight_stats_fight_url` + `idx_user_votes_fight_id` — now genuinely useful since the view joins on `fight_url`). Then S-P2-8 (search_path hardening on 7 SECURITY DEFINER fns) or S-P2-9 (revoke anon EXECUTE on user-scoped RPCs).

**P1 audit findings**
- [x] **A4.** ~~Backfill 3 NULL-winner decision fights (ids 8281, 8269, 8761)~~ — **RESOLVED 2026-05-23**: audit premise wrong, all 3 are genuine draws (both fighters "D" on ufcstats). Frontend draw rendering added, Phase 3 re-scrape guard added, `fmd.result` cleaned up. Two new follow-ups split out (S-P1-16 method_details parser, S-P1-17 judge_scores Miranda inversion). See `04-data-quality.md §2`.
- [x] **A5.** ~~Populate `round_fight_stats.fight_url` in Phase 4 scraper + backfill 270 NULL rows~~ — **RESOLVED 2026-05-24**: Phase 4 upsert now stamps `fight_url` from the `fight_scraping_status` task dict; `supabase/backfill_rfs_fight_url.py` cleared 334 historical rows (270 from audit + 64 from a 6th event that landed in the interim). Pre-flight verified every NULL row mapped to a fights row. See `02-schema.md §3`.
- [x] **A6.** ~~Resolve fight 8754 duplicate rfs (Pitbull/Freire alias)~~ — **RESOLVED 2026-05-24** via `supabase/fix_fight_8754_alias.py`. Single-tx UPDATE `fights.bout` to canonical "Patricio Pitbull vs Aaron Pico" + DELETE the 6 alias rfs rows. Bout-reversal "neither" census now 0; view stats unchanged. **Phase B complete.** See `04-data-quality.md §4`.
- [x] **A7.** ~~Switch `user_votes.fight_id` FK to ON DELETE CASCADE for consistency~~ — **RESOLVED 2026-05-24** via `supabase/migrate_user_votes_cascade.py`. Sibling parity now holds across all 4 user-data tables on `fight_id`. See `02-schema.md §1`.
- [x] **S-P1-18.** ~~Re-stamp 1237 misstamped `rfs.fight_url` rows~~ — **RESOLVED 2026-05-24** via `supabase/fix_rfs_fight_url_misstamps.py`. Pre-existing bug from April's `migrate_round_stats_fk.py` (text-only bout match, no event_name filter, picked wrong fmd row for rematches). Discovered during S-P2-11 pre-flight. Single-tx UPDATE with event-aware bidirectional bout match; 0 remaining misstamps; `fight_dna_metrics` values unchanged (proves dormant data). Ultimate Japan no-contest excluded via `NOT EXISTS` guard.

**P2 audit findings:** 7 items — `search_path` lock on SECURITY DEFINER fns, anon-grant drift, view refactor to `fight_url`, indexes. See `99-followups.md`.

- [x] **S-P2-11.** ~~Refactor `fight_dna_metrics` view to join via `fight_url`~~ — **RESOLVED 2026-05-24** via `supabase/deploy_fight_dna_metrics.py`. CREATE OR REPLACE VIEW with rfs aggregated by `fight_url`. Pre-flight enforces 0 NULL fight_url + 0 cross-event misstamps. Row count + `ufc_baselines` + 11 sampled fight values all identical pre/post. 1 known-good divergence (fight 3436 Ultimate Japan no-contest — old view double-counted rematch stats, new view correctly attributes 0; whitelisted in deploy script).

---

Completed phases archived in `context/completed-phases.md`. Active and upcoming phases below.

Status markers: `[ ]` not started · `[~]` in progress · `[x]` complete · `[!]` blocked

---

## Completed

- **Phase 1** — Codebase Review & Hardening ✅ _(deferred: CombatScatterPlot mobile, fetchYears optimisation)_
- **Phase 2** — Data Cleanup ✅
- **Phase 3** — Predictive Scoring Feature (ML model) ✅
- **Phase 4.5** — Weight Class Normalization ✅
- **Phase 7** — Guest Mode ✅
- **Spoiler Protection** — Per-user default in `profiles` table; per-fight toggle in fight detail; auto-reveal on existing/completed scores ✅

---

## Phase 4: Judge Profile Pages

One page per judge. Min threshold: 50+ rounds judged. Data: `judge_scores` joined with `round_fight_stats` and `fight_meta_details`.

**Cross-source join strategy:** Use pair-matching — extract unique fighter pairs per event from `judge_scores`, score each pair against the target fight's fighters as a unit (`max(sim(a,f1)+sim(b,f2), sim(a,f2)+sim(b,f1))`). More robust than per-name matching; avoids cross-fight collisions.

- [x] **4a. Style Preference** — striking/grappling/aggressor/KD bias in `get_judge_profile()` RPC + UI
- [x] **4b. Consensus & Controversy** — agreement breakdown + controversial fights in profile RPC + UI
- [x] **4c. 10-8 Round Tendency** — 10-8 rate overall + by division in profile RPC + UI
- [x] **4d. Weight Class Breakdown** — by_class in profile RPC + UI
- [x] **4e. Era / Trend Analysis** — by_year in profile RPC + UI
- [x] **4f. Head-to-Head Judge Comparison** — disagreement rate, overlaid style bars, by-division, top disagreement fights
- [x] **4g. Judge Leaderboard / Directory** — sortable table, click through to individual profile

---

## Phase 5: Weight Class Analytics

One analytics page per division. All computable from existing tables. Join key: `fight_meta_details.weight_class_clean`.

- [ ] **5a. Division Overview** — total fights, finish rate, avg duration, decision/KO/sub breakdown over time
- [ ] **5b. Style Trends Over Time** — avg sig strikes, takedowns, control time per round by year
- [ ] **5c. Style Fingerprint per Division** — radar chart vs UFC average
- [ ] **5d. Most Controversial Division** — highest judge outlier rate and split decisions (cross-ref Phase 4)

---

## Phase 6: User Round Scoring & Judging DNA

### 6a. DB Migration — complete ✅
### 6b. Live Event Sync — complete ✅ _(deferred: schedule master scraper to auto-run on event day)_

### 6b.2 Server-Side Live Polling — [x] complete

**Problem:** Client-side polling in `FightDetailView` only runs when a user has the fight detail page open. If no user is watching, `fight_ended_at` / `rounds_fought` never get written to the DB.

**Solution:** `poll-live-fights` Edge Function + Supabase pg_cron.

- [x] Write `supabase/functions/poll-live-fights/index.ts` — 3 guards + ESPN polling + DB writes
- [x] Deploy script: `supabase/deploy_poll_live_fights.py` — Supabase CLI + pg_cron + pg_net setup
- [x] Deployed via CLI (`npx supabase functions deploy`) + pg_cron job active (`* * * * *`)
- [x] Test: verify `rounds_fought` is written correctly after a fight ends with no browser open
### 6c. Scoring UI in FightDetailView — complete ✅

**Deferred UX improvements (to be built during 6e.2):**
- [x] "View judges without scoring" option — triggers forfeit path (`forfeited = true`)
- [x] Ineligibility warning modal — shown before forfeiting or before editing post-reveal scores. Confirmation step (cancel / proceed), not just dismissible notice

### 6d. Scorecard Reveal View — complete ✅
### 6e. Judging DNA Profile — complete ✅

### 6e.2 Judging DNA — Overhaul

**Steps 1+2 complete** (RPC overhaul + UI redesign). Current `get_user_judging_profile()` returns:
`rounds_scored`, `agreement_breakdown`, `outlier_rate`, `ten_eight_quality`, `accuracy_by_class` (with `rounds` + `avg_loser_score`).

**Step 3: RPC extension — round_fight_stats join** ✅

- [x] Add `round_fight_stats` join to RPC for each user-scored round
- [x] Compute and return `striking_vs_grappling_bias`, `aggressor_bias`, `takedown_quality_bias`, `knockdown_bias`, `bias_by_class` (merged into `accuracy_by_class`)
- [x] Redeploy via `supabase/deploy_judging_profile.py`

**Step 4: UI additions for Group B** ✅

- [x] Add "Scoring Tendencies" section to `JudgingDNACard.js`:
  - Strike vs Grapple Lean: two-tone bar (blue=strike, amber=grapple) + "By Class ▾" toggle
  - Aggressor Lean, Passive Control, KD Fighter — 3-column stat grid

**Step 6: Judging DNA additional metrics** ✅

- [x] Rename "Judge Confirmed" → "10-8 Accuracy" label
- [x] `scoring_differentials` RPC field + UI: avg sig strike / control time / ground strike margin when awarding a round
- [x] `takedown_lean` RPC field + UI: % of TD-differential rounds sided with the higher-TD fighter; bias grid expanded to 2×2
- [x] `gender_split` RPC field: per-gender accuracy, outlier rate, 10-8 rate, strike/grapple lean, aggressor bias
- [x] Men's / Women's toggle pill in card header (hidden unless user has scored women's fights); filters overview stats, 10-8 rate, strike/grapple lean, aggressor lean, and weight class breakdown

**Step 5: Scored Fights list** ✅

- [x] `getScoredFights()` in `dataService.js` — fights user has scored with f1/f2 totals attached
- [x] Collapsible section at bottom of Judging DNA view
  - Last-name vs last-name rows with event + weight class subline
  - User's total scorecard (e.g. "29–28 Poirier") using fight_meta_details for f1/f2 names
  - Green/red dot indicating correct winner pick (normN comparison vs fights.winner)
  - Click navigates to fight detail via onFightClick prop

### 6f. Leaderboard — complete ✅

- [x] `get_leaderboard()` RPC — decisions-only fight accuracy + round accuracy vs judge majority, ranked, min 3 eligible fights
- [x] `display_name` column added to `profiles` (nullable; fallback: "Scorer #XXXX")
- [x] `Leaderboard.js` — 6-col table (Dec / Fight% / Rnds / Round%), skeleton, empty state, current-user highlight
- [x] `dataService.getLeaderboard()` + wired in App.js (scores tab, accessed from Judging DNA)
- [x] Eligibility bug fix — `leaderboard_eligible` redefined to `NOT forfeited AND NOT modified_after_reveal`; historical fights no longer incorrectly set `modified_after_reveal`
- [ ] Weight class filter — deferred
- [ ] `display_name` setter in profile UI — deferred
- [x] **Row expand dropdown** — tap any row to expand inline; Fights/Rounds tab toggle; green/red dots; lazy-fetch + cache via `get_leaderboard_user_detail(p_user_id uuid)` RPC; fight rows navigate to fight detail

---

### User vs Judge Comparison — complete ✅

- [x] `get_user_judge_comparison(p_judge text)` RPC — user rounds joined to a specific judge via date ±1 day + last-name match; returns `shared_rounds`, `shared_fights`, `agreement_rate`, `by_class`, `top_disagreements`
- [x] `getUserJudgeComparison(judgeName)` in dataService.js
- [x] `UserJudgeComparison.js` — picker + comparison view (agreement rate hero, side-by-side stats, DualBar tendencies, by-division, top disagreements with fight navigation)
- [x] `JudgingDNACard.js` — "Judge Match" section shows top-3 clickable judge rows + "Compare vs any judge ›" button
- [x] App.js — `userJudgeComparison` view wired; DNA nav button stays highlighted in new view

---

---

## Phase 8: UI/UX Overhaul — Concept D (Pulse)

Redesign the entire frontend from the current gold/black Oswald theme to Concept D (Pulse). Mobile-first (90% of users on mobile/tablet).

**Design language:** Instagram Stories-style swipe navigation, full-viewport fight cards, bottom sheet details. Barlow Condensed + Inter, red/blue fighter colors, charcoal (#0e0e12).

**Reference mockups:** `mockups/concept-D-pulse/` (14 pages, 01-login through 14-profile)

- [x] **8a. Design tokens & Tailwind config** — Pulse color palette, Barlow Condensed + Inter fonts, custom radii/spacing, CSS custom properties
- [x] **8b. Layout shell** — bottom nav (4 tabs), slim top bar, story progress bar, content wrapper (430px), currentTheme rewritten to Pulse tokens
- [x] **8c. Fight card redesign** — two-column fighter layout with red/blue avatars, badge row, VS divider + weight class pill, vote buttons restyled
- [x] **8d. Fight detail view** — avatar header, green result banner, 4-tab bar (Overview/By Round/Scoring/Judges), red/blue dual stat bars, round breakdown with ML description, R1 stoppage empty state
- [x] **8e. Scoring & DNA panels** — RoundScoringPanel, ScorecardComparison, CombatDNA, JudgingDNA
  - [x] RoundScoringPanel — round selector, single-round scoring, 72px score buttons, scored summary, running total
  - [x] RoundScoringPanel — point deduction scoring (9-9, 8-8 draws); independent per-fighter score selection; 10-10 blocked
  - [x] ScorecardComparison — 5-col grid (Round/You/Judges/Model/Match), expandable judges, accuracy ring, result card
  - [x] CombatDNACard — Pulse surface cards, red accent values, pulse token classes
  - [x] CombatDNAVisual — Pulse card, stat bars + per-fight averages alongside body map
  - [x] CombatScatterPlot — removed from Combat DNA page (data kept for "Apply My Stats" filter)
  - [x] JudgingDNACard — Pulse surface cards, accuracy ring, horizontal-scroll weight class cards, judge avatars, bias tiles
  - [ ] Deferred: CombatDNAVisual landed vs attempted strike data investigation
- [x] **8f. Polish** — animations, loading states, mobile audit, accessibility
  - [x] 8f.1 Skeleton loading states — FightDetailView, RoundScoringPanel, ScorecardComparison, App.js event/fight lists
  - [x] 8f.2 Animations & transitions — stagger fight cards, tab cross-fade, button press feedback, expand/collapse
  - [x] 8f.3 Mobile audit — touch targets, scroll indicators, responsive SVG
  - [x] 8f.4 Accessibility — ARIA labels, focus management, contrast, keyboard nav

---

## Phase 9: Scoring Insights (Judging DNA Extension)

New "Scoring Insights" section in Judging DNA. Compares user's scoring against their own patterns across rounds. Tiered unlocking (15/40/80 matched rounds). Separate `get_scoring_insights()` RPC, lazy-loaded.

**Features:**
1. Round-by-Round Drift — accuracy per round number + momentum bias
2. Stat-Score Disconnect — rounds where user scored against the stat-sheet winner
3. Consistency Score — how consistently the user scores similar stat profiles
4. Stat Weighting Fingerprint — which stats best predict the user's picks (radar chart)
5. Pattern Breaks — rounds where the user went against their own fingerprint

**Steps:**
- [x] **9.1** RPC `get_scoring_insights()` — all 5 features + tier gating + deploy script
- [x] **9.2** `dataService.getScoringInsights()` + App.js wiring + lazy fetch
- [x] **9.3** `ScoringInsightsCard.js` shell + TierBadge + FingerprintRadar
- [x] **9.4** Wire ScoringInsightsCard into JudgingDNACard as collapsed section
- [x] **9.5** PatternBreakCard UI
- [x] **9.6** DisconnectCard UI
- [x] **9.7** ConsistencyGauge UI
- [x] **9.8** DriftSparkline UI
- [x] **9.9** Tier 2/3 UI controls (gender/group splits)
- [x] **9.10** Polish + context file updates

---

## Security Hardening — 2026-04-14 Audit (CONDITIONAL verdict)

Full 4-round multi-agent audit. Audit files in `memory/audits/2026-04-14/`.

### P0 — Fixed
- [x] **RLS not enabled** — user_round_scores, user_fight_scorecard_state, user_votes, profiles all had no RLS. Any authenticated user could read any other user's data. Deployed `supabase/deploy_rls_policies.py`.
- [x] **record-fight-status auth bypass** — Edge Function checked only header presence, not JWT validity. Fixed in `supabase/functions/record-fight-status/index.ts`. Deployed.
- [x] **.gitignore corruption** — line 5 garbled, build/ and .claude/settings.local.json not excluded. Rewritten.

### P1 — Backlog
- [x] Create `.env.example` documenting 4 required vars + Python 3.9 note
- [x] Create `requirements.txt` with pinned Python deps
- [x] Add `pre-push` git hook running `npm run build`
- [x] Version-control `update_fight_ratings` trigger SQL → `supabase/deploy_triggers.py`
- [x] Add FK constraint on `round_fight_stats` → `supabase/migrate_round_stats_fk.py`; backfilled 40,616 rows; patched UFC 327 Freire/Pitbull naming mismatch; FK + UNIQUE constraint on fights.fight_url deployed
- [x] ML model: load coefficients from `public/scoring_model.json` at runtime; scoring_model.json copied to public/

### P2 — Tech debt backlog
See `memory/audits/2026-04-14/decisions-and-actions.md` for full list.

**Done (2026-04-15):**
- [x] #10 Delete `CombatScatterPlot.js` (dead code)
- [x] #13 Remove `@tailwindcss/postcss` — CRA never invokes it (no postcss.config.js); build confirmed clean
- [x] #15 Move `@testing-library/*` to `devDependencies`
- [x] #17 IDOR — reviewed SQL (no raw scores); revoked `anon` grant on `get_leaderboard_user_detail`, redeployed
- [x] #18 `getLeaderboard` / `getLeaderboardUserDetail` now return safe defaults on error
- [x] #24 `deploy_scoring_insights.py` confirmed committed (e197894)

**Done (2026-04-23):**
- [x] #12 Extract `CombatDNACard` to `src/components/CombatDNACard.js`; removed 3 unused lucide imports from App.js; build confirmed clean
- [x] #16 Created `supabase/deploy_indexes.py` — 6 indexes version-controlled: `judge_scores(date)`, `judge_scores(judge)`, `fight_meta_details(fight_url)`, `fight_meta_details(weight_class_clean)`, `round_fight_stats(event_name, bout)`, `user_round_scores(user_id, fight_id)`
- [x] #11 Cross-reference comments added to both `normName()` copies
- [x] #14 First test file: `src/guestStorage.test.js` — 21 tests across all 8 exports, 21/21 passing: FightDetailView.js (canonical) ↔ poll-live-fights/index.ts (mirror)
- [x] #21 Magic number thresholds extracted to named constants: `INTENSITY_MAULER_THRESHOLD`/`INTENSITY_ACTIVE_THRESHOLD` (CombatDNACard), `TEN_EIGHT_CONFIDENCE_THRESHOLD` (FightDetailView), `TIER1_MIN_ROUNDS`/`CONSISTENCY_HIGH_THRESHOLD`/`CONSISTENCY_MID_THRESHOLD` (ScoringInsightsCard)

---

## Post-Event Automation ✅

- [x] `is_post_event_window()` guard — `start_time + 5h` to `start_time + 48h`; fails safe if `start_time` NULL
- [x] `--post-event` argparse flag — runs Phases 0/0.5/1/5/6 (not 2/3/4 — those are handled by `--live`)
- [x] `.github/workflows/post-event-scraper.yml` — `0 */2 * * *` cron, same secrets as live scraper

---

## Build Order

6e.2 Step 3 → Step 4 → Step 5 → User vs Judge ✅ → 6f (deferred) → Phase 5 → **Phase 8** ✅ → **Phase 9** ✅ → Post-Event Automation ✅
