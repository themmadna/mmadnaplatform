# Code Health Audit — UFC Web App
**Date:** 2026-04-14
**Auditor:** Code Health Agent (Round 1-A, conducted by orchestrator)
**Project root:** `c:\Users\sabzu\Documents\VS Ufc\ufc-web-app`

---

## TODO / FIXME / HACK / XXX Comments

**Count: 0**

Grep across all `src/**/*.js` and Python files returned no matches. The codebase is entirely free of these comment markers. This is a positive signal — no deferred debt is flagged in code.

---

## Oversized Files (>500 lines)

| File | Actual Lines | Assessment |
|------|-------------|------------|
| `src/App.js` | 1,553 | HIGH — contains both routing logic and inline sub-component definitions (e.g. `CombatDNACard` defined at line ~18, inside App.js) |
| `src/components/FightDetailView.js` | 916 | MEDIUM — large but scoped to a single feature (fight detail page with 4 tabs) |
| `src/components/RoundScoringPanel.js` | 605 | MEDIUM — acceptable for a complex stateful UI panel with guest/auth split |
| `src/components/JudgingDNACard.js` | 542 | LOW — large but all in-scope for judging DNA profile card |
| `src/components/ScoringInsightsCard.js` | 530 | LOW — acceptable for a multi-section insights card |

**Note:** `src/CombatDNAVisual.js` is 139 lines, not ~5,748 as documented in `memory/PROJECT.md`. The project memory is stale on this point.

---

## Deeply Nested Conditionals (>4 levels)

- **MEDIUM — `src/App.js`:** Multiple ternary chains in JSX rendering (view routing via `currentView` string produces deeply nested conditional blocks, e.g. `currentView === 'x' ? <A> : currentView === 'y' ? <B> : ...`). Not traditional `if/else` nesting but cognitive complexity is similar.
- **LOW — `src/components/FightDetailView.js`:** Live polling logic in `useEffect` at lines ~290–350 contains 3–4 levels of async condition nesting (ESPN status → fight state → round tracking). Within acceptable bounds.

---

## Dead Code

- **LOW — `src/App.js`:** `currentTheme` variable is constructed (Pulse token object) and passed as a prop throughout, but based on the Pulse redesign all styling is via Tailwind classes directly. The `currentTheme` pattern may be vestigial from an earlier multi-theme architecture. Not confirmed unused without tracing every prop receiver.
- **LOW — `src/components/CombatScatterPlot.js`:** Per `memory/PROGRESS.md`, the CombatScatterPlot was "removed from Combat DNA page" in 8e but the component file remains. If it is no longer rendered anywhere, this is dead code. Requires import-trace verification.
- **LOW — `src/App.js` "App.js copys/" directory:** Historical snapshot files in `src/App.js copys/` and `src/dataService.JS copys/` are explicitly flagged in CLAUDE.md as "ignore." These are not referenced by the build but add noise to the repository.

---

## Naming Conventions

- **LOW — Mixed case in Python files:** Python scraper files use `snake_case` for variables (correct), but deploy scripts inconsistently abbreviate (`mgmt_key`, `supabase_url`) vs. spell out (`project_ref`). Minor.
- **LOW — `dataService.js`:** The export is `dataService` (camelCase object). All callers use `dataService.methodName()`. Consistent, but the singleton-object pattern means methods aren't individually importable — a minor ergonomics issue.
- **LOW — `fight_meta_details.bout` vs `fights.bout`:** Column naming is consistent (snake_case) but the semantic reversal (documented in CLAUDE.md) is a domain-level naming hazard, not a code convention issue.

---

## Magic Numbers / Hardcoded Values

- **MEDIUM — `src/App.js` intensity thresholds:** `if (score > 12)` → "MAULER", `if (score > 7)` → "ACTIVE GRAPPLER" (lines ~41–43). These domain thresholds should be named constants.
- **MEDIUM — `src/components/JudgingDNACard.js` tier thresholds:** The 15 / 40 / 80 round unlock thresholds for Judging DNA tiers appear as inline numbers. Changing a tier threshold requires finding every occurrence.
- **MEDIUM — `src/components/FightDetailView.js` ML threshold:** `>= 0.99` confidence for 10-8 detection is hardcoded inline. Documented in CLAUDE.md but not a named constant in code.
- **LOW — Various:** `limit(10)` in `getCommunityFavorites()` (dataService.js:325), `length > 3` in `matchesFighter()` last-name check, `86400000` (ms in a day) used directly in date arithmetic at multiple locations.

---

## Code Duplication

- **HIGH — `normName()` + `matchesFighter()` duplicated across boundary:** These functions exist in both `supabase/functions/poll-live-fights/index.ts` (TypeScript) and `src/components/FightDetailView.js` (JavaScript). A bug fix in one does not propagate to the other. The `boutMatchesComp()` wrapper only exists in the Edge Function. No shared utility layer is possible given the Deno/browser boundary, but the duplication should be explicitly documented — a future divergence in matching logic would silently produce different results server-side vs. client-side.
- **LOW — Date arithmetic:** `new Date(d.getTime() - 86400000)` pattern appears in both `dataService.js:126` (±1 day for judge scores) and `supabase/functions/poll-live-fights/index.ts` (yesterday window). Consistent but not centralized.

---

## Summary

| Category | Count | Severity Distribution |
|----------|-------|-----------------------|
| Oversized files | 5 | 1 HIGH, 2 MEDIUM, 2 LOW |
| Nested complexity | 2 | 0 HIGH, 1 MEDIUM, 1 LOW |
| Dead code | 3 | 0 HIGH, 0 MEDIUM, 3 LOW |
| Naming inconsistency | 3 | 0 HIGH, 0 MEDIUM, 3 LOW |
| Magic numbers | 4 | 0 HIGH, 3 MEDIUM, 1 LOW |
| Duplication | 2 | 1 HIGH, 0 MEDIUM, 1 LOW |
| **Total findings** | **19** | **1 HIGH · 6 MEDIUM · 12 LOW** |

**Overall Code Health Grade: B**

The codebase is clean and intentional. No TODO debt, no hardcoded secrets in source, consistent error-logging discipline in dataService.js, and no circular dependencies. The main risks are: App.js acting as both a router and a component factory (1,553 lines with inline definitions), the normName/matchesFighter duplication across the Deno/browser boundary, and domain thresholds scattered as magic numbers. None of these are acute — they are the expected shape of a solo-developer product at this maturity level.
