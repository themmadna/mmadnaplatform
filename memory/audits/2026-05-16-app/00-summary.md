# App Audit — Executive Summary

**Date:** 2026-05-16
**Scope:** UFC web app frontend (React/CRA on Vercel)
**Mode:** Read-only — no code changes applied
**Companion audit:** `memory/audits/2026-05-16/` (Supabase backend, separate session)

---

## Verdict

**Healthy core, with two real surprises.**

The Phase 6/8/9 architecture is largely intact: the scoring panel, scorecard comparison, judging DNA, and live polling flows match `context/phase6-architecture.md` and the LESSONS-recorded fixes are in place. Build is clean (no ESLint warnings, 255 KB gzipped). The 9 CLAUDE.md conventions are honored everywhere I checked.

But two PROGRESS.md claims overstate reality:

1. **Phase 8 (Pulse redesign) is partially regressed.** `JudgeProfileView`, `JudgeComparison`, `JudgeDirectory`, `UserJudgeComparison`, and `Login.js` still ship the pre-Phase-8 gold/`#D4AF37` token, plus several pre-Phase-8 patterns (text-only "Loading..." instead of skeletons, blue/amber bars instead of red/blue, plain `<table>` without mobile cards in some places). These are user-visible inconsistencies, not cosmetic drift.
2. **Phase 8f.4 a11y claims focus management.** Modals (`RoundScoringPanel` forfeit + edit-after-reveal) **do not trap focus, do not handle Escape, and do not restore focus on close.** This is the most user-blocking a11y gap.

A third surprise is operational: a verbose `console.log` debug block in `FightDetailView.js:404-409` runs on every fight detail load in production, dumping fighter names and `normName()` output to devtools.

---

## P0 / P1 / P2 Counts

| Severity | Count | Definition |
|---|---|---|
| P0 | **0** | Broken user flow, data loss, auth bypass, exposed secret |
| P1 | **8** | Wrong-data risk, silent failure, a11y blocker, perf > 2s |
| P2 | **15** | Tech debt, polish, minor a11y, dead code |

No P0 findings.

---

## Top 5 Risks (Ordered)

1. **Pulse design regression across Judges/Login surface** — five components still use pre-Phase-8 gold/dark theme. Direct contradiction of PROGRESS.md Phase 8 ✅ status. (P1, `05-ui-ux.md §1`)
2. **Modals don't trap focus or handle Escape** — RoundScoringPanel forfeit modal + edit-after-reveal modal lock keyboard users out of the rest of the page until they tab through manually. (P1, `06-accessibility.md §1`)
3. **Verbose debug `console.log` in FightDetailView fires on every fight load** — fighter names + normalized strings logged to console on every page open. (P2 noise, P1 if anything is being injected into those names.) (`03-components.md §3`)
4. **`src/App.test.js` is not a test — it's a stale App snapshot** that Jest picks up under the `.test.js` glob. If anyone runs `npm test` with the right pattern it'll either crash or run nothing meaningful — and it represents an additional 200+ lines of dead code. (P1, `09-tests.md §2`)
5. **Sign-out leaks guest sessionStorage into next session on shared devices** — `handleSignOut` clears auth but not `ufc_guest_*` keys; the next visitor on the same tab inherits prior votes/scores if they pick "Continue as Guest". (P1, `07-auth-security.md §3`)

---

## What's Solid

- **9 CLAUDE.md conventions** — all checked, all honored on the frontend.
- **Build hygiene** — clean compile, no ESLint warnings, no source code violations of `REACT_APP_` prefix rule.
- **Anon-key-only client** — service role key is nowhere in `src/` or the compiled bundle. Verified via grep against `build/static/js/main.*.js`.
- **`guestStorage` test coverage** — 21 tests, all 8 exports covered (per LESSONS).
- **Auto-reveal scorecard flow** — recent fix (`3f3cae0`) is wired in `RoundScoringPanel.js:101-107`.
- **dataService error handling** — every exported function returns a safe default on error; no thrown errors leak to the UI.

---

## What I Couldn't Verify Without a Browser

- Per-finding marked in `05-ui-ux.md` and `06-accessibility.md`. Color contrast claims, modal focus restoration, animation timing, and mobile viewport rendering are all static-analysis only.
- ESPN polling behaviour during an actual live event (only the code path was traced).
- RPC drift at the wire — `02-data-fetching.md §3` lists the static check; live verification would need the Supabase project.

---

## Deliverable Map

| File | Contents |
|---|---|
| `01-functional-bugs.md` | View state machine, guest parity, spoiler protection, live polling edge cases |
| `02-data-fetching.md` | `dataService.js` per-function review, RPC drift check, waterfalls |
| `03-components.md` | Dead code, duplication, console logs, TODOs |
| `04-performance.md` | Bundle size, dep count, memoization, re-render hotspots |
| `05-ui-ux.md` | Pulse token consistency, loading/empty/error states, touch targets |
| `06-accessibility.md` | Modal focus, ARIA, keyboard nav, contrast |
| `07-auth-security.md` | Anon-key surface, guest leakage, profile race, sign-out |
| `08-build-deps.md` | `npm audit`, dep hygiene, build warnings |
| `09-tests.md` | Current coverage, top blast-radius gaps |
| `10-playwright.md` | Recommendation + 3 flows if yes |
| `99-followups.md` | Full backlog with proposed fixes — no code changes applied |
