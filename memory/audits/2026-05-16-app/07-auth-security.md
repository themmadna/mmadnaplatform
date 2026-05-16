# 07 — Auth & Security Surface

## §1. Service key exposure — verified absent

- `grep -rn "SUPABASE_SERVICE\|service_role"` against `src/` — **0 matches**.
- `grep -rn "SUPABASE_SERVICE"` against `build/static/js/main.*.js` — **0 matches**.
- `grep "service_role"` against build → only matches the `main.*.js.map` (sourcemap reference to a string identifier inside `@supabase/supabase-js`, not the env var). Sourcemaps don't contain `.env` values — they reference variable names.
- Confirmed: anon key inlined in `main.*.js` (one `eyJ...` JWT). Anon key is public by design.

**✅ Service role key is not in the frontend bundle.** Backend audit already covered RLS coverage.

## §2. `.env` and `REACT_APP_` prefix discipline

- ✅ `supabaseClient.js:4-5` uses `process.env.REACT_APP_SUPABASE_URL` and `process.env.REACT_APP_SUPABASE_ANON_KEY`. Correct prefix.
- ✅ `App.js:408, 419` and `FightDetailView.js:199, 304` use the same prefixed vars for Edge Function URL construction.
- ✅ `.env` is in `.gitignore` (line 1).
- ✅ `build/` is in `.gitignore` (line 8) — confirmed post-April fix.

`grep -rn "process.env" src/ --include="*.js" | grep -v REACT_APP_` → returned no findings (all env reads use the correct prefix).

## §3. Sign-out leaks guest sessionStorage (P1)

`App.js:787`:
```js
const handleSignOut = async () => {
  await supabase.auth.signOut();
  setSession(null);
  setCurrentView('events');
};
```

Does NOT clear:
- `ufc_guest_mode`
- `ufc_guest_votes`
- `ufc_guest_scores`
- `ufc_guest_scorecard_state`
- `ufc_guest_spoiler_protection`

**Scenario A (privacy leak):** User A signs in, does work, signs out. Same browser, same tab. User B opens the app, picks "Continue as Guest". If User A had ever guested on this tab before signing in, User B inherits A's pre-signin guest votes/scores. Low sensitivity (votes/scores aren't PII), but unexpected.

**Scenario B (UX confusion):** A guest takes a tour, casts a few votes, decides to sign up via the "Sign Up" link in the guest banner. After signup, the guest banner disappears (per `handleGuestSignUp` at `App.js:788-794`), but the user's guest votes are still in sessionStorage and the user's account has no votes recorded. The votes disappear without explanation — they're effectively lost.

**Fix sketch:**
```js
const handleSignOut = async () => {
  await supabase.auth.signOut();
  sessionStorage.removeItem('ufc_guest_mode');
  sessionStorage.removeItem('ufc_guest_votes');
  sessionStorage.removeItem('ufc_guest_scores');
  sessionStorage.removeItem('ufc_guest_scorecard_state');
  // keep ufc_guest_spoiler_protection? Or also reset — design call.
  setSession(null);
  setIsGuest(false);
  setUserHistory([]);
  setCombatDNA(null);
  setComparisonData([]);
  setCurrentView('events');
};
```

Optionally, migrate guest votes/scores to the new account on signup — but that's a feature, not a bug fix.

## §4. Profile creation / display_name flow

- ✅ `dataService.getProfile()` returns `null` for new users — handled at `App.js:506`.
- ✅ `updateProfile()` upserts safely.
- ✅ No race condition on single-tab signup.
- ⚠ Multi-tab signup: each tab independently upserts `profiles` row. Postgres `INSERT ... ON CONFLICT` is idempotent → no data corruption.

### S4.1 — `display_name` setter UI is deferred (acknowledged P2)

PROGRESS.md flags this. Users currently can't pick a display name; leaderboard shows "Scorer #XXXX".

## §5. Edge Function calls from browser

`App.js:413-424` and `FightDetailView.js:296-310`:
- ✅ `Authorization: Bearer ${session.access_token}` — user JWT (not service role).
- ✅ `apikey: process.env.REACT_APP_SUPABASE_ANON_KEY` — anon, not service.
- ✅ `verify_jwt: false` on the Edge Function per LESSONS — function validates JWT internally.
- ⚠ The session JWT is sent to a URL constructed from `process.env.REACT_APP_SUPABASE_URL`. If that env var were ever swapped to a hostile URL during a build, JWTs would leak. Trust boundary is Vercel's env var management → acceptable.

## §6. Trust-boundary check on user-supplied data

- ✅ Search input — `App.js:601` uses Supabase's `.or()` PostgREST builder with `%${query}%`. PostgREST handles escaping. Not vulnerable to SQL injection.
- ✅ No `dangerouslySetInnerHTML` anywhere in `src/`. Grep confirms.
- ✅ Fight names displayed as text nodes inside JSX — React escapes automatically.

## §7. Console logging of fighter names (informational)

`FightDetailView.js:404-409` logs fighter names and normalized strings to console on every fight detail load (see `03-components.md §C3.1`). Names are public data (in the fight bout string), so no privacy concern. But the pattern is wrong — production console should be clean.

## §8. Supabase audit findings (cross-reference)

The companion 2026-05-16 backend audit identified 3 P0s (stale grants, backup tables, deprecated DEFINER overload). These are server-side; the frontend doesn't call any of them. No frontend action required.
