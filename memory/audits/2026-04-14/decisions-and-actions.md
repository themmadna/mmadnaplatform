# Decisions & Actions — UFC Web App — 2026-04-14

## P0 — Critical (Fix Immediately)
Security vulnerabilities, data loss risks, broken auth, production-blocking issues.
Do not ship or continue feature development until these are resolved.

| # | Issue | Source | Action | Done |
|---|---|---|---|---|
| 1 | `record-fight-status` Edge Function accepts any non-empty Authorization header string — JWT is never validated. Any internet caller can overwrite `fight_started_at`, `fight_ended_at`, `rounds_fought`, `ended_by_decision` on any fight. | B (R1) → DA upgraded → B (R3) confirmed HIGH | In `supabase/functions/record-fight-status/index.ts`: replace header-presence check with `supabase.auth.getUser(jwt)` validation. Reject requests where `getUser()` returns an error or null user. (~1 hr) | [ ] |
| 2 | Zero RLS policy definitions in version-controlled codebase — status of user data isolation on `user_round_scores`, `user_fight_scorecard_state`, `user_votes`, `profiles` is unverified from code alone. If disabled, any authenticated user can read any other user's scoring data via anon key. | B + G (R1) → both HIGH | Open Supabase dashboard → Authentication → Policies. Verify RLS is enabled on all 4 user tables. If disabled, enable immediately and add policy SQL to `supabase/deploy_rls_policies.py`. (~2 hrs if not already configured; ~30 min to version-control if it is) | [ ] |
| 3 | `.gitignore` line 5 is garbled encoding artifact — `.claude/settings.local.json` is provably not excluded (git status `??`). `build/` directory exists on disk and is not gitignored — one `git add .` bakes `REACT_APP_SUPABASE_URL` + anon key permanently into repo history. | DA (R2) → B + F (R3) confirmed | Rewrite `.gitignore` with correct encoding. Add: `build/`, `nul`, `*.log`, `*.csv`, `scoring_model/ml_dataset.csv`. (~5 min) | [ ] |

---

## P1 — High (Before Next Release)
Significant issues that should be addressed before the next feature sprint.

| # | Issue | Source | Action | Done |
|---|---|---|---|---|
| 4 | No `.env.example` — 5 required env vars + Python version undocumented. Vercel env reset or new machine setup has no reference. | B (MEDIUM) + F (HIGH) → R3 resolved as HIGH | Create `.env.example` documenting: `REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_MANAGEMENT_KEY`, `SUPABASE_ACCESS_TOKEN`, Python 3.9 requirement. (~15 min) | [ ] |
| 5 | No `requirements.txt` — Python deps (`requests`, `beautifulsoup4`, `python-dotenv`, `supabase-py`, `python-dateutil`, `scikit-learn`, `pandas`) and Python 3.9 constraint are entirely undocumented and unpinned. | E (R1) + DA Python version challenge → E (R3) | Create `requirements.txt` with pinned versions; add `# Requires Python 3.9` header. (~20 min) | [ ] |
| 6 | No pre-push hook — broken React code auto-deploys to Vercel on `git push`. | F (R1) → DA refined to distinguish hook (5 min) from full CI (2+ hrs) | Add `.git/hooks/pre-push` running `npm run build`. Fails fast on compilation errors before Vercel gets the push. (~5 min) | [ ] |
| 7 | `update_fight_ratings` trigger not version-controlled — if accidentally dropped, vote counts freeze silently with no error. | G (R1) MEDIUM → DA escalated → G (R3) confirmed HIGH | Extract trigger SQL into `supabase/deploy_triggers.py` and add to deploy documentation. (~30 min) | [ ] |
| 8 | `round_fight_stats` has no FK to `fights` or `fight_meta_details` — orphaned rows from scraper misspellings bias `fight_dna_metrics` (Combat DNA) aggregations for all users. | G (R1) MEDIUM → DA escalated → G (R3) confirmed HIGH | Add FK constraint on `round_fight_stats(event_name, bout)` → or preferably add `fight_url` column to `round_fight_stats` and FK to `fights.fight_url`. Version-control the migration. (~1 hr) | [ ] |
| 9 | ML model coefficients hardcoded in `FightDetailView.js` — if model is retrained and `scoring_model.json` updated without updating hardcoded values, inference silently produces wrong scores for users with no error indicator. | D (R1) MEDIUM → DA argued HIGH → D (R3) confirmed HIGH | Either: (a) load `scoring_model.json` from `public/` at runtime and use its coefficients directly; or (b) create a script that auto-syncs the hardcoded array from `scoring_model.json` after retraining. (~2 hrs for option a) | [ ] |

---

## P2 — Normal (Next Sprint / Tech Debt Backlog)

