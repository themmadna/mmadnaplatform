# 05 — UI / UX Consistency (Pulse Design System)

**Note:** Most claims here are static-code-only. I could not load the app in a browser. Per the prompt: where a finding requires visual verification, I say so explicitly.

## §1. Pulse tokens — pre-Phase-8 leftovers still in production (P1)

PROGRESS.md marks Phase 8 ✅. The reality is that **five user-facing surfaces still use the pre-Phase-8 gold/dark theme**:

### U1.1 — `#D4AF37` (gold) still hardcoded in 5 files

```
src/components/UserJudgeComparison.js   — 5 occurrences (lines 88, 92, 103, 135, 157)
src/components/JudgeProfileView.js      — 6 occurrences (lines 22, 96, 109, 124, 127, 134)
src/components/JudgeComparison.js       — 5 occurrences (lines 80, 84, 95, 127, 160)
src/components/JudgeDirectory.js        — 2 occurrences (lines 67, 128)
```

These should be `text-pulse-red` / `text-pulse-amber` / similar. They directly contradict LESSONS "Concept D (Pulse)" entry.

### U1.2 — `text-white/40` (pre-Pulse text-tertiary) still used

`UserJudgeComparison.js:88, 95, 135, 157`, `JudgeProfileView.js:96, 109, 124, 127`, `JudgeComparison.js:80, 127, 160` — should be `text-pulse-text-3`.

Per LESSONS Accessibility: "`text-white/40` and below fail WCAG AA. Replace with `text-pulse-text-3` (now #7a7a8e) or use `text-white/60` minimum for body text." These violations exist in shipped code.

### U1.3 — DualBar in UserJudgeComparison uses blue+amber, not Pulse red+blue

`UserJudgeComparison.js:33-37` — `bg-blue-500/60` and `bg-amber-500/60`. Pulse standard (per `RoundScoringPanel`, `FightDetailView`, `ScorecardComparison`) is `bg-pulse-red` for f1/striking and `bg-pulse-blue` for f2/grappling. The blue+amber pattern is left from an earlier mockup.

### U1.4 — `Login.js` still uses inline `style` and dark gold theme

`Login.js:8-15` — `style={{ background: '#1a1a1a', borderRadius: '8px', ... }}` with `theme="dark"` Supabase auth UI. First impression a new user gets is pre-Phase-8. The continue-as-guest link uses `style={{ color: '#9ca3af' }}`.

### Why this matters

PROGRESS.md claims Phase 8 is complete (✅). The companion `context/phase6-architecture.md` describes Pulse as the chosen design. A new contributor reading these docs and then opening `JudgeDirectory.js` will assume the gold token is intentional and propagate it. This is precisely the "deprecation rule" violation from CLAUDE.md: when replacing existing architecture, find every file that references the old approach and update all of them in the same session.

## §2. Loading states

Phase 8f.1 claim: "Skeleton loading states — FightDetailView, RoundScoringPanel, ScorecardComparison, App.js event/fight lists."

Verified:
- ✅ App.js event/fight lists — `App.js:1133-1149, 1172-1180, 1217-1238` (4-card and per-row skeletons)
- ✅ FightDetailView — `FightDetailView.js:567-606` (avatar header + tab bar + 5 stat rows skeleton)
- ✅ RoundScoringPanel — `RoundScoringPanel.js:204-240`
- ✅ ScorecardComparison — `ScorecardComparison.js:178-203`

Phase 8f.1 claim does NOT cover:

### U2.1 — `JudgeDirectory.js:56-62` shows "Loading judges..." plain text (P2)

```jsx
return (
  <div className="flex items-center justify-center py-20 text-pulse-text-3 text-sm">
    Loading judges...
  </div>
);
```

### U2.2 — `UserJudgeComparison.js:111-113` and `:138` use plain "Loading..." text (P2)

```jsx
<p className="text-white/30 text-sm text-center py-8">Loading...</p>
<div className="flex items-center justify-center py-20 text-white/40 text-sm">Loading comparison...</div>
```

