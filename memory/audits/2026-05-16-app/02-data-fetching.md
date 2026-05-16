# 02 — Data Fetching (`src/dataService.js`)

## §1. Per-function error handling audit

| Function | Returns on error | Verdict |
|---|---|---|
| `castVote` | throws | Wrapped in try/catch at call site `App.js:750` ✅ |
| `getDNAAndChartData` | `{ dna: null, chartData: [] }` | ✅ |
| `getGlobalBaselines` | `null` | ✅ |
| `getRecommendations` | `[]` | ✅ |
| `getFightDetail` | `{ meta: null, roundStats: [], judgeScores: [] }` | ✅ |
| `getUserScoringData` | implicit (no try/catch — relies on Supabase client not throwing) | ⚠ **G1.1** |
| `upsertRoundScore` / `upsertScorecardState` | throws | Caller wraps |
| `getCommunityScorecard` | `[]` | ✅ |
| `getScoredFights` | `[]` (3 error returns) | ✅ |
| `getUserJudgingProfile` | `null` | ✅ |
| `getJudgeDirectory` | `[]` | ✅ |
| `getJudgeProfile` / `getJudgeComparison` / `getUserJudgeComparison` | `null` | ✅ |
| `getScoringInsights` | `null` | ✅ |
| `getCommunityFavorites` | `[]` | ✅ |
| `getProfile` / `updateProfile` | `null` / void | ✅ |
| `getLeaderboard` | `[]` (try/catch wrapper) | ✅ (per audit #18 fix) |
| `getLeaderboardUserDetail` | `{ fights: [], rounds: [] }` | ✅ (per audit #18 fix) |

### G1.1 — `getUserScoringData` has no defensive shape (P2)

`dataService.js:152-167` — if the parallel queries fail in unexpected ways (network mid-flight, RLS surprise), `scores` and `state` could be `undefined` rather than `[]`/`null`. The `|| []` and `|| null` defaults at line 166 cover most cases, but no `try/catch` means a thrown error in the destructure propagates to the caller (`RoundScoringPanel.js:72-86`) which doesn't have one either. RoundScoringPanel will throw and unmount mid-load. Low probability, but harden it like `getLeaderboard`.

## §2. Waterfalls vs parallel fetches

Reviewed every multi-query function:

- `getFightDetail` — meta first, then roundStats + judgeScores in parallel. **Correct** — judgeScores filter depends on event date, but meta isn't required for that; meta is required for the fighter list filter on roundStats. Could go fully parallel if the call accepted fighters via the prop, but the current 2-trip is reasonable.
- `getScoredFights` — 3 trips: scores → fights → (metas ‖ events). The metas+events parallel at `dataService.js:230-237` is correct. The first two are sequential because fights query needs the IDs. ✅
- `App.js` `handleEventClick` — single `select('*, fight_ratings(...)')` then `user_votes`. Could be parallelized (user_votes doesn't depend on event), but the savings are tiny (~50ms).
- `App.js` `fetchUserHistory` — votes → fights → events. Same pattern; second and third could be parallelized but votes returns IDs. ✅
- `App.js` `loadForYou` — recommendations → events. Could parallelize the event date lookup but again depends on result.

### G2.1 — `For You` event date attach is a 2nd round-trip (P2)

`App.js:540` — after fetching recommendations, fetches `ufc_events` for the unique event names. Same pattern in `App.js:623-624` for search and `App.js:806-807` for user history. Could be a single RPC that returns the recommendations with event_date pre-joined. Marginal — these run on user action, not on every render.

## §3. Loaded but unread data

- `getRecommendations` returns `event_date` via JOIN inside the RPC? No — the frontend manually fetches it (`App.js:540`). The recommendation rows themselves only carry `id, event_name, bout, event_date, fight_url, dist, match_reason` per `context/rpc-functions.md`. So that's consistent.
- `getFightDetail` returns `meta.*` (full row); `FightDetailView` reads many of them but not all. Selecting `*` is fine — it's one row.
- `getScoredFights` returns full `f.bout`, `f.event_name`, `f.weight_class`, `f.fight_url`, `f.winner`, `f.status`. UI only displays a subset in JudgingDNACard's Scored Fights collapsible. Acceptable — they're used for `onFightClick` navigation. ✅
- `getDNAAndChartData` returns `chartData` even when only `dna` is currently consumed (CombatScatterPlot was removed). `App.js:762` still calls `setComparisonData(chartData)` and uses it in `resetFiltersToDNA`. So both are used. ✅

## §4. RPC call sites vs `context/rpc-functions.md`

Checked every call site against the documented signature:

| Frontend call | RPC | Matches `rpc-functions.md`? |
|---|---|---|
| `getRecommendations(userId, combatDNA)` | `get_fight_recommendations(p_user_id, p_pace, p_violence, p_intensity, p_control, p_finish, p_duration)` | ✅ exact mapping `dataService.js:88-97` |
| `getCommunityScorecard(fightId)` | `get_community_scorecard(p_fight_id)` | ✅ |
| `getUserJudgingProfile()` | `get_user_judging_profile()` (no params) | ✅ — uses `auth.uid()` directly |
| `getJudgeDirectory()` | `get_judge_directory()` | ✅ |
| `getJudgeProfile(name)` | `get_judge_profile(p_judge)` | ✅ |
| `getJudgeComparison(j1, j2)` | `get_judge_comparison(p_judge1, p_judge2)` | ✅ |
| `getUserJudgeComparison(name)` | `get_user_judge_comparison(p_judge)` | ✅ |
| `getScoringInsights()` | `get_scoring_insights()` | ✅ |
| `getLeaderboard()` | `get_leaderboard()` | ✅ |
| `getLeaderboardUserDetail(userId)` | `get_leaderboard_user_detail(p_user_id)` | ✅ |

No drift. The companion Supabase audit (2026-05-16) flagged a deprecated `get_user_judging_profile(p_user_id uuid)` overload still on the server — the **frontend correctly calls the no-arg version**, so no consumer-side action is required. The deprecated overload is server-side cleanup.

## §5. sessionStorage / localStorage

Used for:
- `ufc_guest_mode` — flag
- `ufc_guest_votes` — keyed by fightId
- `ufc_guest_scores` — keyed by (fightId, round)
- `ufc_guest_scorecard_state` — keyed by fightId
- `ufc_guest_spoiler_protection` — global setting

### G5.1 — sessionStorage leaks across sign-out (P1) — see also `07-auth-security.md §3`

`handleSignOut` at `App.js:787` clears `session` state but does NOT call `guestStorage.setGuest(false)` or `sessionStorage.removeItem(...)` for the guest keys. If a logged-in user signs out and the same browser session continues with "Continue as Guest", any votes/scores from the prior guest session that previously existed will still be there (or worse, the new guest will pick up scores recorded under the old user via `dataService.upsertRoundScore` which routes to DB — fine — but the next time they enter as guest, the sessionStorage from before they ever logged in is still present).

More concretely: a shared-device user enters guest mode → casts votes → signs up via "Sign Up" link → those guest votes are NOT migrated to their account (no migration logic anywhere in the codebase) → the guest votes linger in sessionStorage but are now orphaned. If the user signs out, the next visitor inherits them.

Risk: low data sensitivity (votes/scores aren't PII), but the user-experience expectation is "starting fresh" on sign-out, which is violated.

### G5.2 — localStorage is never used (informational)

The app uses `sessionStorage` exclusively. This is intentional (`guestStorage.js:1-2` comment) — guests should be incentivized to sign up. ✅
