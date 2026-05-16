# 03 — Component Health

## §1. Dead components

Grep'd every component import:

| Component | Imported by | Status |
|---|---|---|
| `App.js` | `index.js` | ✅ |
| `Login.js` | `App.js:5` | ✅ |
| `CombatDNAVisual.js` | `App.js:7` | ✅ |
| `FightDetailView.js` | `App.js:9` | ✅ |
| `JudgingDNACard.js` | `App.js:10` | ✅ |
| `JudgeDirectory.js` | `App.js:11` | ✅ |
| `JudgeProfileView.js` | `App.js:12` | ✅ |
| `JudgeComparison.js` | `App.js:13` | ✅ |
| `UserJudgeComparison.js` | `App.js:14` | ✅ |
| `Leaderboard.js` | `App.js:15` | ✅ |
| `CombatDNACard.js` | `App.js:16` | ✅ |
| `RoundScoringPanel.js` | `FightDetailView.js:5` | ✅ |
| `ScorecardComparison.js` | `FightDetailView.js:6` | ✅ |
| `ScoringInsightsCard.js` | `JudgingDNACard.js:3` | ✅ |

No orphan components. `CombatScatterPlot.js` was already deleted per LESSONS #10.

### C1.1 — `src/App.js copys/` and `src/dataService.JS copys/` are committed dead code (P1)

`src/App.js copys/` contains 13 stale snapshots of App.js (`App copy.js`, `App copy 2.js` ... `App copy 13.js`) — combined ~220 KB. `src/dataService.JS copys/` has 6 more. These are inside `src/` and tracked by git (visible from `Mar 1 14:05` timestamps).

CRA's webpack only bundles imported modules, so they do **not** ship to production. But:
- They pollute `npm test` / ESLint runs on `src/` (slow startup).
- They show up in IDE search and confuse navigation.
- They contain old code with `console.error` style and old patterns — if anyone ever copies a snippet from them, they import bugs.
- They make refactors harder (find-and-replace hits 14 files instead of 1).

Recommend: delete the directories or move them outside `src/` (e.g. `archive/` at repo root, gitignored).

## §2. Duplicate logic

### C2.1 — `normName()` / `normPollName()` cross-references already documented (P2 — verified)

Three locations:
- `src/App.js:47-49` — `normPollName` (less strict — no NFD)
- `src/components/FightDetailView.js:104-106` — `normName` (canonical, with NFD)
- `supabase/functions/poll-live-fights/index.ts` (canonical mirror, per the comment at FightDetailView:102)

LESSONS #11 records that cross-reference comments were added. FightDetailView has the comment. App.js's `normPollName` does NOT have the cross-reference comment despite being a near-duplicate — different strictness (lacks NFD/diacritics). Worth a comment noting the intentional difference ("App.js polling uses a simpler match because ESPN names rarely have diacritics; FightDetailView needs full NFD for judge_scores matching").

### C2.2 — `getInitials()` duplicated in 4+ files (P2)

Defined identically in:
- `RoundScoringPanel.js:5-10`
- `ScorecardComparison.js:30-33`
- `JudgingDNACard.js:10-15`
- Inline in `FightCard` (App.js:75-76), `FightDetailView.js:489-490`

Could be a single helper in `src/lib/names.js` (no such file yet). Marginal — they're each 5 lines.

### C2.3 — `normN()` / `normName()` / `normPollName()` — three different normalizers in frontend (P2)

- `App.js:47` — `normPollName` — lowercase + strip non-alphanumeric + collapse spaces
- `FightDetailView.js:104` — `normName` — NFD-decompose + strip combining marks + lowercase + strip non-alphanumeric + collapse spaces
- `JudgingDNACard.js:9` — `normN` — lowercase + strip non-alphanumeric (no space handling)
- `Leaderboard.js:6` — `lastName` — different concept, fine

Three normalizers with overlapping but distinct semantics. The differences are intentional (per LESSONS notes on accent handling), but a future contributor will not know that without reading LESSONS. A single `src/lib/normalizeName.js` with named exports (`normalizeForExactMatch`, `normalizeWithDiacritics`, `normalizeSimple`) would document the contract.

### C2.4 — `boutMatchesComp` exists in App.js AND FightDetailView (P2)

