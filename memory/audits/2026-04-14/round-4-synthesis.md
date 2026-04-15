# Full Project Audit — UFC Web App — 2026-04-14

## Overall Verdict: CONDITIONAL

The UFC Web App is a well-structured, intentional solo-developer product with clean separation of concerns, disciplined error-handling conventions, and no hardcoded secrets in committed source. However, three clusters of findings prevent a PASS: (1) an unverified but potentially critical Row Level Security gap that, if unmitigated, means any authenticated user with the Supabase anon key can read any other user's per-round scores, votes, and scorecard states; (2) a confirmed authorization bypass in the `record-fight-status` Edge Function that allows any internet caller to corrupt production fight-state data; and (3) four operational gaps (no `.env.example`, no `build/` gitignore, no Python requirements file, a corrupted `.gitignore`) that make the environment non-reproducible and expose a one-`git add .` risk of committing build artifacts. None of these require a structural rewrite — all are remediable within a single focused session — but they must be addressed before the platform is promoted to broader public traffic.

---

## Scope

This audit examined: code health, security, test coverage, architecture, dependencies, operational readiness, and database integrity (Supabase). It covers all files in `ufc-web-app/src/`, `supabase/`, `scoring_model/`, and the Python scraper pipeline. It does not replace a full penetration test, performance profiling under real load, or a legal/compliance review. All dependency version assessments are approximations — verify flagged packages manually against current npm and PyPI registries.

---

## Critical Findings (P0)

Issues that require immediate action before any further development or deployment.

### P0-1: `record-fight-status` Edge Function — Authorization Bypass
**Description:** The Edge Function checks only for the _presence_ of an `Authorization` header — it never validates the JWT signature or verifies user identity. Any HTTP client passing `Authorization: Bearer <any-string>` can write arbitrary values to `fights.fight_started_at`, `fight_ended_at`, `scheduled_rounds`, `rounds_fought`, and `ended_by_decision`.

**Exploitability:** The attacker needs only the Edge Function URL (derivable from the Supabase URL visible in the React bundle), any integer `fight_id` (visible in the app), and any non-empty Authorization header value. No credentials required.

**Impact:** Can mark any fight as `final` before it occurs (closing user scoring windows), overwrite `rounds_fought` (corrupting per-round scoring panels), or falsify fight lifecycle timestamps for all users.

**Evidence:** `supabase/functions/record-fight-status/index.ts` lines 12–17 — header presence check only, no JWT verification call.

**Agent source:** Agent B (Round 1) rated LOW; DA (Round 2) identified as functional bypass; Agent B (Round 3) confirmed and upgraded to HIGH. CORS wildcard (`*`) on this write endpoint confirmed as compounding factor (Round 3-B).

**DA challenge outcome:** Confirmed with additional evidence — upgraded from LOW to HIGH.

---

### P0-2: Row Level Security — Status Unverifiable (Likely Critical Gap)
**Description:** No RLS policy definitions (`ROW LEVEL SECURITY`, `ENABLE RLS`, `CREATE POLICY`) exist anywhere in the version-controlled codebase across all `.py`, `.sql`, and `.ts` files. Tables containing user-private data — `user_round_scores`, `user_fight_scorecard_state`, `user_votes`, `profiles` — must have RLS enabled with `user_id = auth.uid()` policies or any authenticated caller can read any other user's data using only the anon key.

**Two scenarios:** (a) RLS is configured in the Supabase dashboard but not version-controlled — a governance gap; (b) RLS is genuinely not enabled — a critical data exposure. The codebase alone cannot distinguish between them.

**Evidence:** Grep for `ROW LEVEL SECURITY` / `ENABLE RLS` / `CREATE POLICY` across all source and deploy files — zero matches. Git status shows `?? .claude/settings.local.json` (not gitignored), confirming the gitignore does not protect all intended files.

**Agent source:** Agent B (security) and Agent G (database) independently identified this as HIGH in Round 1. DA (Round 2) noted both agents missed that `context/schema.md` should have been checked first; Agent G (Round 3) confirmed `context/schema.md` does not document RLS policy definitions. Finding maintained at HIGH.

**DA challenge outcome:** Finding maintained. The fastest verification path is a direct unauthenticated API call to `user_round_scores` — if rows are returned, RLS is disabled.

