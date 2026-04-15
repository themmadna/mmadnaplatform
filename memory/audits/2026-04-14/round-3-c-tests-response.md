# Round 3 — Test Coverage Response (Agent C)
**Date:** 2026-04-14
**Mode:** Response to Devil's Advocate challenges

---

## Response to: "App.js and CombatDNAVisual.js line counts are wrong — copied from stale docs"

**Status: CONFIRMED GAP — CORRECTED**

DA challenge is valid. The coverage table listed `src/App.js` as "~2500" lines and `src/CombatDNAVisual.js` as "~5748" lines. Both figures were copied from `memory/PROJECT.md` rather than measured directly.

**Corrected measurements:**
- `src/App.js`: 1,553 lines (not ~2,500)
- `src/CombatDNAVisual.js`: 139 lines (not ~5,748)

The zero-coverage conclusion is unaffected — both files are still completely untested. However, the credibility gap is acknowledged: file sizes cited without direct measurement are unreliable. The coverage inventory's severities and priorities were not materially affected by this error (both files remain HIGH priority to test), but the reporting discipline is a gap.

**Corrected coverage table row:**
| Module | Lines | Tested? |
|--------|-------|---------|
| `src/App.js` | 1,553 | UNTESTED |
| `src/CombatDNAVisual.js` | 139 | UNTESTED |

---

## Response to: "`supabase/deploy_scoring_insights.py` unexamined"

**Status: CONFIRMED GAP — ASSESSED**

DA correctly notes this untracked file was not listed. The file has now been partially read. It is a standard RPC deploy script following the same boilerplate as all other `deploy_*.py` scripts — it deploys `get_scoring_insights()` using SECURITY DEFINER + `auth.uid()`. The function SQL includes `v_user_id uuid := auth.uid()` as its first line, scoping all results to the calling user.

The file's status as untracked (not yet committed) does not change the test coverage assessment. The `get_scoring_insights()` RPC has the same zero-test coverage as all other RPCs. The SQL logic in this file — tier gating at 15/40/80 matched rounds, fingerprint calculation, pattern break detection — is complex and untested.

**Added to coverage map:** `supabase/deploy_scoring_insights.py` (SQL-level) — UNTESTED.

---

## Response to: "`guestStorage.js` testability — jsdom availability not confirmed"

**Status: CHALLENGE NOT VALID**

CRA's `react-scripts test` uses jsdom as the default test environment (configured in CRA's internal Jest config). `sessionStorage` is provided by jsdom by default without any additional configuration. The "30-minute win" assessment stands. The concern about jsdom availability is a non-issue for a CRA project.

---

## Response to: "H4 ML inference — null handling is more subtle than 'null causes crash'"

**Status: CONFIRMED FINDING — UPDATED**

DA challenge is partially valid. The null guard `if (!f1Stats && !f2Stats) return { f1Score: 10, f2Score: 10, winner: 'draw', confidence: null }` handles the both-null case. The helper function `g(s, k)` returns `0` when `s` is null, which means:

- If one fighter's stats are null and the other's are available, the null side gets 0 for all features
- This is not a crash — it is a silently biased result (the fighter with stats always "wins" the ML scoring)
- The test gap is more subtle: the test should verify that a one-null input produces a meaningful warning or explicit degradation, not just a biased score

H4 is **maintained** as HIGH — the absence of tests for this case means this silent bias is undetected in production. The framing is updated from "may crash" to "produces silently biased output."

---

## Response to: "CRA/Jest constraints limit some modern testing patterns — should be noted"

**Status: CONFIRMED GAP — ADDRESSED**

DA correctly notes that `react-scripts` 5.0.1 uses Jest 27 internally with restricted configuration. Specific constraints:
- No native ES module imports from `node_modules` without transform config (CRA blocks `jest.config.js` customization)
- ES module mocking (`jest.mock()` with ESM packages) is fragile in CRA's Jest setup
- No `jest.config.js` override without ejecting

This does NOT affect the priority order recommendations — `guestStorage.js`, `dataService.js` core methods, and `validate_scoring_model.py` can all be tested within CRA's Jest constraints. The ML model inference extraction and RTL component tests also work within CRA's setup.

The CRA constraint IS a dependency: if the project migrates to Vite (recommended by Agent E), Jest 29+ becomes available, enabling better ESM mocking for `supabase-py` mock testing.

---

## Updated Assessment

The zero-coverage grade (**F**) is confirmed with corrected line counts. All priority recommendations stand. No substantive changes to severity ratings. Key addendum: file size figures in the coverage inventory should not be trusted for decision-making; they were copied from stale documentation.

**No change to grade: F**
