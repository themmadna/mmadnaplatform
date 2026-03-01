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
- [ ] Remove unused `grapplingIntensity` key from `CombatDNACard` fallback baselines — App.js:13
- [ ] Remove empty locked overlay div (bg-black/5, no content, invisible) — App.js:163
- [ ] Clean up dual `recommendationReason || match_reason` check — confirm RPC return shape — dataService.js:135

#### UX Gaps
- [ ] Add loading state when clicking an event (fights view is blank while fetching) — App.js:448
- [ ] Review `isVotingLocked` behaviour when no `start_time` — upcoming fights are currently voteable — App.js:581

### 1b. UI/UX Review
- [ ] Walk through user flows end to end
- [ ] Identify layout, responsiveness, or usability issues
- [ ] Prioritise fixes

### 1c. Backend & Scraper Review
- [ ] Review master scraper pipeline — correctness, edge cases
- [ ] Review scrape_mmadecisions.py — improvements identified in session (env var check, unused pandas import)
- [ ] Verify Supabase schema matches what frontend expects

## Phase 2: Data Cleanup

- [ ] TRUNCATE judge_scores + re-run scrape_mmadecisions.py to fix slug-based fighter names

## Phase 3: Predictive Scoring Feature

- [ ] Design round scoring model (rules-based: strikes + takedowns + control time weighted per UFC judging criteria)
- [ ] Build fight detail page / modal in frontend (triggered by clicking a fight card)
- [ ] Add dataService function to fetch judge_scores joined via date + bout
- [ ] Display judge scorecards round by round alongside model predictions