**Required action:** Verify in the Supabase dashboard immediately. If disabled, enable RLS on `user_round_scores`, `user_fight_scorecard_state`, `user_votes`, and `profiles` before any further user growth. Add policy SQL to a version-controlled deploy script.

---

### P0-3: `.gitignore` Encoding Corruption + `build/` Not Excluded
**Description:** `.gitignore` line 5 is a garbled encoding artifact — `.DS_Store` and `.claude/settings.local.json` appear concatenated as space-separated characters rather than as separate valid rules. Git status confirms `.claude/settings.local.json` is untracked (`??`), not ignored. Separately, the `build/` directory exists on disk and is not gitignored — CRA bakes `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` into `build/static/js/*.js` at compile time. One `git add .` commits build artifacts containing those values permanently to repo history.

**Evidence:** `.gitignore` line 5 (encoding artifact confirmed in Round 3-B); git status shows `?? build/` as untracked; `?? .claude/settings.local.json` as untracked (not ignored as intended). Build artifacts confirmed to exist on disk (Round 2 DA).

**Note on anon key:** The Supabase anon key is designed to be public-facing (RLS enforces security). However, committing it permanently to a public repo creates unnecessary exposure, and the URL + anon key combination enables unauthenticated table enumeration if RLS is not enabled (P0-2 above). The combination of both P0s amplifies risk.

**Agent source:** DA (Round 2) identified both gaps — not caught by any of the seven Round 1 agents. Agent B and Agent F confirmed in Round 3 responses.

**DA challenge outcome:** New confirmed findings from DA round. Both carry MEDIUM-to-HIGH severity. Combined with P0-2, the `build/` exposure is elevated.

**Required action (5 minutes):** Rewrite `.gitignore` with correct encoding. Add `build/`, `nul`, `*.log`, `*.csv`, `scoring_model/ml_dataset.csv` to `.gitignore`.

---

## Major Findings (P1)

Significant issues that should be addressed before the next release.

### P1-1: No Python `requirements.txt` — Scraper Environment Not Reproducible
**Description:** Seven core Python dependencies (`requests`, `beautifulsoup4`, `python-dotenv`, `supabase-py`, `python-dateutil`, `scikit-learn`, `pandas`) and a specific Python version constraint (3.9, per CLAUDE.md) are entirely undocumented. A new machine setup installs whatever latest versions are available, which may be incompatible. `supabase-py` has had breaking API changes between major versions. `scikit-learn` removes deprecated estimators between minor versions.

**Evidence:** No `requirements.txt`, `setup.py`, or `pyproject.toml` found; CLAUDE.md specifies `Python 3.9` but no `python_requires` constraint exists anywhere.

**Agent source:** Agent E (Round 1) and Agent F (Round 1) both flagged. DA (Round 2) added the Python 3.9 version constraint gap. Agent E (Round 3) upgraded Python version finding to MEDIUM.

**DA challenge outcome:** Finding confirmed and strengthened with version-constraint observation.

---

### P1-2: ML Model Hardcoded Coefficients — Silent Stale Risk
**Description:** `FightDetailView.js` contains hardcoded scaler means/stds and model coefficients extracted from `scoring_model.json` during development. The ML scoring model is retrained periodically. If the model is retrained and `scoring_model.json` updated without updating the hardcoded component values, the inference runs with new scaler parameters but old coefficients — producing silently wrong scores displayed to users with no error indicator. This is the app's core value-proposition feature.

**Clarification (Round 3-D):** There is no runtime fetch of `scoring_model.json`. The values were manually extracted and hardcoded. The "silent fetch failure" finding (Agent D Round 1) was retracted — there is no fetch to fail. The real risk is manual update discipline.

**Evidence:** `src/components/FightDetailView.js` — `MODEL_COEFFICIENTS` array (19 hardcoded values) + scaler values. `scoring_model/` directory contains retraining scripts that can produce a new `scoring_model.json`.

**Agent source:** Agent D (Round 1) rated MEDIUM. DA (Round 2) argued HIGH based on the app's core-feature status. Agent D (Round 3) confirmed and upgraded to HIGH.

**DA challenge outcome:** Confirmed and upgraded from MEDIUM to HIGH.

---

