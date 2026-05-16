# 99 — Follow-ups Backlog

Every actionable finding from this audit, with severity, source file/line, proposed fix sketch, and whether changes were applied.

**Status:** Read-only audit. **Zero changes have been applied.** All items below are proposed; defer to Bastian for triage.

---

## P0

_None._

---

## P1

### F1 — Pulse design regression in 5 components

**Files:** `src/Login.js`, `src/components/JudgeDirectory.js`, `src/components/JudgeProfileView.js`, `src/components/JudgeComparison.js`, `src/components/UserJudgeComparison.js`
**Refs:** `05-ui-ux.md §1`, `06-accessibility.md §5`
**Fix:**
1. Replace every `text-[#D4AF37]` / `border-[#D4AF37]/...` / `hover:text-[#D4AF37]` with `text-pulse-red` / `text-pulse-amber` / `border-pulse-red` (designer call — was the intent gold? then add a Pulse `gold` token to Tailwind config).
2. Replace `text-white/40` → `text-pulse-text-3`; `text-white/30` → `text-pulse-text-3`.
3. DualBar in UserJudgeComparison: swap `bg-blue-500/60` / `bg-amber-500/60` → `bg-pulse-blue` / `bg-pulse-red` (or match the user/judge semantics — pick one).
4. `Login.js`: rewrite with Pulse tokens. Wrap in `bg-pulse-bg`, use Pulse buttons.
**Status:** Not applied.

### F2 — Modals lack focus trap + Escape + restoration

**File:** `src/components/RoundScoringPanel.js:516-583` (two modals)
**Ref:** `06-accessibility.md §1`
**Fix:** Either:
- (a) Adopt a headless dialog lib (`@radix-ui/react-dialog`) — adds bundle weight.
- (b) Hand-roll: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, a focus-trap ref hook (capture initial focus on mount, restore on unmount, intercept Tab to wrap, handle Escape).
**Status:** Not applied.

### F3 — Verbose debug `console.log`s on every fight detail load

**File:** `src/components/FightDetailView.js:407-409` (3 `console.log` calls)
**Ref:** `03-components.md §C3.1`
**Fix:** Delete lines 407, 408, 409. Optionally keep the `console.warn` at line 404 (the "no judge_scores rows" notice — still useful for ops).
**Status:** Not applied.

### F4 — `src/App.test.js` is a stale App snapshot, not a test

**File:** `src/App.test.js`
**Refs:** `03-components.md §C6.1`, `09-tests.md §2`
**Fix:** Delete the file, or move outside `src/` to e.g. `archive/old-app-snapshot.js`. The header comment ("// working theme / working year selection / ...") could be salvaged as a Playwright test plan if useful.
**Status:** Not applied.

### F5 — `src/App.js copys/` and `src/dataService.JS copys/` — 220 KB of committed dead code in `src/`

**Refs:** `03-components.md §C1.1`, `08-build-deps.md §B6.1`
**Fix:** Delete both directories, OR move to `archive/` at repo root + add `archive/` to `.gitignore`.
**Status:** Not applied.

### F6 — Sign-out doesn't clear guest sessionStorage

**File:** `src/App.js:787-790` (`handleSignOut`)
**Ref:** `07-auth-security.md §3`
**Fix:** Add `sessionStorage.removeItem(...)` for the five `ufc_guest_*` keys. Optionally also reset state (userHistory, combatDNA, etc.) and call `setIsGuest(false)`.
**Status:** Not applied.

### F7 — No memoization anywhere; render thrash on every state change

**Refs:** `04-performance.md §3`
**Fix (incremental):**
1. Hoist `FightCard`, `DualBar`, `StatRow`, `RangeSlider` out of inline definitions and wrap with `React.memo`.
2. Add `React.memo` to `JudgingDNACard`, `ScoringInsightsCard`.
3. Wrap `handleVote`, `handleFightClick`, `handleEventClick` with `useCallback`.
**Status:** Not applied. Worth measuring in devtools profiler before optimizing.

### F8 — `For You` re-fetches recommendations on every vote

**File:** `src/App.js:526-548`
**Refs:** `01-functional-bugs.md §F1.3`, `04-performance.md §P4.2`
**Fix:** Split the effect — load recommendations only when `selectedYear === 'For You'` is entered, not on every `userHistory` change.
**Status:** Not applied.

---

## P2

### F9 — `npm audit` — 40 vulns; safe fixes available

**Ref:** `08-build-deps.md §B2.1`
**Fix:** `npm audit fix` (without `--force`) and re-test. Defer the `--force` migration (breaks react-scripts).

### F10 — `web-vitals` ships but does nothing

**File:** `src/index.js:18`
**Ref:** `04-performance.md §P2.1`
**Fix:** Either wire `reportWebVitals(...)` to an endpoint, or remove the import and the `web-vitals` dep.

### F11 — Duplicate `import './index.css'` in `src/index.js`

