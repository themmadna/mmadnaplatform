# UFC Web App — Project Plan
Last updated: 2026-05-09 (live fight auto-reveal + remove submit button)
Next session: Phase 5 Weight Class Analytics
Last refreshed: 2026-05-16

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
