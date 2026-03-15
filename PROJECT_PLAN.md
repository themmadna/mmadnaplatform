# UFC Web App — Project Plan

Completed phases archived in `context/completed-phases.md`. Active and upcoming phases below.

Status markers: `[ ]` not started · `[~]` in progress · `[x]` complete · `[!]` blocked

---

## Completed

- **Phase 1** — Codebase Review & Hardening ✅ _(deferred: CombatScatterPlot mobile, fetchYears optimisation)_
- **Phase 2** — Data Cleanup ✅
- **Phase 3** — Predictive Scoring Feature (ML model) ✅
- **Phase 4.5** — Weight Class Normalization ✅
- **Phase 7** — Guest Mode ✅

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

### 6b.2 Server-Side Live Polling — [ ] not started

**Problem:** Client-side polling in `FightDetailView` only runs when a user has the fight detail page open. If no user is watching, `fight_ended_at` / `rounds_fought` never get written to the DB.

**Solution:** `poll-live-fights` Edge Function + Supabase pg_cron.

- [ ] Write `supabase/functions/poll-live-fights/index.ts`:
  - Guard 1: query `ufc_events` + `fights` for `event_date = today` — exit if none
  - Guard 2: parse `ufc_events.start_time` — exit if current time is before event start
  - Guard 3: check if all `upcoming` fights for today have `fight_ended_at IS NOT NULL` — exit if so
  - Otherwise: fetch ESPN scoreboard for today's date, loop fights, update `fight_started_at` / `fight_ended_at` / `rounds_fought` / `ended_by_decision` / `scheduled_rounds` directly via service role REST API (same logic as `record-fight-status` but server-side, no JWT needed)
- [ ] Deploy via Management API (same pattern as `record-fight-status` — no esm.sh imports, native fetch only)
- [ ] Schedule with pg_cron: `cron.schedule('poll-live-fights', '* * * * *', ...)` — calls the Edge Function every minute
- [ ] Test: verify `rounds_fought` is written correctly after a fight ends with no browser open
### 6c. Scoring UI in FightDetailView — complete ✅

**Deferred UX improvements (to be built during 6e.2):**
- [ ] "View judges without scoring" option — triggers forfeit path (`forfeited = true`)
- [ ] Ineligibility warning modal — shown before forfeiting or before editing post-reveal scores. Confirmation step (cancel / proceed), not just dismissible notice

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

**Step 5: Scored Fights list** ✅

- [x] `getScoredFights()` in `dataService.js` — fights user has scored with f1/f2 totals attached
- [x] Collapsible section at bottom of Judging DNA view
  - Last-name vs last-name rows with event + weight class subline
  - User's total scorecard (e.g. "29–28 Poirier") using fight_meta_details for f1/f2 names
  - Green/red dot indicating correct winner pick (normN comparison vs fights.winner)
  - Click navigates to fight detail via onFightClick prop

### 6f. Leaderboard — deferred

- [ ] Leaderboard page: rank users by accuracy % — overall and by weight class
- [ ] Only `leaderboard_eligible = true` scorecards count

---

### User vs Judge Comparison — complete ✅

- [x] `get_user_judge_comparison(p_judge text)` RPC — user rounds joined to a specific judge via date ±1 day + last-name match; returns `shared_rounds`, `shared_fights`, `agreement_rate`, `by_class`, `top_disagreements`
- [x] `getUserJudgeComparison(judgeName)` in dataService.js
- [x] `UserJudgeComparison.js` — picker + comparison view (agreement rate hero, side-by-side stats, DualBar tendencies, by-division, top disagreements with fight navigation)
- [x] `JudgingDNACard.js` — "Judge Match" section shows top-3 clickable judge rows + "Compare vs any judge ›" button
- [x] App.js — `userJudgeComparison` view wired; DNA nav button stays highlighted in new view

---

## Build Order

6e.2 Step 3 → Step 4 → Step 5 → User vs Judge ✅ → 6f (deferred) → Phase 5
