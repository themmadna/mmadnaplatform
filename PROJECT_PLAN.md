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

## Phase 2: Data Cleanup

- [ ] TRUNCATE judge_scores + re-run scrape_mmadecisions.py to fix slug-based fighter names

## Phase 3: Predictive Scoring Feature

- [ ] Design round scoring model (rules-based: strikes + takedowns + control time weighted per UFC judging criteria)
- [ ] Build fight detail page / modal in frontend (triggered by clicking a fight card)
- [ ] Add dataService function to fetch judge_scores joined via date + bout
- [ ] Display judge scorecards round by round alongside model predictions
