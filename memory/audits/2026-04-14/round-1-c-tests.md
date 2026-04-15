# Test Coverage Audit — UFC Web App
**Date:** 2026-04-14
**Auditor:** Test Coverage Agent (Round 1-C)
**Project root:** `c:\Users\sabzu\Documents\VS Ufc\ufc-web-app`

---

## Executive Summary

The project has **zero meaningful automated tests** for all production code. The only test file in `src/` (`App.test.js`) contains no test cases — it is a legacy Create React App placeholder that was repurposed as an old application snapshot (the file contains JSX component code, not Jest test cases). The test infrastructure is installed but entirely unused. The project's own documentation (`memory/PROJECT.md`, section 9) explicitly lists "No automated tests" as a HIGH-impact pain point.

**Overall coverage ratio: 0 / 28 source modules tested (0%)**
**Grade: F**

---

## Test File Inventory

### Files matching test patterns (excluding node_modules)

| File | Type | Status |
|------|------|--------|
| `src/App.test.js` | Should be Jest tests | NOT a test file — contains a full React component (old App.js snapshot). Zero `test()`, `it()`, or `describe()` calls. |
| `src/setupTests.js` | Jest setup | Valid setup file — imports `@testing-library/jest-dom`. Infrastructure exists but never triggered. |
| `supabase/test_poll_live_fights.py` | Infrastructure health check | Operational diagnostic script, NOT a unit/integration test. No assertions using a test framework. Uses print-based pass/fail reporting. Requires live Supabase credentials and a live pg_cron job to run. |
| `validate_scoring_model.py` | Model validation script | Statistical analysis tool, NOT a unit test. Queries live production DB and prints agreement rates. No pytest/unittest structure. |

**Conclusion: 0 real test files exist in the project.**

---

## Source File Coverage Map

### React Frontend (`src/`)

| Module | Lines (approx) | Tested? | Notes |
|--------|---------------|---------|-------|
| `src/App.js` | ~2500 | UNTESTED | Main routing, all view logic, voting, live polling, theme |
| `src/dataService.js` | 371 | UNTESTED | All Supabase queries + RPC calls — the most critical data layer |
| `src/guestStorage.js` | 45 | UNTESTED | sessionStorage wrapper — pure functions, easiest to unit test |
| `src/Login.js` | unknown | UNTESTED | Supabase Auth UI wrapper |
| `src/supabaseClient.js` | ~5 | UNTESTED | Client init |
| `src/CombatDNAVisual.js` | ~5748 | UNTESTED | SVG body heatmap |
| `src/components/FightDetailView.js` | 916 | UNTESTED | Fight detail 4-tab, ML inference, live polling, scoring model |
| `src/components/RoundScoringPanel.js` | 500 | UNTESTED | Per-round scoring panel, blind scoring, guest/auth split |
| `src/components/ScorecardComparison.js` | 375 | UNTESTED | User vs judges vs community comparison |
| `src/components/JudgingDNACard.js` | 542 | UNTESTED | Judging profile, tier-gated unlocks |
| `src/components/ScoringInsightsCard.js` | 530 | UNTESTED | Stat fingerprint, pattern breaks, consistency score |
| `src/components/CombatScatterPlot.js` | 208 | UNTESTED | Recharts scatter plot |
| `src/components/JudgeDirectory.js` | 175 | UNTESTED | Judge leaderboard |
| `src/components/JudgeProfileView.js` | 290 | UNTESTED | Individual judge profile |
| `src/components/JudgeComparison.js` | 293 | UNTESTED | Head-to-head judge comparison |
| `src/components/UserJudgeComparison.js` | 307 | UNTESTED | User vs specific judge |
| `src/components/Leaderboard.js` | unknown | UNTESTED | Leaderboard with row expand |

**Frontend coverage: 0 / 17 modules tested**

### Python Scrapers

