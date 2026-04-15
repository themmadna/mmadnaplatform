# Architecture Audit — UFC Web App
**Date:** 2026-04-14
**Auditor:** Architecture Agent (Round 1-D, conducted by orchestrator)
**Project root:** `c:\Users\sabzu\Documents\VS Ufc\ufc-web-app`

---

## Layer Architecture Assessment

### Intended architecture
React components → `dataService.js` singleton → Supabase JS client (`supabaseClient.js`) → Supabase (PostgreSQL + RPCs).

### Verdict: Generally well-respected, with one noted exception.

- **PASS — No components bypass dataService.js for data reads.** All Supabase query calls for application data go through `dataService.js`. Components receive data via props or from calls to `dataService.*`.
- **MEDIUM — `supabase` client imported directly in `App.js` and `FightDetailView.js` for auth and Edge Function calls.** `App.js` imports `{ supabase }` from `supabaseClient.js` directly for: `supabase.auth.onAuthStateChange()`, `supabase.auth.getSession()`, and the Edge Function fetch call at line 505. `FightDetailView.js` imports `{ supabase }` for `supabase.auth.getSession()` (line ~300). These are auth-layer operations, not data queries, so the violation is justified — there's no clean way to abstract Supabase auth into `dataService.js` without making it stateful. However, the fetch call to `record-fight-status` Edge Function should arguably live in `dataService.js`.
- **PASS — Business logic is not embedded in presentational components.** DNA metric calculations happen server-side (view), filtering and aggregation happen in `dataService.js` or RPC functions. Components only derive display-level state (e.g., `isLive = !!startedAt && !endedAt`).

---

## God File Problem: App.js (1,553 lines)

- **HIGH — `CombatDNACard` component is defined inline in `App.js` (lines 18–~200).** This is a ~180-line presentational component that renders the user's 5 DNA metrics with radar chart comparison. It has no reason to live in App.js — it doesn't need routing context and has no side effects. It should be `src/components/CombatDNACard.js`.
- **MEDIUM — `App.js` contains all view routing, auth state management, live polling orchestration, year/search filter state, and fight list fetching.** Separating the live polling logic into a `useLivePoll` custom hook and the fight-list fetching into a `useFightList` hook would reduce App.js to a manageable routing shell.
- **LOW — Multiple `useRef` + `useEffect` combinations in App.js** manage complex stateful interactions (e.g. `eventFightsRef` to expose state to a closure). This is correct React but adds cognitive load.

**Recommended direction:** Extract `CombatDNACard` to `src/components/`. Move live polling to a custom hook. App.js should route, not implement.

---

## Navigation Pattern: `currentView` String Router

- **MEDIUM — The `currentView` string router does not support deep linking, browser back/forward, or bookmarkable URLs.** Every navigation action calls `setCurrentView()`, which is effectively a single-page state machine. There are now 12+ named views. As the number grows, the conditional rendering chain in App.js's return becomes unmaintainable.
- **LOW — No navigation history stack.** "Back" in the UI is implemented as `onBack` prop callbacks that set `currentView` to a known parent. If a user navigates through 3 levels (fight list → fight detail → judge comparison → user vs judge), there is no reliable back stack — each `onBack` hard-codes the destination.

**Recommended direction:** Consider `react-router-dom` for URL-based routing, or at minimum a navigation stack array. Not blocking at current scale, but the next 3–4 views will make this painful.

---

## Single Points of Failure

- **MEDIUM — `dataService.js` is a single point of failure for all data access.** There is no fallback or retry logic at the service layer — if Supabase is unreachable, every function returns `null` or `[]`. This is acceptable if the UI handles these gracefully (which it does — components check for null/empty data before rendering). However, there is no circuit-breaker pattern and no offline mode.
- **MEDIUM — `scoring_model.json` is loaded at app startup via `fetch()` in `FightDetailView.js`.** If the fetch fails (network issue, Vercel serves a stale 404), the ML scoring feature silently disappears with no user feedback. There is no fallback model or cached version.

---

## ML Model Integration Architecture

- **MEDIUM — ML model coefficients are hardcoded as an array in `FightDetailView.js`.** The `scoring_model.json` is fetched and the coefficients/intercept extracted — but if `scoring_model.json` and the hardcoded coefficient array go out of sync (e.g., model retrained with different features), the inference will silently produce wrong results. The feature order is not validated.
- **Recommended direction:** Load features, coefficients, and feature order all from `scoring_model.json`. Do not hardcode the coefficient array separately.

---

## Configuration Management

- **MEDIUM — Configuration is not fully centralized.** Required configuration is spread across:
  - `.env` (Supabase URL + keys)
  - `src/supabaseClient.js` (client init)
  - `supabase/functions/poll-live-fights/index.ts` (ESPN API URL hardcoded inline)
  - `supabase/deploy_*.py` scripts (Supabase Management API URL constructed from project ref)
  - `tailwind.config.js` (Pulse design tokens)
  - No single config registry.
- **LOW — ESPN API URL (`site.api.espn.com`) is hardcoded in `poll-live-fights/index.ts` and in `App.js`.** If ESPN changes its endpoint, two files need updating.

---

## Python Scraper Architecture

- **LOW — The 6-phase scraper `master file for data update.py` is a single-file pipeline.** The phases are sequential and gated, which is correct. However, at 679 lines, adding a new phase requires understanding the entire file. Phase-specific logic should be importable functions, not just labeled sections. This is low priority given the infrequent run cadence (once per event).
- **LOW — No shared scraper utility module.** `normName()` and `clean_bout_name()` are defined in the master scraper but not importable by `scrape_mmadecisions.py`. Each scraper duplicates or re-implements these utilities independently.

---

## Circular Dependencies

**None found.** The dependency graph is acyclic:
- Components → `dataService.js` → `supabaseClient.js`
- `App.js` → all components + `dataService.js` + `supabaseClient.js`
- No component imports another component's internals.

---

## Separation of Concerns: Overall Assessment

The separation of concerns is good for the project's scale. The `dataService.js` / component split is clean and consistently applied. The main architectural debt is that App.js is doing too much (routing + inline component definition + polling) and the navigation model will need to evolve as feature count grows.

---

## Summary

| Finding | Severity | File(s) |
|---------|----------|---------|
| `CombatDNACard` defined inline in App.js | HIGH | `src/App.js:18` |
| `currentView` router doesn't support deep linking | MEDIUM | `src/App.js` |
| Direct `supabase` import in App.js / FightDetailView for auth + Edge Function | MEDIUM | `src/App.js:505`, `FightDetailView.js:300` |
| No navigation history stack | MEDIUM | `src/App.js` |
| `dataService.js` single point of failure — no retry/circuit-breaker | MEDIUM | `src/dataService.js` |
| ML model — coefficients hardcoded separately from `scoring_model.json` | MEDIUM | `src/components/FightDetailView.js` |
| `scoring_model.json` fetch failure is silent | MEDIUM | `src/components/FightDetailView.js` |
| Configuration scattered (ESPN URL, Supabase ref) | MEDIUM | Multiple |
| Single-file 679-line scraper pipeline | LOW | `master file for data update.py` |
| No shared Python utility module | LOW | Scraper files |

**Overall Architecture Grade: B**

The architecture is intentional and well-executed for a solo-developer product. The dataService.js pattern cleanly separates data access from presentation. The main architectural weaknesses — the App.js god-file pattern, the string router's limitations, and the ML model integration — are typical of a project that grew organically. None are showstoppers at current scale, but the `currentView` router will become the binding constraint on further feature development.
