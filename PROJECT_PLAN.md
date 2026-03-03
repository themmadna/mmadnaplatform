# UFC Web App — Project Plan

## Phase 1: Codebase Review & Hardening

### 1a. Frontend Code Review — complete. Issues categorised below.

#### Bugs
- [x] Fix `event.location` → `event.event_location` (location never displays on event cards) — App.js:839
- [x] Fix `fight.weight_class` fallback — now fetched from `fight_meta_details` in parallel on event click — App.js
- [x] Fix DNA filter tab resets to 'combined' on re-fetch instead of preserving user selection — App.js:572

#### Performance
- [x] Remove duplicate `getGlobalBaselines()` call in `CombatDNACard` — pass baselines as prop from parent
- [x] Merge `getCombatDNA` + `getComparisonData` into one DB query — new `getDNAAndChartData()` in dataService.js
- [~] Optimise `fetchYears` — deferred: query already fetches only `event_date` column (~6KB total); true distinct requires a DB function — low priority

#### Dead Code
- [x] `grapplingIntensity` key — already gone from live code (only in backup copies)
- [x] Remove empty locked overlay div (bg-black/5, no content, invisible)
- [x] Drop dead `recommendationReason || match_reason` mapping — field not rendered anywhere in App.js; `getRecommendations` now returns RPC data directly
- [x] Remove unused `React` import (not needed with modern JSX transform)

#### UX Gaps
- [x] Add loading state when clicking an event (fights view is blank while fetching) — App.js:448
- [x] Review `isVotingLocked` behaviour when no `start_time` — upcoming fights are currently voteable — App.js:581

### 1b. UI/UX Review
- [x] Walk through user flows end to end
- [x] Identify layout, responsiveness, or usability issues
- [x] Prioritise fixes

#### Fixes (in priority order)
- [x] Empty state when eventFights is empty after loading — App.js:846
- [x] Filter panel: add Reset button — App.js:641
- [x] Profile tabs: empty state per tab — App.js:916
- [x] Theme selector: close on click-outside — App.js:590
- [x] Search results: pass locked prop for upcoming fights — App.js:748
- [x] "Voting opens at start time" copy is inaccurate when locked by date — App.js:202
- [~] Initial "Loading..." is unstyled (low priority)
- [~] Back button loses year/scroll position (low priority)
- [~] Year tabs have no scroll affordance (low priority)
- [~] Redundant DNA headers (low priority)

### 1c. Backend & Scraper Review — complete. Issues found and fixed below.

#### master file for data update.py
- [x] `sync_round_stats` — insert → upsert with `on_conflict="event_name,bout,round,fighter_name"` (duplicate rows on PARTIAL fights)
- [x] Add `timeout=15` to all 4 bare `requests.get()` calls (could hang indefinitely)
- [x] Safe `int()` for kd/sub_attempts/reversals in `parse_base_stats_table` (crash on `--` or empty string)
- [x] Add UFC name guard in `sync_event_times` (prevent setting wrong start_time if non-UFC event on same date)
- [x] Added unique constraint to DB: `round_fight_stats_unique UNIQUE (event_name, bout, round, fighter_name)`

#### scrape_mmadecisions.py
- [x] Remove unused `import pandas as pd`
- [x] Add env var guard (same pattern as master file)
- [x] Fix `scrape_errors.log` path — now resolves relative to script, not cwd

#### Bonus bug found during review
- [x] Weight class shows "MAIN CARD" on ~2,997 fight cards — `metaMap` keyed on `bout` string which is reversed between `fights` and `fight_meta_details`; fixed by keying on `fight_url` instead — App.js:445,449,454

#### Schema verification
- [x] `fight_dna_metrics` view columns confirmed match `getDNAAndChartData()` usage
- [x] `get_fight_recommendations` RPC confirmed receives all 7 params correctly
- [~] `supabase/views/` and `supabase/functions/` not yet populated — run `fetch_schema.py` when needed

## Phase 1d: Mobile Responsiveness — Critical Fixes

Targeted Tailwind class changes only. No structural redesigns. Test at iPhone SE (375px) and Galaxy S8 (360px) in Chrome DevTools device toolbar.