| # | Issue | Source | Action | Done |
|---|---|---|---|---|
| 10 | `CombatScatterPlot.js` — confirmed dead code, no import anywhere. | A (R3) confirmed | Delete `src/components/CombatScatterPlot.js`. (~2 min) | [ ] |
| 11 | `normName()` / `matchesFighter()` duplicated across Deno/browser boundary — future divergence produces different live-event writes vs UI display. | A (R1) HIGH | Document both implementations explicitly (which is canonical); add a comment cross-referencing the other copy. Long-term: extract to a shared JSON definition if the logic ever diverges. | [ ] |
| 12 | `CombatDNACard` defined inline in `App.js` (line 18) — ~180 lines with no routing dependency. App.js is 1,553 lines. | A + D (R1) | Extract `CombatDNACard` to `src/components/CombatDNACard.js`. (~30 min) | [ ] |
| 13 | `@tailwindcss/postcss` v4.1.18 with `tailwindcss` v3.4.1 — incompatible versions; v4 PostCSS plugin + v3 Tailwind may produce silent CSS misconfiguration. | E (R1) → DA version conflict → E (R3) HIGH | Run `npm run build` with PostCSS verbose. If `@tailwindcss/postcss` v4 is invoked, replace with correct v3 PostCSS integration. If not invoked (CRA ignores it), remove from `package.json`. | [ ] |
| 14 | Zero test coverage — 0 / 29 source modules. Recommended start: `guestStorage.js` (45 lines, pure functions, ~30 min). | C (R1) Grade F | Add `src/guestStorage.test.js`. Then `normName()` unit tests (extract shared), then `dataService.js` with Supabase mock. | [ ] |
| 15 | `@tailwindcss/postcss`, `@testing-library/*` (4 packages) in `dependencies` instead of `devDependencies`. | E (R1) | Move to `devDependencies` in `package.json`. | [ ] |
| 16 | No indexes version-controlled — confirmed zero `CREATE INDEX` in all deploy scripts. All indexes in Supabase dashboard only. | G (R3) confirmed | Add `CREATE INDEX IF NOT EXISTS` statements for critical columns to a new `supabase/deploy_indexes.py` script. Priority: `judge_scores(date)`, `fight_meta_details(fight_url)`, `user_round_scores(user_id, fight_id)`. | [ ] |
| 17 | `get_leaderboard_user_detail()` IDOR risk — RPC accepts any `user_id` UUID visible on public leaderboard; unverified whether it returns raw per-round scores. | B + G (R1) MEDIUM | Read `supabase/deploy_leaderboard_detail.py` SQL in full. If it returns `f1_score`/`f2_score` per round (not just accuracy), scope the query to `auth.uid()` or remove raw scores from the response. | [ ] |
| 18 | `getLeaderboard()` and `getLeaderboardUserDetail()` throw on error, breaking the `dataService.js` return-safe-default pattern. | F (R1) MEDIUM | Wrap with try/catch, return `[]` / `{ fights: [], rounds: [] }` on error, consistent with all other dataService methods. | [ ] |
| 19 | No migration history / rollback capability — schema lives across 10+ scripts + manual dashboard changes. | G (R1) MEDIUM | Consider adopting Supabase migrations (`supabase/migrations/*.sql`) for all future schema changes, with up and down scripts. | [ ] |
| 20 | `currentView` string router — no deep linking, no browser back/forward, `onBack` chains are hardcoded. | D (R1) MEDIUM | Evaluate `react-router-dom` for the next major feature addition. Current scale is acceptable. | [ ] |
| 21 | Magic number thresholds — intensity labels (12, 7), Judging DNA tiers (15, 40, 80), ML confidence (0.99) scattered as inline numbers. | A (R1) MEDIUM | Define as named constants at the top of their respective files. | [ ] |
| 22 | CRA → Vite migration — `react-scripts` de facto abandoned since 2022; unlocks Jest 29+, faster builds, modern ESM. | E (R1) HIGH (long-term) | Plan for next major architectural session. Not blocking anything today. | [ ] |
| 23 | No production error tracking — all errors go to browser `console.error()`. | F (R1) MEDIUM | Integrate Sentry (free tier) or equivalent for client-side error aggregation. | [ ] |
| 24 | `supabase/deploy_scoring_insights.py` is untracked — new unreviewed deploy script. | DA (R2) | Commit the file. The SQL follows standard SECURITY DEFINER + `auth.uid()` pattern; review the tier-gating logic before merge. | [ ] |

---

## Verdict

Would you ship this? Yes, with caveats. The UFC Web App is a well-built solo-developer product with clean architectural conventions, good error-handling discipline, and no hardcoded secrets. The code is readable and intentional.

Would you stake user privacy on it without resolving P0-2? No. The RLS status is the single most important unknown. If Row Level Security is not enabled on user tables, any logged-in user can query any other user's scoring history directly from the Supabase API using the public anon key. This is not theoretical — it requires no exploit, just an HTTP call. The 30-second verification: open a private browser tab, log in as any user, and query `https://{SUPABASE_URL}/rest/v1/user_round_scores?select=*` with the anon key. If rows from other users come back, RLS is off.

The P0 fixes are all fast. The `.gitignore` corruption and `build/` exclusion take 5 minutes. The Edge Function auth fix takes an hour. The RLS verification takes 30 seconds. None require a structural rewrite. The project's biggest long-term risk is the zero-test posture — not because bugs are rampant today, but because every future change to the scraper pipeline, guest mode, or ML inference happens without a safety net.

**Single most important action:** Verify RLS in the Supabase dashboard right now. Everything else can wait 24 hours. This one cannot.