**File:** `src/index.js:3, 6`
**Ref:** `04-performance.md §P2.2`
**Fix:** Remove one of the two.

### F12 — Three different name normalizers across the codebase

**Files:** `App.js:47`, `FightDetailView.js:104`, `JudgingDNACard.js:9`
**Ref:** `03-components.md §C2.3`
**Fix:** Consolidate to `src/lib/normalizeName.js` with three named exports documenting the intentional differences.

### F13 — `boutMatchesComp` duplicated with different semantics

**Files:** `App.js:50-60`, `FightDetailView.js:148-153`
**Ref:** `03-components.md §C2.4`
**Fix:** Move to `src/lib/espnMatch.js`. Use the richer FightDetailView version in both places.

### F14 — `getInitials` duplicated in 4+ files

**Ref:** `03-components.md §C2.2`
**Fix:** Move to `src/lib/names.js`.

### F15 — Components calling `supabase` directly instead of going through `dataService`

**Files:** `FightDetailView.js:227, 362`, `ScorecardComparison.js:62`, `Leaderboard.js:27`, `App.js:517, 540, 619, 624, 805`
**Ref:** `03-components.md §C4.1`
**Fix:** Migrate to `dataService` helpers when convenient. Not urgent.

### F16 — `getUserScoringData` has no try/catch wrapper

**File:** `src/dataService.js:152-167`
**Ref:** `02-data-fetching.md §G1.1`
**Fix:** Wrap in try/catch, return `{ user, scores: [], scorecardState: null }` on error.

### F17 — ESPN polling fires when tab is hidden

**Files:** `App.js:475`, `FightDetailView.js:385`
**Ref:** `04-performance.md §P6.1`
**Fix:** Add `visibilitychange` listener; pause/resume the interval.

### F18 — `getJudgeDirectory` re-fetched every time UserJudgeComparison mounts

**File:** `src/components/UserJudgeComparison.js:61`
**Ref:** `04-performance.md §P6.2`
**Fix:** Cache in App.js state or a module-scoped Map.

### F19 — Modal aria + Escape (lower-severity than focus trap)

**Refs:** `06-accessibility.md §A1.1, §A1.2`
**Fix:** Even before adding full focus trap, add `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, and an Escape key handler. These are 3-line wins.

### F20 — Leaderboard / JudgingDNA expandable rows lack `aria-expanded`

**Files:** `Leaderboard.js:43-62` (and similar in JudgingDNACard, ScoringInsightsCard)
**Ref:** `06-accessibility.md §A4.1, §A4.2`
**Fix:** Add `aria-expanded={isExpanded}` to the row button.

### F21 — `JudgeDirectory` desktop table — no `aria-sort`

**File:** `src/components/JudgeDirectory.js:120-135`
**Ref:** `06-accessibility.md §A6.1`
**Fix:** Add `aria-sort` to the active sort column header.

### F22 — Search clear (×) button missing `aria-label`

**File:** `src/App.js:981-984`
**Ref:** `06-accessibility.md §A2.1`
**Fix:** Add `aria-label="Clear search"`.

### F23 — JudgeDirectory / UserJudgeComparison loading states are plain text

**Files:** `JudgeDirectory.js:56-62`, `UserJudgeComparison.js:111, 138`
**Ref:** `05-ui-ux.md §U2.1, §U2.2, §U2.3`
**Fix:** Replace with skeleton loaders matching the Pulse pattern used elsewhere.

### F24 — Search/recommendation errors are silent

**Refs:** `05-ui-ux.md §U4.1`
**Fix:** Surface a toast/banner on persistent network failure.

### F25 — Unknown ESPN status codes silently ignored

**File:** `src/components/FightDetailView.js:332-377`
**Ref:** `01-functional-bugs.md §F4.1`
**Fix:** Add `console.warn` on unrecognized status names so future ESPN enum changes are visible in ops logs.

### F26 — Recharts `aria-label` likely missing on FingerprintRadar / DriftSparkline

**Files:** `src/components/ScoringInsightsCard.js`
**Ref:** `06-accessibility.md §A3.1`
**Fix:** Wrap each Recharts component in a `<div role="img" aria-label="...">` describing the rendered data.

### F27 — Multiple `eslint-disable react-hooks/exhaustive-deps` should be reviewed

**File:** `src/App.js`, `src/components/FightDetailView.js`, others
**Ref:** `04-performance.md §P4.1`
**Fix:** Single sit-down pass to confirm each disable is intentional. None are obviously wrong, but they accumulate.

---

## Cross-references

- **Companion Supabase audit:** `memory/audits/2026-05-16/` — 3 P0s + 4 P1s + 7 P2s, all server-side. No frontend changes required for those.
- **April security audit:** `memory/audits/2026-04-14/` — informed several "✅ already fixed" items above (RLS, build/ gitignore, anon-key prefix).
- **LESSONS.md** — every finding above respects the recorded learnings (no recommendation reopens a solved problem).