| Module | Lines (approx) | Tested? | Notes |
|--------|---------------|---------|-------|
| `master file for data update.py` | 679 | UNTESTED | 6-phase scraper pipeline — most complex Python file |
| `scrape_mmadecisions.py` | 320 | UNTESTED | Judge scorecard scraper (threaded) |
| `diagnose_judge_scores.py` | unknown | UNTESTED | Diagnostic utility |
| `diagnose_judge_scores2.py` | unknown | UNTESTED | Diagnostic utility |

**Scraper coverage: 0 / 4 modules tested**

### Supabase Edge Functions (TypeScript)

| Module | Tested? | Notes |
|--------|---------|-------|
| `supabase/functions/poll-live-fights/index.ts` | UNTESTED | Manual invocation check exists in `test_poll_live_fights.py` but that is a health check script, not a unit/integration test. No `matchesFighter()` unit tests, no boutMatchesComp() tests. |
| `supabase/functions/record-fight-status/index.ts` | UNTESTED | No test of any kind |

**Edge Function coverage: 0 / 2 modules tested**

### ML Pipeline (`scoring_model/`)

| Module | Tested? | Notes |
|--------|---------|-------|
| `scoring_model/train_scoring_model.py` | UNTESTED | |
| `scoring_model/build_ml_dataset.py` | UNTESTED | |
| `scoring_model/compare_models.py` | UNTESTED | |
| `scoring_model/eda_report.py` | UNTESTED | |
| `scoring_model/analyze_10_8_thresholds.py` | UNTESTED | |
| `validate_scoring_model.py` | UNTESTED (as a test) | Validation script runs against live DB but has no pytest/unittest structure or assertions |

**ML pipeline coverage: 0 / 6 modules tested**

### Supabase Deploy/Migration Scripts

| Directory | Tested? | Notes |
|-----------|---------|-------|
| `supabase/deploy_*.py` (11 scripts) | UNTESTED | RPC deploy scripts — not typically unit-tested, but SQL logic is completely unvalidated |
| `supabase/migrate_*.py` (2 scripts) | UNTESTED | |
| `supabase/fetch_schema.py` | UNTESTED | |
| `supabase/audit_leaderboard.py` | UNTESTED | |
| `supabase/check_scoring_coverage.py` | UNTESTED | |

---

## Critical Gap Analysis

### HIGH Severity — Critical paths completely untested

**H1: `dataService.js` — Zero test coverage on the entire data layer**
- `castVote()` has no test for unauthenticated user (throws), vote toggle (null → type → null), or Supabase error response
- `getDNAAndChartData()` — no test for empty `fightList`, `fightList` with no matching DNA metrics, partial data (some fights missing DNA), or Supabase error
- `getFightDetail()` — no test for the ±1 day date window logic (the international event edge case documented in CLAUDE.md as a critical convention), missing `fight_url`, or empty round stats
- `getScoredFights()` — no test for the multi-step aggregation logic (round scores → totals → fight join → state join) or any of the 4 error exit paths
- `getRecommendations()` — no test for null `combatDNA` (the `?? 0` fallbacks are untested)
- All 12 exported functions in this file: zero tests

**H2: `guestStorage.js` — Pure functions with zero tests (easiest win in the codebase)**
- `setVote(fightId, null)` should delete the key — untested
- `setScore()` — no test that multiple fights don't overwrite each other
- `getScorecardState()` returns `null` for unknown fightId — untested
- `getSpoilerDefault()` — returns `true` when absent, `false` when set to `'false'` string — untested
- This file is 45 lines of pure functions with no I/O dependencies other than `sessionStorage`. Could be tested with `jest.spyOn(window.sessionStorage, ...)` in 30 minutes.

**H3: `matchesFighter()` / `normName()` in Edge Function — Zero tests for fighter name fuzzy matching**
- Six matching strategies (exact, space-collapse, anagram, prefix, last-name, word-subset) all untested
- This logic runs in production every minute during live events and has documented failure modes ("New name formats occasionally break matchesFighter()")
- CLAUDE.md lists this as a repeated source of data issues
- The same `normName()` logic exists in both `poll-live-fights/index.ts` and duplicated in `FightDetailView.js` — no test for either copy