`App.js:50-60` and `FightDetailView.js:148-153` — both implement the same fuzzy comparison. App.js uses `normPollName` + last-name match; FightDetailView uses `matchesFighter` (richer). The behaviors are not identical — the FightDetailView version handles more edge cases (first-name prefix, Chinese name reorder). Risk: ESPN match works in fight detail but not in event-level poll for the same fight. Worth consolidating to the richer `matchesFighter` in both places.

## §3. Console output left behind

Full grep results in body. Most are legitimate error logs. Categorize:

**Legitimate** (kept in production for ops): all `console.error` / `console.warn` paths in `dataService.js`, `App.js` poll handlers, `RoundScoringPanel`, `Leaderboard`, etc. These help debug user-reported issues.

**Should be removed:**

### C3.1 — `FightDetailView.js:404-409` debug logs (P1 noise)

```js
console.warn(`[FightDetail] No judge_scores rows for date=${...}`);
console.log(`[FightDetail] judge_scores fighters on ${...}:`, jsNames);
console.log(`[FightDetail] Looking for: "${m.fighter1_name}" / "${m.fighter2_name}"`);
console.log(`[FightDetail] normName f1="${...}" f2="${...}"`);
```

These run on **every fight detail page load** in production. They dump fighter names and normalized strings. Three issues:
1. Noisy — pollutes devtools for every user.
2. Subtle info leak — names+dates aren't sensitive, but the pattern is wrong; if a future bug ever surfaces a user ID or token in a fighter name through templating, it lands in console immediately.
3. Performance — 3-4 console calls per fight load add up on slow phones.

These look like debugging instrumentation that was never cleaned up. The warn-only version (no rows found) is arguably useful — keep that, drop the 3 `console.log`s.

## §4. Components doing data fetching that should be in dataService

### C4.1 — `Leaderboard.js:27-30` and `FightDetailView.js:226-234` call `supabase` directly (P2)

- `FightDetailView.js:227-233` — direct `supabase.from('user_round_scores').select('id', { count: 'exact', head: true })`. This is the "has user scored anything?" check. Could be a `dataService.hasUserScoredFight(fightId)` helper.
- `FightDetailView.js:362-365` — direct `supabase.from('fights').select(...)` to re-sync after FINAL write. Could be a `dataService.getFightLiveState(fightId)`.
- `FightDetailView.js:298-306` and `App.js:413-424` — `fetch` to Edge Function directly. Could be a `dataService.recordFightStatus(...)`.
- `ScorecardComparison.js:62-68` — direct `supabase.from('user_round_scores').select(...).eq(...)`. Could be a `dataService.getUserScoresForFight(fightId)`.
- `App.js:540, 624, 805` — direct `supabase.from('ufc_events').select(...).in(...)`. Could be a `dataService.getEventDatesByName(names)`.
- `App.js:517` — `supabase.from('ufc_events').select('event_date')` for the year list. Could be a `dataService.getEventYears()`.
- `App.js:619` — `supabase.from('user_votes').select(...).eq(...)`. Could be a `dataService.getUserVotes(userId)`.

None of these are bugs — they're just architecture drift. dataService was the intended single read/write surface; component-direct queries grew during feature work. Worth a one-PR consolidation when convenient.

## §5. TODO / FIXME / XXX

`grep -n 'TODO\|FIXME\|XXX'` → **0 matches in `src/`**. Clean.

Note: `context/phase6-architecture.md` mentions `TODO: setter in profile UI (deferred)` for `display_name` — that's a doc TODO, not a code TODO.

## §6. Stale tests / vestiges

### C6.1 — `src/App.test.js` is NOT a test file (P1) — see also `09-tests.md §2`

`src/App.test.js` matches the Jest test glob, but the content is a 200+ line stale snapshot of the App component (header comment "working theme / working year selection" suggests it was a manual test plan that became a code copy). Running `npm test -- App.test.js` would attempt to execute this as a test file. It defines a `FightCard` component but has no `describe` / `it` / `expect` blocks, so Jest will report "no tests found" or fail to parse if there are React component issues.

This is the only fake-test in the file tree (`guestStorage.test.js` is real). Move or delete.

## §7. Misc

### C7.1 — `Login.js` is still pre-Phase-8 inline styling (P1) — see `05-ui-ux.md §1`

`Login.js:8-15` uses inline `style={{ background: '#1a1a1a' ...}}` and the Supabase Auth UI `<Auth theme="dark">`. No Pulse tokens. First impression a new user gets is **not** the Pulse design.
