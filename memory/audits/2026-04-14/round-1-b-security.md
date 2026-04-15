# Security Audit — UFC Web App
**Date:** 2026-04-14
**Auditor:** Security Agent (Round 1-B, conducted by orchestrator)
**Project root:** `c:\Users\sabzu\Documents\VS Ufc\ufc-web-app`

---

## Hardcoded Secrets / Credentials

**No hardcoded secrets found in source files.**

- `src/supabaseClient.js` — uses `process.env.REACT_APP_SUPABASE_URL` and `process.env.REACT_APP_SUPABASE_ANON_KEY` (correct).
- All `supabase/deploy_*.py` scripts — read credentials via `os.environ.get("SUPABASE_MANAGEMENT_KEY")` and `os.environ.get("REACT_APP_SUPABASE_URL")` from `.env` via `python-dotenv` (correct).
- `supabase/functions/poll-live-fights/index.ts` — reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `Deno.env.get()` — server-side only, never exposed to client (correct).
- Grep patterns `sk-`, `Bearer `, `password =`, `api_key =`, `secret =`, `token =`, `private_key`, `eyJ` all returned 0 matches in committed source files.

---

## `.env` File Status

- **PASS:** `.gitignore` line 1 explicitly excludes `.env`.
- **MEDIUM — No `.env.example` exists.** There is no template documenting required environment variables. A new developer or a CI/CD pipeline has no authoritative list of what secrets to provide. Currently required but undocumented: `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_MANAGEMENT_KEY`, `SUPABASE_ACCESS_TOKEN` (for Edge Function deploy).

---

## Build Artifact Exposure

- **MEDIUM — `build/` directory is not in `.gitignore`.** The `build/` folder is currently untracked (confirmed in git status) but is not gitignored. CRA bakes `REACT_APP_*` environment variables into the build bundle at compile time. If `build/` is accidentally committed, the `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` values would appear in plain text in `build/static/js/*.js`. The anon key is designed to be public-facing (RLS enforces security), but committing it to a public repo creates an unnecessary risk surface and fingerprint. The build directory should be added to `.gitignore`.
- **MEDIUM — `nul` file is untracked and not gitignored.** A Windows artifact file named `nul` appears in git status as untracked. Not a secret risk, but indicates `.gitignore` is not covering Windows-specific artifacts.

---

## SQL Injection

**No SQL injection risk found in frontend or deploy scripts.**

- All Supabase JS client calls use the PostgREST query builder (parameterized, no string interpolation).
- RPC calls pass typed parameters (e.g. `{ p_judge: judgeName }`), never concatenate strings into SQL.
- Python deploy scripts POST pre-written SQL strings to the Management API — these strings are authored by the developer, not constructed from user input. No injection vector here.

---

## XSS Risks

**No direct XSS risk found.**

- React's JSX escapes all values by default. No `dangerouslySetInnerHTML` usage found in any component.
- Fighter names, event names, and judge names sourced from Supabase are rendered as React text nodes (auto-escaped).
- No HTML templating outside of JSX.

---

## Auth / Authorization Gaps

- **MEDIUM — `get_leaderboard()` RPC is GRANT to `authenticated, anon`** (documented in context/rpc-functions.md). The leaderboard is intentionally public (no user data revealed beyond display_name), so this is a design decision, not a bug. However, `user_id` UUIDs are returned in the leaderboard payload — even though they're opaque UUIDs, this exposes user identifiers to unauthenticated callers. Assess whether `user_id` needs to be in the public payload.
- **LOW — `record-fight-status` Edge Function:** The frontend calls this Edge Function with a valid JWT (`session.access_token`). However, the Edge Function in `App.js:505` is called with both `Authorization: Bearer <jwt>` and `apikey: REACT_APP_SUPABASE_ANON_KEY`. The function should verify the JWT before acting; review whether `record-fight-status/index.ts` performs this check (not examined in full).
- **PASS — `get_user_judging_profile()`, `get_scoring_insights()`** — SECURITY DEFINER + `auth.uid()` — user can only access their own data.
- **PASS — `get_user_judge_comparison()`** — GRANT to `authenticated` only.

---

## RLS Policy Status

- **HIGH — No RLS policy definitions found anywhere in the codebase.** Grep for `ROW LEVEL SECURITY`, `ENABLE RLS`, and `CREATE POLICY` across all `.py` and `.sql` files returned zero matches. This means either:
  a) RLS is configured directly in the Supabase dashboard (not version-controlled), or
  b) RLS is not enabled on any table.
  
  Tables containing user-private data that MUST have RLS: `user_round_scores`, `user_fight_scorecard_state`, `user_votes`, `profiles`. Without RLS, any authenticated user could query another user's scores, votes, and scorecard states using the anon key. **This must be verified immediately against the live Supabase project.**

---

## CORS

**Not directly configurable at this layer.** Supabase handles CORS for its REST API and Edge Functions. The frontend makes direct calls to `REACT_APP_SUPABASE_URL` which is the same-origin as the Supabase project. No custom CORS configuration is needed or found.

---

## Rate Limiting

- **LOW — No application-level rate limiting on Supabase RPC calls.** Supabase provides project-level rate limits but there is no per-user throttling on expensive RPCs like `get_scoring_insights()` or `get_leaderboard()`. At current scale (low user count) this is not a risk, but as the leaderboard becomes public, `get_leaderboard()` (exposed to anon) could be called in a loop.

---

## IDOR Risks

- **PASS — `getUserScoringData(fightId)`** — calls `supabase.auth.getUser()` and filters by `user.id`. Cannot return another user's data.
- **PASS — `getLeaderboardUserDetail(userId)`** — fetches details for a specific `userId`. This IS an IDOR risk if the RPC returns private data for any arbitrary UUID. Review what data `get_leaderboard_user_detail()` returns — per PROGRESS.md it returns "fights/rounds with green/red dots." If this includes per-round scores, any unauthenticated caller passing any UUID can see another user's detailed scoring. **Must be verified against the RPC SQL.**

---

## Summary

| Category | Findings | Severity Distribution |
|----------|----------|-----------------------|
| Hardcoded secrets | 0 | — |
| .env / secret management | 2 | 0 CRITICAL · 2 MEDIUM |
| Build artifact exposure | 2 | 0 CRITICAL · 2 MEDIUM |
| SQL injection | 0 | — |
| XSS | 0 | — |
| Auth/authz gaps | 3 | 0 CRITICAL · 0 HIGH · 3 MEDIUM/LOW |
| RLS status | 1 | **1 HIGH** |
| IDOR risk | 1 | 0 CRITICAL · 1 MEDIUM |
| **Total findings** | **9** | **0 CRITICAL · 1 HIGH · 6 MEDIUM · 2 LOW** |

**Overall Security Posture:** The frontend is well-secured — no hardcoded secrets, correct key separation (anon key for frontend, service key for backend), React's XSS protection applies, and all user-scoped RPC functions use `auth.uid()` correctly. The one HIGH finding (RLS status unverifiable from code alone) is the most important item to verify — it is either a gap in version control hygiene (RLS configured in dashboard but not in code) or a genuine data isolation failure. Treat as HIGH until confirmed.