### U2.3 — `JudgeProfileView` / `JudgeComparison` (P2)

I did not full-read these but the same `text-white/40` patterns suggest they too lack skeleton loaders. Worth verification.

### U2.4 — Leaderboard skeleton — verify

The Leaderboard component starts with `loading = true` and renders 3 skeleton rows per the architecture doc. I did not visually verify, but the `loading` state path is wired (`Leaderboard.js:24-41`). ✅ presumed.

## §3. Empty states

Required empty states (per prompt):
- ✅ Events list — `events.map` falls through to skeleton when loading; empty array renders nothing. **No "no events" empty state if `events` is empty after fetch.** Minor; this would only happen for a year with no events, which shouldn't happen.
- ✅ Fights — `App.js:1239-1240` "No fights found for this event."
- ✅ Scored fights — JudgingDNACard handles `scoredFights.length === 0` via the collapsible header showing `0`.
- ✅ Leaderboard — `Leaderboard.js` has Trophy empty state per architecture doc.
- ✅ Judge directory — judges list is always > 0; LESSONS notes 74 judges. No designed empty state, but mathematically n/a.

### U3.1 — Search returns no results — has empty state (P2 — copy)

`App.js:1104-1106` — "No fights match your criteria." Plain text, no graphic. Phase 8 mockups likely had something nicer. Low priority.

### U3.2 — `For You` empty state shows correctly

`App.js:1164-1166` "No recommendations found. Try rating more fights!" ✅

## §4. Error states

Required:
- ✅ FightDetailView load error — `FightDetailView.js:610-614`
- ✅ Leaderboard load error — try/catch sets `rows = []`, falls into empty state. Acceptable.
- ⚠ Search/filter error — `App.js:582-585` and `App.js:610-614` `console.error` and clear results, no UI message. User sees "Found 0 fights" with no indication why.
- ⚠ Recommendations error — silently returns `[]`. User sees "No recommendations found."

### U4.1 — No distinct "we couldn't reach the server" state (P2)

When the network is flaky, the app degrades silently to empty states. A user can't distinguish "no data" from "data couldn't load." Worth a generic toast/banner pattern. Marginal.

## §5. Touch targets

Phase 8f.3 claim: ≥ 44px minimum.

Spot-checked:
- ✅ Year pills `App.js:1126` — `py-2.5 min-h-[44px]`
- ✅ Tab buttons in FightDetailView — `min-h-[44px]`
- ✅ Sort pills in JudgeDirectory — `min-h-[44px]`
- ✅ Vote buttons — `py-2.5` × icon size ≈ 44px
- ✅ Score buttons (RoundScoringPanel) — 72px ✅

### U5.1 — Spoiler toggle button is below 44px (P2)

`App.js:1427` — the spoiler protection toggle in profile. Inline switch: outer `w-12 h-6` (48×24px). Touch target is the parent button, which has `py-3 px-4` ≈ 44×40+. Borderline. Visually verify on device.

### U5.2 — JudgeDirectory desktop `<table>` cells use `py-3.5` (~14px height) (P2)

`JudgeDirectory.js:143, 147, 151, 154, 157` — table rows on desktop. Below 44px but desktop is mouse, so 44px touch target rule doesn't apply. ✅

## §6. Mobile-first audit

Per prompt: 90% of users on mobile/tablet. Phase 8 designed mobile-first.

- ✅ `max-w-mobile` (430px) wrapper enforces mobile viewport simulation on desktop too.
- ✅ `hidden md:block` patterns in JudgeDirectory (table desktop / cards mobile).
- ⚠ **Cannot verify mobile rendering without a browser.** No assertions made about layouts, overflow, scrolling, fade-edge masks visibility on actual devices.

## §7. Animations / transitions

Phase 8f.2 claim verified by spot-check:
- ✅ Stagger fight cards — `App.js:90-91` `animationDelay: ${index * 60}ms`
- ✅ `active:scale-[0.94]` on small buttons, `active:scale-[0.98]` on large cards — pervasive
- ✅ Tab cross-fade — `animate-in fade-in duration-300` on tab content

No issues.