**H4: `FightDetailView.js` — ML model inference untested**
- `MODEL_COEFFICIENTS` array is hardcoded in the component (19 values)
- The sigmoid / weighted feature calculation logic is completely untested
- 10-8 detection at 0.99 confidence threshold is untested
- No test that null round stats gracefully degrade (returns `null` or 0-0 instead of crashing)
- No test for the `scoring_model.json` feature order matching the hardcoded coefficient array

**H5: `RoundScoringPanel.js` — Blind scoring state machine untested**
- Forfeit flow, guest mode code path (sessionStorage vs Supabase), `scored_blind` flag, spoiler protection toggle — all untested
- The `isLocked` prop behavior (prevents scoring after fight ends) is untested
- Guest-to-auth transition (data in sessionStorage that should not persist) is untested

**H6: Master scraper pipeline (`master file for data update.py`) — No regression tests**
- 6-phase pipeline with no automated validation between phases
- The `clean_bout_name()` function (critical convention #7 in CLAUDE.md) is untested
- `normName()` (convention #8) is untested
- Auto-delete guard logic is untested — a regression here could wipe production data
- Phase ordering guards (e.g., "don't run phase 3 if phase 2 failed") are untested

### MEDIUM Severity — Important paths untested

**M1: Leaderboard eligibility logic**
- `leaderboard_eligible` is a `GENERATED ALWAYS` column in the DB
- The conditions that set it (scoring blind, not forfeiting, completed fight) are never tested in isolation
- Frontend rendering of eligibility badges is untested

**M2: Date window join in `getFightDetail()`**
- The ±1 day date window (`dateMinus1`, `datePlus1`) is documented as a critical fix for international events
- No test validates that a fight on 2025-08-10 (UTC) with judge scores recorded on 2025-08-11 (local date) still returns results

**M3: `validate_scoring_model.py` — Not a real test**
- This file validates model accuracy against live DB data and prints results, but has no assertions
- If model accuracy drops to 60% after retraining, no test would catch it
- No threshold assertion (e.g., `assert overall_pct >= 80.0`)

**M4: `ScorecardComparison.js` — Community scorecard rendering**
- No test that empty community data renders correctly (no crash, shows placeholder)
- No test that `judges` vs `community` tab switching preserves scroll position

**M5: `supabase/test_poll_live_fights.py` — Infrastructure check is not a real test**
- This is a useful operational health check but has no assertion framework
- Not run in CI; must be manually triggered
- No test for the 2-day UTC window guard, the "all fights ended" early-exit, or partial event state

**M6: `JudgingDNACard.js` — Tier-gated unlock logic untested**
- Thresholds: 15, 40, 80 matched rounds unlock successive tiers
- No test for boundary values (14 rounds → locked, 15 rounds → unlocked)
- Gender split toggle behavior untested

### LOW Severity — Edge cases only

**L1: `guestStorage.js` — Boundary: numeric vs string fightId**
- `setVote(123, 'like')` vs `setVote('123', 'like')` — both should work (`String(fightId)` coerces), but never tested

**L2: `CombatScatterPlot.js` — Empty data array**
- Recharts `ScatterChart` with `data=[]` — should render empty state, not crash

**L3: `scrape_mmadecisions.py` — Rate limiting fallback**
- Exponential backoff on 429 responses is untested; a timing change could cause silent data loss

**L4: `App.js` — Year filter edge case**
- If `availableYears` is empty (fresh DB), `setSelectedYear(years[0])` sets `undefined` — no test for empty DB state

**L5: `dataService.js` — `getDNAAndChartData()` fightList with no valid IDs**
- `fightList = [{ id: undefined }]` — would pass the `length > 0` guard but generate an empty `fightIds` Supabase query

---

## Assessment: Assertion Quality

**Not applicable.** There are no test assertions to evaluate.

The `supabase/test_poll_live_fights.py` uses a print-based `result(PASS/FAIL/WARN, msg)` pattern — no `assert` statements. A failed check prints to stdout but does not raise an exception or return a non-zero exit code, meaning it cannot be integrated into CI.

`validate_scoring_model.py` similarly prints statistics with no assertions. If accuracy drops to 50%, the script exits with code 0.

---

## Assessment: Integration vs Unit Test Balance

**Not applicable.** Neither category has any tests.

The closest thing to integration testing is `test_poll_live_fights.py`, which queries live Supabase infrastructure — but it is a manually-run diagnostic, not an automated test.

---

## Assessment: Mock Aggressiveness

**Not applicable.** No mocking infrastructure is in use.

The installed libraries (`@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`) support RTL-style component testing with light mocking. They are installed but never used.

---

## What Does Exist (Mitigations)

These items partially compensate for the zero-test posture but are not substitutes:

| Item | What it provides | What it lacks |
|------|-----------------|---------------|
| `validate_scoring_model.py` | Statistical accuracy validation against live data | No assertion threshold; not run in CI |
| `supabase/test_poll_live_fights.py` | Manual live-event infrastructure health check | Not automated; exits 0 even on FAIL |
| `supabase/audit_leaderboard.py` | Data consistency audit for leaderboard | Not a test; diagnostic only |
| `supabase/check_scoring_coverage.py` | Coverage metrics for scoring data | Not a test; diagnostic only |
| CLAUDE.md critical conventions list | Documents the most dangerous edge cases | No enforcement via tests |
| `memory/LESSONS.md` | Records past bugs and patterns | Not enforced |

---

## Recommended Priority Order for Adding Tests

Based on risk surface and testability, in order of highest return on effort:

1. **`guestStorage.js`** — 45 lines, pure functions, mockable sessionStorage, ~30 min to reach 100% coverage. Zero external dependencies.
2. **`matchesFighter()` / `normName()`** — Extract shared utility, add ~20 unit tests covering the 6 matching strategies. Directly prevents recurring production data issues.
3. **`dataService.js` core methods** — Mock Supabase client with `jest.mock('../supabaseClient')`. Focus on `castVote`, `getDNAAndChartData`, and `getFightDetail` error paths.
4. **ML model inference in `FightDetailView.js`** — Extract the sigmoid scoring function into a testable utility module. Test coefficient application, 10-8 threshold at 0.98 / 0.99 / 1.0, and null-input handling.
5. **`RoundScoringPanel.js` state machine** — Use RTL to test blind scoring → reveal → forfeit sequence and guest vs auth divergence.
6. **`validate_scoring_model.py`** — Add `assert overall_pct >= 80.0` before the script exits; convert to pytest to produce machine-readable output.
7. **Leaderboard eligibility boundary** — Smoke test: score 14 rounds → check ineligible; score 15th → check eligible.

---

## Coverage Ratio

| Layer | Source modules | Tested modules | Coverage |
|-------|---------------|---------------|----------|
| React frontend (src/) | 17 | 0 | 0% |
| Python scrapers | 4 | 0 | 0% |
| Edge Functions (TypeScript) | 2 | 0 | 0% |
| ML pipeline scripts | 6 | 0 | 0% |
| **Total** | **29** | **0** | **0%** |

Line-level coverage: indeterminate, but effectively 0% (no test runner has ever executed against production source code).

---

## Overall Test Health Grade: F

**Rationale:** No production source module has a corresponding test file. The single `*.test.js` file in `src/` contains no test cases. All existing "test" scripts are diagnostic/operational tools that exit 0 on failure. The testing dependencies are installed but unused. The project's own documentation accurately self-diagnoses this as a HIGH-impact risk.

The grade reflects the current state, not the project's overall code quality. The codebase is well-structured and the risk is partially mitigated by the explicit conventions documentation in `CLAUDE.md` and `memory/LESSONS.md`. However, there is no automated safety net for regressions.

**Context note:** This is not unusual for a solo-developer analytics project at this stage. The risk materialises most acutely during the post-event scraper runs (data pipeline regressions are invisible) and during UI refactors (guest/auth code path splits break silently).