### App.js
- [x] Header title: `text-3xl` → `text-2xl md:text-3xl` — "MMA DNA" crowds on < 380px (line 624)
- [x] FightCard fighter names: `text-xl` → `text-base sm:text-xl` — long names overflow on narrow phones (line 151)
- [x] CombatDNACard Strike Pace & Violence Index values: `text-3xl` → `text-2xl sm:text-3xl` — cramped in 2-column grid at 375px (lines 55, 63)
- [x] CombatDNACard Finish Rate & Avg Duration: `text-2xl` → `text-xl sm:text-2xl` — same reason (lines 115, 120)
- [x] DNA filter buttons: `px-4` → `px-3 sm:px-4` — 3 buttons at px-4 can be tight at 360px (line 911)

### FightDetailView.js
- [x] Fighter names in fight header: `text-2xl` → `text-lg sm:text-2xl` — long names wrap awkwardly on mobile (lines 260, 262)
- [x] Round card padding: `px-6`/`p-6` → `px-4 sm:px-6`/`p-4 sm:p-6` — leaves too little room for 3-column stats grid at 375px (lines 299, 303)
- [x] Stats rows text: `text-sm` → `text-xs sm:text-sm` — tighter at 3 columns on mobile (line 315)
- [x] Summary scorecard header padding: `px-6` → `px-4 sm:px-6` — consistent with round card fix (line 384)

### Not changing (deferred or not critical)
- CombatScatterPlot — medium priority, deferred
- Vote button touch targets — `py-3` gives ~44px height, meets guidelines
- Theme dropdown positioning — opens rightward from top-left button, fine on all widths
- Judge score text (`text-xs`) — scores are short numbers, legible at xs

---

## Phase 1e: Fight Card Click — All Views

Fight detail click only works in the event fights view. Profile, search results, and "For You" all render `FightCard` without an `onClick` prop so the card is not clickable.

### Root cause
- `handleFightClick` (App.js:466) sets `event_date` from `selectedEvent?.event_date` — this is null on every view except the fights view
- `onClick={handleFightClick}` is only passed in the fights view (App.js:881) — missing on:
  - Profile page (App.js:956)
  - Search results (App.js:772)
  - For You / recommendations (App.js:824)

### Fix applied (App.js)
- [x] Added `previousView` state; `handleFightClick` stores current view before navigating
- [x] `handleFightClick` uses `fight.event_date ?? selectedEvent?.event_date` fallback
- [x] `onBack` uses `previousView` so back goes to correct view (profile/events/fights)
- [x] Profile page — added `onClick={handleFightClick}`
- [x] Search results — added `onClick={handleFightClick}` (fight objects already carry `event_date`)
- [x] For You — added `onClick={handleFightClick}`; `loadForYou` now batch-fetches `event_date` from `ufc_events`
- [x] `fetchUserHistory` — now batch-fetches `event_date` from `ufc_events` and merges into fight objects

---

## Phase 2: Data Cleanup

- [x] TRUNCATE judge_scores + re-run scrape_mmadecisions.py to fix slug-based fighter names
  - [x] Optimize scraper (ThreadPoolExecutor + retry logic) — ready for full re-scrape
  - [x] TRUNCATE judge_scores in Supabase
  - [x] Run scrape_mmadecisions.py (2020–2026) and verify clean fighter names — 29,556 rows, zero slugs
- [x] Backfill historical data: run scrape_mmadecisions.py --start 1995 --end 2019
  - [x] Fix UnicodeEncodeError (charmap/❌ emoji) bug — stdout UTF-8 reconfigure + skip non-numeric scores
  - [x] Re-scrape 2020–2026 to recover 129 fights previously skipped by the bug
  - [x] scrape_errors.log cleared — all errors reconciled
- [x] Fill historical judge_scores gaps — March 2026
  - Root cause: original Check 1 used exact date join (false positives for international events with +1 day offset)
  - Genuine missing events: TUF Finale events from 2010–2017 (mmadecisions names them differently from UFC Stats)
  - Fixed dedup bug in scraper: was using event_name (broken) → now uses URL-derived bout names
  - Added `--no-stop` and `--yes` flags to scraper for targeted gap-fill runs
  - Fixed Check 1 & 2 in diagnose_judge_scores.py to use ±1 day BETWEEN window
  - [x] Verified via diagnose_judge_scores2.py: 5,412 complete, 55 partial (name-match SQL artefacts), 678 missing (pre-2010 / mmadecisions has no data)
  - [x] Built `judge_scores_coverage` view — SQL in `supabase/views/judge_scores_coverage.sql`