### P1-3: No `.env.example` — Environment Cannot Be Reproduced from Repo
**Description:** Five required environment variables (`REACT_APP_SUPABASE_URL`, `REACT_APP_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `SUPABASE_MANAGEMENT_KEY`, `SUPABASE_ACCESS_TOKEN`) and the Python version constraint have no canonical documentation. A Vercel environment reset, new machine setup, or future collaborator onboarding has no reference for required secrets.

**Evidence:** No `.env.example` or equivalent file found in repo root or anywhere in the codebase.

**Agent source:** Agent B (Round 1) rated MEDIUM; Agent F (Round 1) rated HIGH. DA (Round 2) identified the severity contradiction. Both Round 3 agents resolved to HIGH.

**DA challenge outcome:** Contradiction resolved — confirmed HIGH.

---

### P1-4: `round_fight_stats` Missing Foreign Key — Orphaned Rows Bias DNA Metrics
**Description:** `round_fight_stats` joins to `fights` and `fight_meta_details` on a text pair `(event_name, bout)` with no FK constraint. A scraper inserting rows with a misspelled `event_name` or reversed `bout` creates orphaned rows that the DB accepts silently. These orphaned rows are included in the `fight_dna_metrics` view aggregations that power all Combat DNA calculations, silently biasing metrics across every user's profile.

**Evidence:** `context/schema.md` — no FK on `round_fight_stats` to `fights`. `fight_dna_metrics` is a VIEW sourced from `round_fight_stats`. At ~30K rows (3K fights × 5 rounds × 2 fighters), a 1% orphan rate introduces ~300 silently biasing rows.

**Agent source:** Agent G (Round 1) rated MEDIUM. DA (Round 2) argued the compound-across-scraper-runs nature warrants higher severity. Agent G (Round 3) confirmed and upgraded to HIGH.

**DA challenge outcome:** Confirmed and upgraded from MEDIUM to HIGH.

---

### P1-5: `update_fight_ratings` Trigger — Not Version-Controlled, Silent Failure Mode
**Description:** The trigger that maintains `fight_ratings.like_count / dislike_count / favorites_count` on `user_votes` mutations is not in any version-controlled deploy script. If accidentally dropped (dashboard reset, Supabase infrastructure action), vote counts silently freeze — users can still vote without error, but displayed counts stop updating. Community Favorites rankings become stale with no error indicator.

**Evidence:** Grep for trigger SQL in all `supabase/*.py` and `supabase/views/*.sql` — zero matches. Agent G (Round 1) noted it as a MEDIUM governance note. DA (Round 2) argued the silent-corruption failure mode deserves higher severity.

**Agent source:** Agent G (Round 1) embedded MEDIUM. DA (Round 2) escalated. Agent G (Round 3) confirmed and upgraded to HIGH.

**DA challenge outcome:** Confirmed and upgraded from embedded MEDIUM to standalone HIGH. Add trigger SQL to a `supabase/deploy_triggers.py` script.

---

### P1-6: No CI/CD — Broken Code Auto-Deploys to Production
**Description:** Vercel auto-deploys `main` on push. There is no pre-push hook, no GitHub Actions workflow, no lint check, and no build verification. A React compilation error in any component auto-deploys to production immediately.

**Remediation split (Round 3-F):** (a) A `pre-push` git hook running `npm run build` — 5-minute fix, high safety impact. (b) Full GitHub Actions — 2+ hours, meaningful only after test infrastructure exists. The immediate action is (a).

**Evidence:** No `.github/workflows/` directory; no `.git/hooks/pre-push`; Vercel deploy config auto-deploys on push.

**Agent source:** Agent F (Round 1) rated HIGH. DA (Round 2) noted the bundled framing obscured the quick win. Agent F (Round 3) refined.

**DA challenge outcome:** Finding maintained; remediation path refined to differentiate immediate (hook) from long-tail (CI).

---

### P1-7: `normName()` / `matchesFighter()` Duplicated Across Deno/Browser Boundary
**Description:** The fighter name normalisation function `normName()` and the six-strategy `matchesFighter()` logic exist in both `supabase/functions/poll-live-fights/index.ts` (TypeScript/Deno) and `src/components/FightDetailView.js` (browser JavaScript). A bug fix in one copy does not automatically reach the other. If the two implementations diverge silently, live fight polling writes different matches to the DB than the UI displays to users.

**Agent A** verified both implementations appear functionally identical today. The risk is future divergence.

**Evidence:** Both files confirmed to contain `normName()`. CLAUDE.md convention #8 documents this as a recurring source of data issues. `memory/LESSONS.md` records past fighter name matching bugs.

**Agent source:** Agent A (Round 1) rated HIGH. DA (Round 2) correctly challenged that the two implementations were not compared. Agent A (Round 3) confirmed they appear identical but cannot guarantee future parity without a test or shared abstraction.

**DA challenge outcome:** Confirmed; severity maintained at HIGH. The risk is real even with today's parity.

---

## Minor Findings (P2)

Hygiene, improvements, and technical debt to address when bandwidth allows.

### P2-1: `react-scripts` 5.0.1 — CRA De Facto Abandoned
`react-scripts` has not received a release since April 2022. The underlying webpack, babel, and Jest (v27) are unpatched. The primary risk is long-term ecosystem abandonment — no Jest upgrades, eventual Node.js incompatibility in Vercel build workers — not an immediate runtime CVE (build CVEs affect the Vercel build environment, not deployed artifacts).

**Agent source:** Agent E (Round 1) HIGH; DA (Round 2) partially challenged the "near-term security" framing; Agent E (Round 3) maintained HIGH with corrected framing. Maintained here as P2 given no acute runtime risk, but migration to Vite is recommended on the product roadmap.

---

### P2-2: `@tailwindcss/postcss` v4 with `tailwindcss` v3 — Version Conflict
`@tailwindcss/postcss` `^4.1.18` (in `dependencies`) is the PostCSS plugin for Tailwind CSS v4. `tailwindcss` in `devDependencies` is `^3.4.1` (v3). These are incompatible APIs. If CRA's internal PostCSS pipeline invokes this plugin, CSS output may be silently misconfigured. If CRA ignores it (possible given CRA's internal PostCSS config), the package is dead weight and should be removed.

**Agent source:** Agent E (Round 1) noted as MEDIUM hygiene (misplacement). DA (Round 2) identified the version conflict as more serious. Agent E (Round 3) upgraded to HIGH. Placed here as P2 pending verification of whether CRA actually invokes this plugin.

**Required action:** Run `npm run build` with verbose PostCSS output; confirm which config is active; remove or correct `@tailwindcss/postcss`.

---

### P2-3: Zero Automated Test Coverage — 0 of 29 Source Modules Tested
The project has no meaningful tests. `src/App.test.js` contains no test cases (it is a legacy component snapshot). All "test" scripts (`test_poll_live_fights.py`, `validate_scoring_model.py`) are diagnostic tools that exit 0 on failure.

**Highest-risk untested paths (in order of return on investment):**
1. `guestStorage.js` (45 lines, pure functions, mockable sessionStorage — 30-minute win)
2. `normName()` / `matchesFighter()` — 6 matching strategies; confirmed recurring source of production data issues
3. `dataService.js` core methods — `castVote`, `getDNAAndChartData`, `getFightDetail` error paths
4. ML inference function in `FightDetailView.js` — null-input silent bias (one-null → silently wrong score)
5. `validate_scoring_model.py` — add `assert overall_pct >= 80.0` before exit

**Constraint:** CRA's Jest v27 limits some modern ESM mocking patterns. Migration to Vite (P2-1) unlocks Jest 29+.

**Agent source:** Agent C (Round 1) — Grade F. All Round 3 findings maintained. DA (Round 2) noted line count discrepancies (stale docs used instead of direct measurement); Agent C (Round 3) confirmed and corrected (App.js is 1,553 lines, not ~2,500; CombatDNAVisual.js is 139 lines, not ~5,748).

---

### P2-4: `App.js` God File — 1,553 Lines with Inline `CombatDNACard` Component
`CombatDNACard` (~180 lines) is defined inline in `App.js` at line 18. It has no routing dependency and no side effects — it should be `src/components/CombatDNACard.js`. App.js also contains view routing, auth state management, live polling orchestration, year/search filter state, and fight-list fetching. Recommended split: extract `CombatDNACard`, create `useLivePoll` and `useFightList` hooks.

**Agent source:** Agent A (code health) and Agent D (architecture) independently flagged — HIGH in both domains.

---

### P2-5: `currentView` String Router — No Deep Linking or Browser History
The app uses a `currentView` string-based state machine for navigation. 12+ named views. Browser back/forward is non-functional; URLs are not bookmarkable. Each `onBack` hard-codes a destination. The navigation history at depth 3+ (fight list → fight detail → judge comparison → user vs judge) was not audited for consistency.

**Agent source:** Agent D (Round 1) MEDIUM. DA (Round 2) noted the back-chain was never traced. Agent D (Round 3) acknowledged the evidence gap but maintained the structural concern.

---

### P2-6: Indexes Not Version-Controlled
No `CREATE INDEX` statements exist anywhere in the version-controlled codebase (confirmed by grep across all `supabase/*.py` — zero matches). All indexes were created manually in the Supabase dashboard. Critical indexes for current query patterns: `judge_scores(date)`, `round_fight_stats(event_name, bout)`, `user_round_scores(user_id, fight_id)`, `fight_meta_details(fight_url)`. At current data volumes these are not causing visible latency; at scale the `judge_scores` date-range scan and `round_fight_stats` text-pair scan will degrade.

**Agent source:** Agent G (Round 1) MEDIUM. DA (Round 2) challenged that deploy scripts were not searched — Agent G (Round 3) confirmed: zero `CREATE INDEX` in deploy scripts.

---

### P2-7: No Migration History or Rollback Capability
Schema changes are applied via ad-hoc `deploy_*.py` and `migrate_*.py` scripts with no down-migration capability. The current applied schema cannot be reconstructed from any single source — it lives in git commit history across 10+ script files plus manual dashboard changes.

**Agent source:** Agent G (Round 1) MEDIUM. Unchallenged by DA.

---

### P2-8: `get_leaderboard()` Exposes `user_id` UUIDs to Anon Callers / IDOR Risk on Detail
`get_leaderboard()` returns `user_id` UUIDs in its public payload. `get_leaderboard_user_detail(p_user_id uuid)` accepts any UUID (visible on the public leaderboard) and returns per-fight accuracy data. If this includes raw per-round scores (f1_score/f2_score per round), any caller can retrieve another user's detailed scoring history. The deploy script was not read in full; IDOR severity is MEDIUM pending confirmation.

**Agent source:** Agent B and Agent G independently flagged. DA (Round 2) noted both RPC sources were not read. Agents B and G (Round 3) maintained MEDIUM pending full RPC review.

---

### P2-9: Large Untracked Files Not Gitignored
Three `ufc_fight_scores*.csv` files (58K+ rows each), `scoring_model/ml_dataset.csv`, `scrape_errors.log`, and `nul` (Windows artifact) are all untracked and ungitignored. Large CSVs slow `git status`, risk accidental `git add .`, and inflate the repo if committed. None contain PII (confirmed — public fight scorecard data, no user IDs in ML training features).

**Agent source:** DA (Round 2) — missed by all seven Round 1 agents. Agent B and Agent F (Round 3) confirmed. Agent B confirmed no PII in CSV or ML dataset.

---

### P2-10: `supabase/deploy_scoring_insights.py` — Untracked Unreviewed Deploy Script
A new deploy script for `get_scoring_insights()` exists as untracked (`?? supabase/deploy_scoring_insights.py`). It was not reviewed by any Round 1 agent. Agent C (Round 3) partially read it — it follows standard SECURITY DEFINER + `auth.uid()` pattern and appears correct. However, the tier-gating logic (15/40/80 matched rounds) and fingerprint calculations in this RPC are complex and entirely untested.

---

### P2-11: `CombatScatterPlot.js` — Confirmed Dead Code
`CombatScatterPlot.js` exists in `src/components/` but has no import in `App.js` or any other `src/` file. It was intentionally removed from the Combat DNA page (Phase 8e per PROGRESS.md). The file is safe to delete.

**Agent source:** Agent A (Round 1) conditional; DA (Round 2) challenged the insufficient verification; Agent A (Round 3) confirmed dead code.

**DA challenge outcome:** Confirmed.

---

### P2-12: Magic Numbers — Domain Thresholds Not Named Constants
Intensity classification thresholds (`score > 12` → "MAULER", `score > 7` → "ACTIVE GRAPPLER") in `App.js:41–43`; Judging DNA tier unlock thresholds (15 / 40 / 80 rounds) in `JudgingDNACard.js`; ML confidence threshold (`>= 0.99`) in `FightDetailView.js`. Changing any threshold requires hunting multiple occurrences.

**Agent source:** Agent A (Round 1) MEDIUM. Unchallenged by DA.

---

### P2-13: `record-fight-status` Race Condition — No Transaction Guard
The function reads `fight.fight_started_at = null` in application code then writes. Under concurrent calls (two users scoring the same live fight within milliseconds), both reads see null, both compute a write timestamp, and one write clobbers the other. The comment "safe against concurrent calls" is an application assertion without a database transaction or row lock.

**Evidence:** `record-fight-status/index.ts` — PATCH without BEGIN/COMMIT or SELECT FOR UPDATE.

**Agent source:** DA (Round 2) identified; Agent G (Round 3) confirmed MEDIUM. Low probability at current scale.

---

### P2-14: No Structured Production Error Tracking
All errors are `console.error()` / `console.warn()` to the browser console. No Sentry or equivalent integration. Data-loading failures are invisible to the developer without user reports. The `getLeaderboard()` function throws on error (breaking the `dataService.js` return-safe-default pattern), potentially producing unhandled rejections visible to users if `Leaderboard.js` does not catch.

**Agent source:** Agent F (Round 1) MEDIUM. Unchallenged by DA.

---

## Areas That Passed Review

- **No hardcoded secrets in committed source:** Grep for `sk-`, `Bearer `, `api_key =`, `eyJ`, `secret =` across all source files — zero matches. All credentials read from `process.env.*` or `Deno.env.get()`. (Agent B, Round 1)
- **No SQL injection risk:** All Supabase JS client calls use the PostgREST parameterized query builder. All RPC calls pass typed parameters. Python deploy scripts post developer-authored SQL, never user-constructed strings. (Agent B, Round 1)
- **No XSS risk:** No `dangerouslySetInnerHTML` usage found anywhere. React JSX auto-escapes all values. (Agent B, Round 1)
- **User-scoped RPCs correctly implemented:** `get_user_judging_profile()`, `get_scoring_insights()`, `get_user_judge_comparison()` — all use SECURITY DEFINER + `auth.uid()` with GRANT to `authenticated` only. Users cannot access other users' data through these endpoints. (Agents B and G, Round 1)
- **No circular dependencies (likely):** Import graph is acyclic by visual inspection — components import from `dataService.js`, not from each other. Formal verification with `madge` not run; upgraded from PASS to UNKNOWN per Agent D (Round 3), but structure makes circularity very unlikely. (Agent D, Round 1/3)
- **`dataService.js` error handling consistent:** All 14 functions follow catch-and-return-safe-default pattern with no bare `catch {}` blocks. (Agent F, Round 1)
- **`package-lock.json` committed:** Node dependency tree is fully pinned and reproducible. (Agent F, Round 1)
- **No GPL-licensed dependencies:** React (MIT), Tailwind (MIT), Recharts (MIT), Supabase JS (Apache 2.0), scikit-learn (BSD-3). (Agent E, Round 1)
- **Schema naming is consistent:** All tables, columns, views, and RPCs use `snake_case` throughout. (Agent G, Round 1)
- **`update_fight_ratings` trigger logic is correct in design:** The pattern (trigger on `user_votes` → maintains aggregated counts in `fight_ratings`) avoids expensive COUNT(*) queries. Concern is governance (not version-controlled), not logic. (Agent G, Round 1)
- **Scraper re-run safety confirmed:** All six phases use `ON CONFLICT DO NOTHING` or idempotent UPSERT patterns. Re-running the full pipeline after a mid-run failure is safe for data integrity. (Agent F, Round 3 — retracted the original concern after verifying phase architecture)
- **`migrate_leaderboard_eligibility.py` correctly implements GENERATED ALWAYS column migration:** Uses `DROP COLUMN IF EXISTS` + `ADD COLUMN` — the correct PostgreSQL pattern. (Agent G, Round 3 — original concern retracted after reading the script)
- **ML model fetch failure concern retracted:** There is no runtime fetch of `scoring_model.json` — values were manually hardcoded from the JSON during development. No silent fetch-failure risk. (Agent D, Round 3)
- **`currentTheme` is live code, not dead code:** Confirmed actively passed as prop to all major components. Original dead-code hypothesis retracted. (Agent A, Round 3)
- **CSV files contain no PII:** `ufc_fight_scores*.csv` contains public fight record data. `scoring_model/ml_dataset.csv` does not include user identifiers in training features. (Agent B, Round 3)

---

## Grades by Domain

| Domain | Grade | Notes |
|---|---|---|
| Code Health | B | Clean conventions, no TODO debt, no hardcoded secrets. Main debt: App.js god file (1,553 lines, inline CombatDNACard), normName/matchesFighter cross-boundary duplication, magic number thresholds. Confirmed dead code: CombatScatterPlot.js. |
| Security | C | No hardcoded secrets, no XSS, no SQL injection. Two confirmed HIGH findings: record-fight-status authorization bypass (any caller can corrupt fight state); RLS status unverifiable (potentially no data isolation on user tables). CORS wildcard on write endpoint. .gitignore encoding corruption leaves settings.local.json unprotected. |
| Test Coverage | F | Zero production source modules tested. 0 / 29 coverage. The one test file (App.test.js) contains no test cases. All "test" scripts are diagnostic tools that exit 0 on failure. Test infrastructure is installed but entirely unused. |
| Architecture | B | dataService.js / component separation is clean and consistently applied. Main debt: App.js does too much, currentView string router limits URL-based navigation, ML model coefficients hardcoded separately from their source (silent stale risk upgraded to HIGH). Edge Function data write bypasses dataService.js. |
| Dependencies | C | JavaScript runtime deps are lean and current. Two HIGHs: react-scripts 5.0.1 (CRA abandoned — ecosystem risk), @tailwindcss/postcss v4 with tailwindcss v3 (version conflict in build tooling). No Python requirements.txt; Python 3.9 version constraint undocumented. 4 test libraries misplaced in dependencies. |
| Operational Readiness | D | No .env.example, no build/ gitignore, no Python requirements.txt, corrupted .gitignore, no CI/CD, no production error tracking, no scraper log persistence, no application health check. Multiple large untracked files ungitignored. All quick-win fixes — none require structural work. |
| Database | C | Schema design is clean and well-normalized. Three confirmed HIGHs: RLS unverifiable (critical if disabled), round_fight_stats missing FK (orphaned rows bias DNA metrics), update_fight_ratings trigger not version-controlled (silent count freeze on drop). No indexes in version control. No migration rollback capability. |

---

## Prioritized Remediation Checklist

### Immediate (P0 — do before next user-facing release or traffic growth)

1. **Fix `record-fight-status` JWT bypass** — Validate JWT using Supabase's `auth.getUser()` inside the Edge Function before processing any writes. Add `Authorization: Bearer` token validation, not just header presence check. ~1 hour.
2. **Verify RLS in Supabase dashboard** — If disabled on any user table (`user_round_scores`, `user_fight_scorecard_state`, `user_votes`, `profiles`), enable immediately. Add policy SQL to a version-controlled `supabase/deploy_rls_policies.py` script. ~2 hours.
3. **Fix `.gitignore`** — Rewrite with correct encoding. Add `build/`, `nul`, `*.log`, `*.csv`, `scoring_model/ml_dataset.csv`. ~5 minutes.

### Short-term (P1 — before next feature development sprint)

4. **Create `.env.example`** documenting all 5 required variables + Python version. ~15 minutes.
5. **Create `requirements.txt`** with pinned Python dependencies and Python 3.9 constraint. ~20 minutes.
6. **Add `pre-push` git hook** running `npm run build` to prevent broken deploys. ~5 minutes.
7. **Version-control the `update_fight_ratings` trigger** in a new `supabase/deploy_triggers.py` script. ~30 minutes.
8. **Add FK constraint to `round_fight_stats`** (or create a unique composite index at minimum) to catch orphaned rows at ingest time. ~1 hour.
9. **Establish model update discipline** — when retraining the scoring model, create a script that reads features/coefficients from `scoring_model.json` and updates the hardcoded values in `FightDetailView.js`, or better: load them at runtime from a version-controlled JSON in `public/`. ~2 hours.

### When bandwidth allows (P2 — tech debt backlog)

10. Add first tests — start with `guestStorage.js` (30 min), then `normName()`/`matchesFighter()` unit tests.
11. Extract `CombatDNACard` to `src/components/CombatDNACard.js`.
12. Verify and resolve `@tailwindcss/postcss` v4 / Tailwind v3 conflict.
13. Version-control all indexes in deploy scripts.
14. Plan CRA → Vite migration (unlocks Jest 29+, improves build performance).
15. Delete `src/components/CombatScatterPlot.js` (confirmed dead code).
16. Audit `get_leaderboard_user_detail()` RPC SQL for IDOR scope — read `supabase/deploy_leaderboard_detail.py` in full.
