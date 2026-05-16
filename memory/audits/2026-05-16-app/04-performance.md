# 04 — Performance

## §1. Bundle size

`npm run build` output:

```
File sizes after gzip:
  255.25 kB  build/static/js/main.fa3d7b0c.js
  7.83 kB   build/static/css/main.c1abc22b.css
  1.76 kB   build/static/js/453.f9be4342.chunk.js
```

Pre-gzip: `main.fa3d7b0c.js` is **928 KB** uncompressed.

Threshold from prompt: flag > 500 KB pre-gzip. **Above threshold pre-gzip; well under post-gzip.**

### P1.1 — Bundle is shippable but unsplit (P2)

The 1.76 KB side-chunk means CRA is barely code-splitting. Main contributors to size: Recharts (~80-100 KB pre-gzip), `@supabase/supabase-js`, `lucide-react`, `@supabase/auth-ui-react`. Possible wins, in order of ROI:

1. `React.lazy()` on `LoginPage` — removes `@supabase/auth-ui-*` from main chunk. Users who land logged-in never need it. Small absolute win, but free.
2. `React.lazy()` on the DNA view (`JudgingDNACard`, `ScoringInsightsCard`, `CombatDNACard`, `CombatDNAVisual`) — pulls Recharts out of the initial chunk. Biggest single win, ~80-100 KB pre-gzip.
3. `React.lazy()` on the Judges section (`JudgeDirectory`, `JudgeProfileView`, `JudgeComparison`, `UserJudgeComparison`) — biggest LOC, but smaller third-party footprint.

None of this is urgent for 255 KB gzipped. Punt unless first-paint matters more than today.

## §2. Unused / underutilized dependencies

| Dep | Used | Notes |
|---|---|---|
| `@supabase/auth-ui-react` | ✅ Login.js | Could be lazy-loaded |
| `@supabase/auth-ui-shared` | ✅ Login.js | Same |
| `@supabase/supabase-js` | ✅ everywhere | — |
| `lucide-react` | ✅ everywhere | Tree-shaking via named imports — verified |
| `recharts` | ✅ ScoringInsightsCard | Could be lazy-loaded |
| `react`, `react-dom`, `react-scripts` | ✅ required | — |
| `web-vitals` | ⚠ shipped but inert — see P2.1 | |

### P2.1 — `reportWebVitals()` is called with no callback (P2)

`src/index.js:18` calls `reportWebVitals()` with no argument. From CRA's default impl, that means metrics are collected but discarded — no analytics endpoint, no logger. The `web-vitals` dep ships in the bundle for zero benefit. Either:
- Remove `reportWebVitals` and the `web-vitals` dep.
- Wire it to an endpoint (Vercel Analytics, Supabase function, console.log in dev).

### P2.2 — `index.css` imported twice in index.js (P2)

`index.js:3` and `index.js:6` both import `'./index.css'`. Webpack dedupes so no runtime cost, but it's noise. Remove one.

## §3. Memoization

`grep -rn "useMemo\|useCallback\|React.memo\|memo("` across `src/` (excluding copys) returned **zero matches**.

### P3.1 — No memoization anywhere; every state update re-renders the world (P1)

`App.js` is a 1475-line component with ~30 `useState` calls. Every vote, every keystroke in the search input, every poll tick triggers a re-render of the whole tree:

- `FightCard` re-renders even when its `fight` prop is unchanged.
- `JudgingDNACard` re-renders when search query changes (it's not even mounted, but if a user is on DNA view and the search box is updated elsewhere, every child re-evaluates).
- The ESPN poll `useEffect` updates `eventFights` every 60s with new objects, which re-renders the whole list even if no `fight.fight_started_at` actually changed.

Specific hotspots:
1. `FightCard` is mapped over `searchResults` (up to 400 fights), `eventFights`, `userHistory`, `recommendations` — wrapping with `React.memo` and an equality check on `(fight.id, fight.userVote, fight.ratings, locked)` would meaningfully reduce render thrash.
2. `JudgingDNACard` and `ScoringInsightsCard` are heavy renders (radar chart, multiple bars, multiple sections). They should at least be `memo`'d.
3. Inline component definitions: `RangeSlider` (App.js:19), `FightCard` (App.js:63), `DualBar` (FightDetailView.js:516), `StatRow` (FightDetailView.js:529) — these are defined inside the parent's render scope. Every parent re-render creates a new component identity, which means React unmounts/remounts the children. Move them to module scope (or memoize).

Practical impact: on a mid-range Android phone with 50+ rated fights in profile, voting feels sluggish. Not measured here (no browser); flagged based on code shape.

## §4. Re-render and `useEffect` deps

### P4.1 — Several `useEffect` deps disabled with `eslint-disable` — review (P2)

Counted ~10 `// eslint-disable-next-line react-hooks/exhaustive-deps` in `App.js` and `FightDetailView.js`. Each is a deliberate choice — for example `App.js:387` skips re-fetching the scored fights list on every `scoredFights` change. Most are defensible. Worth re-reading them in a single pass to confirm none is hiding a stale-closure bug.

### P4.2 — `App.js:548` recommendation effect re-fires on every vote (P2) — already in `01-functional-bugs.md §F1.3`

## §5. Image / SVG asset sizes

`public/`:
- `favicon.ico` — 3.9 KB
- `logo192.png` / `logo512.png` — 5 KB / 9 KB
- `scoring_model.json` — 2.6 KB

All small. No issues.

Inline SVG: `CombatDNAVisual.js` body map (~50 lines of paths) — small. `JudgingDNACard.js` accuracy ring — small. ✅

## §6. Network hot paths

### P6.1 — ESPN poll fires every 60s even when tab is hidden (P2)

`App.js:475` and `FightDetailView.js:385` — both intervals run regardless of `document.visibilityState`. A user with the tab in the background still hammers ESPN every minute. Add a `visibilitychange` listener that pauses/resumes the interval.

### P6.2 — `getJudgeDirectory` is fetched on every open of UserJudgeComparison (P2)

`UserJudgeComparison.js:61` always fetches the 74-row directory on component mount. Same data is loaded again every time the user re-enters the picker. Cache in a module-scoped Map or in App.js state.