- [ ] Add Phase 6 to `master file for data update.py`: after round stats sync, call
  `subprocess.run(["python", "scrape_mmadecisions.py", "--yes"])` so a single run of
  the master file keeps judge scores up to date automatically
  - Keep scrapers as separate files (different sources, failure modes, rate limits)
  - `--yes` flag already added to scrape_mmadecisions.py for non-interactive use

## Phase 3: Predictive Scoring Feature

### 3a. Fight Detail UI — complete
- [x] Add "Details" indicator to FightCard — ChevronRight icon shown on all clickable cards (App.js)
- [x] Add `getFightDetail()` to dataService.js (meta + round stats + judge scores)
- [x] Build `FightDetailView.js` component (round-by-round stats, model prediction, judge scorecards)
- [x] Wire up App.js — fight cards clickable, new `fightDetail` view, back navigation
- [x] Fix event name mismatch — judge_scores queried by date not event_name
- [x] Fix fighter name mismatch — normalized fuzzy matching across ufcstats/mmadecisions sources

#### Judge scores bug — fixed
- [x] `matchesFighter()` now has two fallbacks beyond exact normName match:
  1. Same last name (last word, length > 3) — handles "Alex" vs "Alexander", "Jon" vs "Jonathan"
  2. Word-subset match — all words of the shorter name appear in the longer — handles Jr., middle names, suffixes
- [x] Added console logging in FightDetailView load: logs all `judge_scores` fighters for the date, the names being matched, and their normName forms — open browser console on a missing fight to diagnose any remaining misses

### 3b. Rules-Based Baseline Model — complete (temporary placeholder)
- [x] `scoreRound()` in FightDetailView.js — weights: sig strikes ×1.0, KD ×5.0, takedowns ×2.5, control ×0.015, sub attempts ×1.5
- [x] `validate_scoring_model.py` — measures agreement rate vs judges overall, per judge, per weight class
- Note: this model will be replaced by the trained ML model in Phase 3c

### 3c. ML Scoring Model — Python training pipeline

#### Step 1: Data extraction
- [ ] Script to join `round_fight_stats` + `judge_scores` using normalized name matching (same logic as frontend)
- [ ] Export matched dataset to CSV: one row per (fight, round, judge) with fighter stat differentials and judge winner label
- [ ] Report how many rounds matched cleanly vs had name mismatches (data quality baseline)

#### Step 2: Exploratory data analysis
- [ ] Distribution of round winners (how often does the fighter with more sig strikes win the round per judge?)
- [ ] Feature correlations — which stats most predict the judge's decision?
- [ ] Class balance — how common are 10-8 rounds in the data?
- [ ] Compare rules-based model accuracy to a naive "more sig strikes wins" baseline

#### Step 3: Feature engineering
- [ ] Compute differential features per round: f1_stat - f2_stat for each stat column
- [ ] Add ratio features: sig_strike_acc_diff, takedown_acc_diff
- [ ] Decide on 10-8 prediction: binary (win/lose round) first, then optionally multi-class (10-9 / 10-8 / 10-10)

#### Step 4: Train general model
- [ ] Train logistic regression on all fights — interpretable baseline
- [ ] Train random forest / XGBoost — likely more accurate
- [ ] Cross-validate (time-based split: train on older fights, test on recent)
- [ ] Compare accuracy vs rules-based model and naive baseline

#### Step 5: Per-weight-class analysis
- [ ] Train separate models per weight class
- [ ] Compare per-class accuracy vs general model — does specialisation help?
- [ ] Identify which weight classes the general model struggles with most

#### Step 6: Per-judge analysis
- [ ] For judges with 50+ scored rounds in the data, train judge-specific models
- [ ] Compare per-judge accuracy vs general model — do judges weight strikes vs grappling differently?
- [ ] Identify the most "predictable" and "unpredictable" judges

#### Step 7: Model selection & export
- [ ] Pick the best model(s) based on validation accuracy
- [ ] Export model coefficients/weights to JSON (for logistic regression this is straightforward)
- [ ] OR pre-compute round predictions and store in DB if model is too complex for client-side

#### Step 8: Integrate into app
- [ ] Replace rules-based `scoreRound()` in FightDetailView.js with ML model predictions
- [ ] If per-weight-class models are used, select correct model based on `meta.weight_class`
- [ ] Show model confidence alongside predictions (probability of winner, not just binary)
