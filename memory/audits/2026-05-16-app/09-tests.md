# 09 — Test Coverage

## §1. What's currently tested

- `src/guestStorage.test.js` — 21 tests across all 8 exports (per LESSONS, "21/21 passing"). Covers:
  - `isGuest` / `setGuest`
  - `getVotes` / `setVote`
  - `getFightScores` / `setScore`
  - `getScorecardState` / `setScorecardState`
  - `getSpoilerDefault` / `setSpoilerDefault`
- CRA's Jest + jsdom; sessionStorage works without mocks (per LESSONS Testing).

That's the entire test suite.

## §2. `src/App.test.js` is NOT a real test (P1)

Already flagged in `03-components.md §C6.1`. File contents are a 200+ line stale copy of the App component with a header comment that reads like a manual QA list ("// working theme", "// working year selection", etc.). No `describe`/`it`/`expect`. Jest picks it up via the `.test.js` glob.

**Recommended action:** rename to something outside the test glob (e.g. `App.snapshot.old.js`) and move outside `src/`, or delete entirely. The "QA list" comment header could be salvaged into a Playwright smoke spec (see `10-playwright.md`).

## §3. Highest-blast-radius untested areas

In rough order of impact-if-broken:

### T3.1 — ML scoring model integration (`FightDetailView.scoreRound`)

A bug in `scoreRound()` silently mis-scores every round for every user. Tests would:
- Feed a known stat vector with known coefficients, assert winner + confidence.
- Verify 10-8 threshold edge case (confidence 0.989 vs 0.991 vs 0.999).
- Verify ratio feature math (`a / (a + b + 1)`).
- Verify `post_2016` toggle.

The model file is at `public/scoring_model.json` — load it once and feed canned inputs. Pure-function tests, no DOM, fast.

### T3.2 — `normName` / `matchesFighter` fuzzy matching

LESSONS records multiple bugs in name normalization (Polish ł, NFD decomposition, Chinese name reorder, last-name-only fallback length 3). Each fix should have a regression test.

- `matchesFighter("Ruchała", "Ruchala")` → true
- `matchesFighter("Joshua Van", "Josh Van")` → true (first-name prefix)
- `matchesFighter("Zha Yi", "Yizha")` → true (Chinese reorder)
- `matchesFighter("Patricio Pitbull", "Patricio Freire")` → false (alias dict not in frontend)

### T3.3 — `buildRoundData()` join logic

`FightDetailView.js:155-185`. Given known meta + roundStats + judgeScores, assert the produced `rounds[]` array has correct judges, model, and stats per round. Catches regressions in the (cross-product judge × round × fighter) shape.

### T3.4 — `getInitials`, `lastName`, name-split utilities

Trivial but high-traffic. Test for edge cases: single name, hyphenated last name, Jr./Sr. suffix, name with diacritics.

### T3.5 — `roundMajority` / `getMajorityInfo` (ScorecardComparison)

`ScorecardComparison.js:7-28`. Verifies majority-winner logic when judges split 2-1, 3-0, 1-1-1. Pure function, easy to test.

## §4. Next 1-2 test files to write (recommended)

In priority order:

### T4.1 — `src/components/FightDetailView.scoreRound.test.js`

Highest value because the model output is user-facing and silent failures are likely. Mock the model JSON, run 10-15 known cases.

### T4.2 — `src/components/FightDetailView.matchesFighter.test.js`

Second-highest. The fuzzy matcher has accumulated specific fixes for diacritics, Chinese names, suffixes. Each documented LESSON should pin a test. Pure-function, no React.

Skip integration / RTL tests for components until those two are in. The component surface area is huge (`App.js` is 1475 lines) and the value-per-test is much lower than locking down the two pure-function hotspots.

## §5. Test setup hygiene

- `src/setupTests.js` — exists. (Did not read.)
- `package.json` script: `"test": "react-scripts test"` — runs in watch mode by default, CI needs `npm test -- --watchAll=false`.

### T5.1 — No CI test step (informational)

No GitHub Actions test workflow was visible. The pre-push hook (per April audit) runs `npm run build` but not `npm test`. Worth adding `npm test -- --watchAll=false --passWithNoTests` to either the pre-push hook or a GHA workflow.
