# Round 3 — Architecture Response (Agent D)
**Date:** 2026-04-14
**Mode:** Response to Devil's Advocate challenges

---

## Response to: "PASS on no layer violations is too broad — Edge Function call bypasses dataService.js"

**Status: CONFIRMED FINDING — UPDATED**

DA challenge is correct. The Edge Function call in `App.js:499-511` posts to `record-fight-status`, which writes `fight_started_at`, `fight_ended_at`, `scheduled_rounds`, `rounds_fought`, and `ended_by_decision` to the `fights` table. This is unambiguously a data mutation — not an auth operation. It should be in `dataService.js`.

Updated finding: App.js directly calls the `record-fight-status` Edge Function as a raw `fetch()` call, bypassing the `dataService.js` abstraction layer for a multi-field data write. Severity: **MEDIUM** (consistent with other layer-violation findings).

---

## Response to: "Navigation history — current implementation not audited at all"

**Status: CONFIRMED GAP — ACKNOWLEDGED**

DA correctly notes I counted views but did not trace any specific navigation path to verify the current `onBack` chain is consistent. The risk of broken back-navigation in deep paths (fight list → fight detail → judge comparison → user vs judge) was not verified against the actual `App.js` implementation.

This remains a MEDIUM finding but the evidence base is weaker than stated. The navigation depth issue is structural — the `currentView` string router cannot track history by design — so the severity assessment stands even without tracing every path.

---

## Response to: "Circular dependency PASS was not verified methodically"

**Status: CONFIRMED GAP — CHALLENGE VALID**

DA correctly challenges that "PASS" on circular dependencies was an assertion, not a verified result. No tool was used (e.g., `madge`, `dpdm`, or `eslint-plugin-import`). A visual inspection of 17 import chains is plausible but not documented.

**Updated finding:** Circular dependency status is **UNVERIFIED**, not PASS. Recommend running `npx madge --circular src/` to confirm. Downgraded from PASS to UNKNOWN. Given the project's flat import structure (components import from dataService, not from each other), circular dependencies are unlikely but not confirmed absent.

---

## Response to: "ML model — silent wrong results should be HIGH, not MEDIUM"

**Status: CONFIRMED FINDING — UPGRADED**

DA challenge is valid and the reasoning is sound. The scoring_model.json is at `scoring_model/scoring_model.json`. The fetch path in `FightDetailView.js` is not a runtime browser fetch — the comment on line 10 reads "Feature order and scaler values from scoring_model/scoring_model.json" — the values were hardcoded into the component from the JSON file. This means:

1. **The "silent fetch failure" concern does not apply.** There is no runtime fetch — the JSON values were manually extracted and hardcoded. The DA's challenge about "maybe the component shows a graceful degradation state" is moot — there is no fetch to fail.
2. **The real risk is worse than stated.** The hardcoded scaler means/stds and coefficient values in the component will silently become stale if the model is retrained and `scoring_model.json` updated without updating the component. Since the model is retrained periodically and the JSON is NOT in `public/` (confirmed absent at `public/scoring_model.json`), the update path is entirely manual.
3. **Upgrading severity to HIGH.** The ML scorecard is the app's core feature. Silent drift between the trained model and the hardcoded values would produce wrong scores shown to users with no indication of incorrectness.

---

## Response to: "`scoring_model.json` fetch failure not verified to be silent"

**Status: FINDING RETRACTED (original framing was incorrect)**

As established above: there is no runtime fetch of `scoring_model.json` in `FightDetailView.js`. The scaler values and coefficients are hardcoded from the JSON file during development. The "silent fetch failure" concern was based on an incorrect assumption about how the model is loaded. Retracting this specific finding.

The actual risk (hardcoded values going stale on model retrain) is captured in the upgraded HIGH finding above.

---

## Updated Summary

| Finding | Status | Severity |
|---------|--------|----------|
| CombatDNACard inline in App.js | Unchanged | HIGH |
| Edge Function call bypasses dataService.js | **UPDATED** | MEDIUM |
| `currentView` router — no deep linking | Unchanged | MEDIUM |
| No navigation history stack | Maintained (evidence weaker) | MEDIUM |
| Circular dependencies | **CHANGED to UNKNOWN** | — |
| ML model — hardcoded values go stale silently | **UPGRADED** | **HIGH** |
| ML model fetch failure silent | **RETRACTED** | — |
| Configuration scattered | Unchanged | MEDIUM |

**Architecture Grade: B (maintained)** — the two HIGH findings (CombatDNACard placement, ML model stale risk) are real but remediable. The core dataService/component separation is sound.
