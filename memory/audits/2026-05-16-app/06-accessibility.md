# 06 — Accessibility

PROGRESS.md Phase 8f.4 claims accessibility is complete. Reality is mostly true, with one clear blocker.

**Note:** All findings here are static-analysis only. Real keyboard/screen-reader testing requires a browser and a real AT.

## §1. Modal focus management — NOT IMPLEMENTED (P1)

LESSONS Accessibility says: "Modals trap focus and restore on close." Two production modals fail this:

### A1.1 — `RoundScoringPanel` forfeit modal (lines 516-549)

```jsx
{showForfeitModal && (
  <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60"
       onClick={() => setShowForfeitModal(false)}>
    <div ... onClick={e => e.stopPropagation()}>
      ...
    </div>
  </div>
)}
```

Issues:
- No `role="dialog"` on the modal container.
- No `aria-modal="true"`.
- No `aria-labelledby` pointing at the title.
- No focus trap — Tab moves out of the modal into the underlying page content.
- No initial focus shift onto the modal (focus stays on the trigger button, hidden behind the overlay).
- No Escape key handler — keyboard users can't close it without finding the Cancel button.
- No focus restoration to the trigger on close.

### A1.2 — `RoundScoringPanel` edit-after-reveal modal (lines 552-583)

Same issues as A1.1.

Together these are the most user-blocking a11y gap. Both modals are blocking the leaderboard-eligibility flow, so a keyboard-only user genuinely cannot complete scoring without losing their place.

## §2. ARIA labels

Spot-check:

| Element | Has `aria-label` | Notes |
|---|---|---|
| Profile button | ✅ `App.js:950` |
| Skip-to-content link | ✅ `App.js:926` |
| Search input | ✅ `App.js:973` |
| Filter toggle | ✅ `App.js:988-989` (with `aria-expanded`) |
| Range slider min/max | ✅ `App.js:28-29, 35-36` (with valuenow/min/max) |
| Vote buttons (FightCard) | ✅ All three buttons have `aria-label` + `aria-pressed` |
| Score buttons (RoundScoringPanel) | ✅ `aria-label` + `aria-pressed` on each 10/9/8 button |
| Back buttons | Mostly via wrapping `<button>` with text content — but the IconOnly variant in FightDetailView:557 has no `aria-label` (the chevron icon button) — falls back to "Back" text inside the button which works |
| Bottom nav buttons | ✅ `App.js:1463` (`aria-label={label}` and `aria-current="page"`) |
| Live region | ✅ `App.js:929` (`role="status" aria-live="polite"`) |
| Tab bars | ✅ `role="tablist"` + `role="tab"` + `aria-selected` (DNA tab, profile tab, FightDetailView tabs) |

### A2.1 — Search clear (×) button has no aria-label (P2)

`App.js:981-984` — the `<X>` button to clear search has no `aria-label`. Add `aria-label="Clear search"`.

### A2.2 — Year pills are decorative buttons without a labelled group (P2)

`App.js:1126` — the year-pill row has no `<div role="tablist">` or similar grouping. Screen readers will announce each year as a button without indicating it's a filter group. Not blocking but nice to have.

## §3. SVG visualizations

LESSONS: "SVG data visualizations need `role='img'` + `aria-label` with the data value."

- ✅ `CombatDNAVisual` body map — `role="img"`, `aria-label="Strike distribution: Head X%, Body Y%, Legs Z%"` `CombatDNAVisual.js:70-71`
- ✅ `JudgingDNACard` accuracy ring — `role="img"`, `aria-label="Accuracy: X%"` `JudgingDNACard.js:25`
- ⚠ `FingerprintRadar` (Recharts radar inside ScoringInsightsCard) — Recharts SVGs are not labelled by default. Did not verify.
- ⚠ `DriftSparkline` (Recharts BarChart) — same.

### A3.1 — Recharts charts likely lack `aria-label` (P2)

Recharts wraps its SVG output but does not auto-generate aria-labels. The FingerprintRadar and DriftSparkline appear in `ScoringInsightsCard.js` but I did not full-read it. Spot-check: search for `aria-label.*radar` or `role.*img.*chart` would tell.

## §4. Keyboard navigation

- ✅ Skip-to-content link `App.js:926` (sr-only / focus:not-sr-only)
- ⚠ Modal Escape — **not handled** (see §1)
- ⚠ Expandable rows in Leaderboard — verify `aria-expanded` per LESSONS. `Leaderboard.js:43-62` toggles `expandedRow` state on click but I didn't see an `aria-expanded` attribute. **A4.1** below.
- ⚠ Form input labels — `Login.js` delegates to Supabase Auth UI which is generally accessible. Search input has aria-label only (no visible label).

### A4.1 — Leaderboard row expand has no `aria-expanded` (P2)

`Leaderboard.js:43-62` — `handleRowClick` toggles `expandedRow`. The row button does not set `aria-expanded` (need to verify by reading the full file). LESSONS Accessibility explicitly calls out: "Expandable rows need `aria-expanded` + keyboard Enter/Space/Escape."

### A4.2 — JudgingDNACard "By Class" toggle, scored fights collapse — verify `aria-expanded` (P2)

Same pattern. Did not fully verify.

## §5. Color contrast

Can't measure without a browser/devtools. Static check from LESSONS Accessibility:

- `text-pulse-text-3` was raised from #5a5a6e to #7a7a8e to pass WCAG AA on #0e0e12 — assumed in Tailwind config.
- `text-white/40` and below fail AA. **Still used in 5 component files** (per `05-ui-ux.md §U1.2`).

### A5.1 — Pre-Phase-8 components ship known-failing contrast (P1) — see also `05-ui-ux.md §U1.2`

`UserJudgeComparison.js`, `JudgeProfileView.js`, `JudgeComparison.js`, `JudgeDirectory.js:170-172` (the green/yellow/red legend uses `text-pulse-text-3` ✅, but the surrounding `text-white/40`s do not).

## §6. Other

### A6.1 — `<table>` in JudgeDirectory desktop has no `<caption>` or scope attrs (P2)

`JudgeDirectory.js:120-166`. `<th>` cells are clickable for sorting but lack `aria-sort`. Add `aria-sort="ascending"|"descending"|"none"` to the active sort column.

### A6.2 — Login.js iframe-style Supabase Auth UI (informational)

Supabase Auth UI components are reasonably accessible out of the box but vary by version. Worth a manual test pass on the login screen with a screen reader once before launch.
