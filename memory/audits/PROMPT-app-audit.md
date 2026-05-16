# App Audit — Reusable Prompt

Paste the block below at the start of a fresh session to run a comprehensive
audit of the UFC web app frontend. Read-only — produces a written report, no
code changes applied.

Re-run any time after a major feature ships or before a release. Output goes to
`memory/audits/<date>-app/` so prior audits stay intact.

---

```
Run a comprehensive audit of the UFC web app frontend. Read-only investigation —
do NOT refactor code, change components, or run deploys. Output is a written
report; fixes come after I review.

## Scope context
React (CRA) + Tailwind on Vercel. Mobile-first (90% of users on mobile/tablet).
Pulse design system as of Phase 8. Supabase JS client + sessionStorage-based
guest mode. ~14 components in `src/components/`.

## Prior context — read first
- `CLAUDE.md` — project conventions, file map
- `memory/PROGRESS.md` — what's shipped, deferred, and explicitly "complete";
  audit findings should flag drift between PROGRESS claims and actual code state
- `context/phase6-architecture.md` — RoundScoringPanel, ScorecardComparison, DNA
- `context/combat-dna.md` — DNA viz expectations
- `context/ml-model.md` — model integration
- `context/live-events.md` — live polling + scoring render
- `memory/LESSONS.md` — past bugs (don't reopen solved problems)

## Scope — cover all of these

1. **Functional bugs — read the code, trace each flow**
   - Trace every user journey end-to-end in `src/App.js` view state machine:
     event list → fight detail → score round → reveal → DNA → leaderboard →
     judge comparison. Flag any dead branch, unreachable state, missing
     loading state, missing empty state, missing error state.
   - Guest mode parity: every flow that works for an auth user must degrade
     gracefully for guests (see `guestStorage.js`). Flag flows that read/write
     Supabase without checking auth state.
   - Spoiler protection: per-user default + per-fight toggle + auto-reveal on
     completed scores — verify each path in FightDetailView.
   - Live event UI: confirm the polling render path matches
     `context/live-events.md`; check what happens when ESPN returns
     unexpected status codes.
   - The 9 CLAUDE.md conventions — each one has a frontend implication too
     (e.g. #4 ordering by `fights.id`, #6 reading from `fight_dna_metrics`
     view not raw stats). Find frontend code that violates them.

2. **Data fetching — `src/dataService.js`**
   - Every exported function: error handling present? Returns safe defaults
     on error (recall April audit #18) or throws? Consistent?
   - Any waterfall fetches that should run in parallel?
   - Any data loaded that the UI never reads?
   - RPC call sites vs `context/rpc-functions.md` signatures — flag drift in
     either direction.
   - sessionStorage / localStorage usage — anything that could be stale,
     anything that could leak across users on shared devices.

3. **Component health**
   - Dead components: anything in `src/components/` that no other file
     imports (recall #10 — `CombatScatterPlot.js` was previously deleted; is
     anything else dead now?).
   - Duplicate logic: `normName()`, score-bucket helpers, color tokens —
     defined in multiple places without the cross-reference comment (#11)?
   - Components doing data fetching that should be in `dataService.js`.
   - `console.log` / `console.warn` / `debugger` left behind.
   - `TODO` / `FIXME` / `XXX` comments — list them, severity-tag them.

4. **Performance**
   - Bundle size: run `npm run build` and report total + per-chunk sizes.
     Flag anything > 500KB pre-gzip.
   - Unused dependencies in `package.json` (run `npx depcheck` if available,
     or scan imports manually).
   - Large unmemoized lists / charts re-rendering on every parent update.
   - Image / SVG asset sizes in `public/`.
   - `useEffect` dependency arrays — missing deps, deps that re-run too often.

5. **UI / UX consistency (Pulse design system)**
   - Pulse tokens used consistently — no stray hardcoded `#FFD700` / gold /
     Oswald references left from the pre-Phase-8 theme.
   - Touch targets ≥ 44px on mobile-facing controls.
   - Loading states: every async fetch has either a skeleton or a spinner
     (Phase 8f.1 claims full coverage — verify).
   - Empty states: every list view (events, fights, scored fights,
     leaderboard, judge directory) has a designed empty state.
   - Error states: what does the user see when a fetch fails?

6. **Accessibility (Phase 8f.4 claims complete — verify)**
   - ARIA labels on icon-only buttons.
   - Focus visible on keyboard nav.
   - Color contrast on Pulse tokens (red/blue on charcoal).
   - Modals trap focus and restore on close.
   - Form inputs have associated labels.

7. **Auth & security surface**
   - Anywhere the service key could end up in the client bundle (it shouldn't —
     verify by grepping the build output).
   - Anywhere a `.env` value with no `REACT_APP_` prefix is imported in `src/`
     (would be undefined at runtime — silent bug).
   - Profile creation / display_name flow — what happens when a new user
     signs up? Race conditions?
   - Sign-out — does it clear sessionStorage guest data too, or leak it into
     the next session on a shared device?

8. **Build & dependency hygiene**
   - `npm audit` — list high/critical CVEs.
   - `package.json` vs actual imports — devDeps in deps and vice versa
     (recall April audit #15).
   - Outdated major versions of React, Supabase JS, Recharts.
   - `npm run build` warnings — ESLint, react-hooks/exhaustive-deps, etc.

9. **Test coverage**
   - `src/guestStorage.test.js` exists (21 tests). What else has tests?
   - What untested area has the highest blast radius if it breaks?
   - Recommend the next 1-2 test files worth writing (don't write them).

10. **Playwright recommendation**
    - Based on what sections 1-9 turned up, is a Playwright smoke script worth
      writing? Frame the answer in terms of *what static analysis couldn't
      verify* — runtime crashes, expired-token 401s, RPC drift at the wire,
      Pulse actually rendering on mobile viewports, etc.
    - If yes: name the top 3 user flows the smoke script should cover, in
      priority order. Each flow = a one-line description plus the specific
      assertions that would catch the highest-blast-radius bugs (e.g. "no
      console errors", "fight_dna_metrics view returns non-null rows",
      "scorecard reveal renders all 3 judge columns").
    - If no: say why — e.g. surface is too small, static audit caught
      everything, data instability would make assertions flaky.
    - Do NOT write the Playwright script. This step is a recommendation only.
    - Note infrastructure cost honestly: guest-mode flows are cheap to test
      (no auth fixture); auth-mode flows need either a test user account or
      Supabase storageState setup.

## Deliverable
Write findings to `memory/audits/<today's date>-app/` (create the directory).
Structure:
- `00-summary.md` — executive summary, P0/P1/P2 counts, top 5 risks
- `01-functional-bugs.md`
- `02-data-fetching.md`
- `03-components.md`
- `04-performance.md`
- `05-ui-ux.md`
- `06-accessibility.md`
- `07-auth-security.md`
- `08-build-deps.md`
- `09-tests.md`
- `10-playwright.md` — yes/no + 3 flows if yes, with assertions
- `99-followups.md` — backlog with proposed fixes, no auto-applied changes

Severity:
- P0 — broken user flow, data loss risk, auth bypass, exposed secret
- P1 — wrong-data risk, silent failure, accessibility blocker, perf > 2s
- P2 — tech debt, polish, minor a11y, dead code

Keep prose tight. Every finding cites a file path with line number and a
reproduction step (or query). Don't pad with restated context.

For UI / rendering / accessibility claims — if you can't actually load the
page in a browser, say so explicitly per finding. Don't claim something
"looks fine" from static code alone.
```
