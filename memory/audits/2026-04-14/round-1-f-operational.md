# Operational Readiness Audit — UFC Web App
**Date:** 2026-04-14
**Auditor:** Operational Readiness Agent (Round 1-F, conducted by orchestrator)
**Project root:** `c:\Users\sabzu\Documents\VS Ufc\ufc-web-app`

---

## Error Handling

- **PASS — `dataService.js` error handling is consistent.** All 14 functions follow the pattern: catch Supabase errors with `console.error()` and return a safe default (`null`, `[]`, or `{ user: null, scores: [], scorecardState: null }`). No bare `catch {}` blocks. Functions that must propagate errors (e.g. `castVote()`, `upsertRoundScore()`) explicitly `throw error` so calling components can handle them.
- **MEDIUM — `getLeaderboard()` and `getLeaderboardUserDetail()` throw on error (not return null).** These two functions break the `dataService.js` pattern — they `throw error` instead of returning a safe default. This means any caller must be wrapped in `try/catch`. If `Leaderboard.js` doesn't catch the throw, it will produce an unhandled rejection visible to the user.
- **LOW — Live polling errors are swallowed in App.js.** The `callEdgeFn()` function at App.js:499 has `catch (e) { console.warn(...) }`. This is acceptable for a background polling task — a failed Edge Function call should not crash the UI — but the error is only logged to the browser console. A user scoring on a live fight would see no indication that the fight status update failed.
- **PASS — React component error handling:** Components check for `null`/empty data before rendering (e.g. `if (!dna) return <placeholder>`). No evidence of components crashing on null props.

---

## Logging

- **MEDIUM — No structured production logging.** All logging is via `console.error()` / `console.warn()`. In production (Vercel), these go to the browser console on the client. There is no server-side error aggregation, no alerting, and no Sentry (or equivalent) integration. If a user encounters a data-loading failure, there is no way to know about it without them reporting it.
- **LOW — Python scrapers log to stdout only.** Scraper runs produce console output but no persistent log file. A failed phase on a 90-minute scraper run leaves no audit trail once the terminal is closed.

---

## Environment Configuration

- **HIGH — No `.env.example` file.** The project requires at minimum 5 environment variables (`REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_MANAGEMENT_KEY`, `SUPABASE_ACCESS_TOKEN`). None are documented. A new machine setup or a Vercel environment configuration change relies entirely on memory.
- **LOW — `SUPABASE_ACCESS_TOKEN` (for `npx supabase functions deploy`) is mentioned in CLAUDE.md but not in any `.env.example`.** This is a separate credential from `SUPABASE_MANAGEMENT_KEY` — easy to miss on setup.
- **PASS — No hardcoded environment-specific URLs or IPs in source.** All environment-specific values are read from `process.env.*` or `.env` via `dotenv`.

---

## CI/CD

- **HIGH — No CI/CD pipeline exists.** No `.github/workflows/`, `Jenkinsfile`, or equivalent. There is:
  - No automated test run on push (not that tests exist — see Agent C).
  - No lint check on PR.
  - No type check (TypeScript is only used in Edge Functions).
  - No build verification before merge.
  - **Vercel auto-deploys `main` on push.** This means any commit to `main`, including broken code, deploys to production immediately. There is no staging environment buffer.
- **MEDIUM — No branch protection on `main`.** Per CLAUDE.md, direct pushes to `main` are the normal workflow. With auto-deploy on push, a typo in a component that breaks the React tree deploys silently.

---

## Build Reproducibility

- **PASS — `package-lock.json` is committed.** Node dependencies are fully pinned and reproducible.
- **HIGH — `build/` directory is untracked and not in `.gitignore`.** If accidentally committed, the production build artifacts (containing baked-in REACT_APP_* env vars) are in version history. This should be gitignored. (The values are anon/public keys, but the risk is real and the fix is trivial.)
- **MEDIUM — `nul` file is untracked and not gitignored.** Windows-specific null device artifact. Not a security risk but will cause confusion on non-Windows systems.
- **HIGH — Python environment is not reproducible.** No `requirements.txt`. On a new machine, `pip install requests beautifulsoup4 python-dotenv supabase python-dateutil scikit-learn pandas` may install incompatible versions. The scraper has broken silently on minor `supabase-py` API changes in the past.

---

## Deployment Documentation

- **PASS — Frontend deploy is documented in CLAUDE.md.** "Vercel auto-deploys on push — confirm with user before pushing to main." Clear enough for the single-developer workflow.
- **MEDIUM — Supabase Edge Function deploy process is fragmented.** Deploy requires: (1) Supabase CLI installed, (2) `SUPABASE_ACCESS_TOKEN` in env, (3) `npx supabase functions deploy`. This is documented in `supabase/deploy_poll_live_fights.py` comments but not in a single canonical location.
- **MEDIUM — No runbook for post-event data update.** CLAUDE.md and memory/PROJECT.md describe the process at a high level, but there is no step-by-step checklist with expected outputs, timing, and validation steps. Each post-event run relies on the developer's memory of the phase sequence.

---

## Health Checks

- **LOW — No application-level health check endpoint.** The React SPA has no `/health` or `/status` page. Vercel provides basic uptime monitoring but not app-level health. If the Supabase connection is broken, the app loads but shows empty states — no health signal.
- **LOW — `test_poll_live_fights.py` is a manual health check, not automated.** The pg_cron live polling job has no automated alerting if it stops running. Monitoring requires manually checking Supabase logs or running the test script.

---

## Resilience

- **MEDIUM — Scraper has no recovery from mid-run failure.** If the 90-minute master scraper fails at Phase 4 (of 6), there is no resume capability. The developer must re-run from Phase 1, which may attempt to re-insert data guarded only by `ON CONFLICT DO NOTHING`.
- **LOW — ESPN API downtime during a live event is handled with a warning log only.** `callEdgeFn()` catches Edge Function call failures and logs a warning. If ESPN is unreachable during a fight, `fight_ended_at` may not be written and the live scoring window stays open indefinitely.

---

## Summary

| Category | Finding | Severity |
|----------|---------|----------|
| No `.env.example` | Undocumented required secrets | HIGH |
| No CI/CD pipeline | Broken code auto-deploys to production | HIGH |
| `build/` not in `.gitignore` | Risk of committing build artifacts | HIGH |
| No Python `requirements.txt` | Scraper environment not reproducible | HIGH |
| No production error tracking | Silent failures invisible to developer | MEDIUM |
| `getLeaderboard()` throws (breaks dataService pattern) | Potential unhandled rejection in UI | MEDIUM |
| `nul` artifact not gitignored | Windows noise in repo | MEDIUM |
| No staging environment | Main branch deploys directly to prod | MEDIUM |
| Scraper has no resume from mid-failure | Re-run required from Phase 1 | MEDIUM |
| No application health check | App-level failures silent | LOW |
| Live polling failure is warning-only | Silent fight-status update failures | LOW |

**Overall Operational Readiness Grade: D**

The project runs well under the current single-developer, single-environment setup. However, by conventional production-readiness standards, significant gaps exist: no CI/CD, no environment documentation, no error tracking, no reproducible Python environment, and `build/` exposure risk. The highest-priority items are all quick wins: create `.env.example`, add `build/` and `nul` to `.gitignore`, and create `requirements.txt`. The CI/CD gap is the longest-tail investment but has the highest safety impact.
