# 01 — Functional Bugs

## §1. View state machine (`src/App.js`)

The state machine is driven by `currentView` ∈ {events, fights, fightDetail, dna, judges, judgeProfile, judgeComparison, userJudgeComparison, leaderboard, profile}. Traced end-to-end. Findings:

### F1.1 — `previousView` is single-slot — back-button history loses depth (P2)

`App.js:236` — `previousView` is a scalar. When the user goes `events → fights → fightDetail → (back via popstate) → events`, that's fine because popstate is tracked separately. But the in-app "Back" buttons rely on `previousView` and only remember one level. Example: `judges → judgeProfile → judgeComparison → fightDetail`. From fight detail, "back" goes to whatever `previousView` is at that moment — which is set in `handleFightClick` to whatever `currentView` was when the fight was clicked (`judgeComparison`). On returning, `previousView` is still `judgeComparison`, but if the user now clicks a different fight from `judgeProfile`, the prior depth is lost. Not user-blocking — Android back button (`popstate`) covers full depth. Worth a comment near `App.js:283`.

### F1.2 — Story progress bar `sectionDepth` switch is brittle (P2)

`App.js:898-921` — hand-coded depth table per (`navTab`, `currentView`, `previousView`). New views added later (e.g. a future "settings" sub-page) will silently fall through to the `default: { total: 3, active: 0 }`. Worth a TODO or a data-driven map.

### F1.3 — `For You` recommendations re-fetched on every `userHistory` change (P1)

`App.js:526-548` — the effect depends on `[selectedYear, combatDNA, userHistory, session, isGuest]`. Every vote anywhere updates `userHistory`, which retriggers the recommendation fetch even if the user is on `For You` and just voted on a different list. Mitigated by `setRecommendations(prev => prev.filter(f => f.id !== fightId))` at `App.js:722` removing the voted fight from the list — but the full RPC re-fetch still fires. Cost: one extra `get_fight_recommendations` call per vote when on the For You tab. Fix: split the effect, or gate on `selectedYear === 'For You'` deduplication of the trigger.

## §2. Guest mode parity

Every flow that reads/writes Supabase needs a guest fallback. Audit:

| Flow | Auth path | Guest path | Status |
|---|---|---|---|
| Vote | `dataService.castVote` | `guestStorage.setVote` | ✅ `App.js:745` |
| Round score | `dataService.upsertRoundScore` | `guestStorage.setScore` | ✅ `RoundScoringPanel.js:145` |
| Scorecard state | `dataService.upsertScorecardState` | `guestStorage.setScorecardState` | ✅ `RoundScoringPanel.js:141, 118` |
| Spoiler default | `dataService.updateProfile` | `guestStorage.setSpoilerDefault` | ✅ `App.js:511` |
| Community scorecard | RPC | RPC (read-only) | ✅ — guest can read |
| Judging DNA | `getUserJudgingProfile()` | **Skipped** | ✅ `App.js:377` |
| Scored Fights | `getScoredFights()` | **Skipped** | ✅ `App.js:384` |
| Scoring Insights | `getScoringInsights()` | **Skipped** | ✅ `App.js:391` |
| Leaderboard | `getLeaderboard()` | Public RPC, runs but row is N/A for guest | ✅ |

### F2.1 — `getScoredFights()` silently returns `[]` for guests (P2)

`dataService.js:198-199` — returns `[]` if no auth user. JudgingDNACard never renders for guests anyway (`App.js:377` skips the fetch), so this is fine — but if anyone ever surfaces "Scored Fights" outside the DNA view, the guest case is a silent no-op. Worth a one-line comment at the function entry stating the contract.

### F2.2 — Profile creation race (P2)

`App.js:504-507` — on first login `dataService.getProfile()` returns `null`, and the code falls back to `true` (default spoiler protection). The user then toggles spoiler off, `updateProfile({ spoiler_protection: false })` upserts a new row. There's no race here in the single-tab case, but multiple tabs opening simultaneously on first login will each `upsert` independently. `upsert` is idempotent so the worst case is two writes — not a bug, but flag for awareness.

## §3. Spoiler protection

Three trigger paths, all verified:

| Path | Trigger | Behavior |
|---|---|---|
| Per-user default | `profiles.spoiler_protection` / `getSpoilerDefault()` | Seeds `spoilerActive` on mount in `FightDetailView.js:215-217` |
| Per-fight toggle | "Spoiler protection on/off" button | `FightDetailView.js:710-721` |
| Auto-reveal — has existing scores | `useEffect([hasUserScores])` | `FightDetailView.js:239-241` |

### F3.1 — Spoiler auto-reveal on completed-no-meta path bypasses the spoiler check (P2)

`FightDetailView.js:702-704` — when `fight.status === 'completed' && !meta && scorableRounds > 0`, a `RoundScoringPanel` is rendered with `meta={null}`. Inside the panel, `totalRoundsOverride = scorableRounds` (correct), but the spoiler shield UI at `FightDetailView.js:723-741` only fires when `meta` is present. So a completed fight whose meta hasn't been scraped yet skips the spoiler shield entirely and shows the scoring panel directly. Behavior is correct (no winner is visible), but the UX is inconsistent with the meta-present path.

### F3.2 — Two render blocks fire simultaneously on completed-no-meta (P2)

`FightDetailView.js:697-704` — both the "Round stats not yet available" notice (line 697) and the scoring panel (line 702) render when `completed && !meta && scorableRounds > 0`. So the user sees the "stats pending" message AND the scoring panel stacked. Likely intentional ("stats pending + scoring panel"), but worth confirming the design intent.

## §4. Live event UI

Polling path matches `context/live-events.md`. Verified:

- ✅ 60s interval `FightDetailView.js:385`
- ✅ Stops on `fightEndedAt` `FightDetailView.js:288, 386`
- ✅ Event-level poll also runs in `App.js:401-478`
- ✅ `STATUS_FIGHTERS_WALKING` does NOT trigger live (`App.js:453` filters on `STATUS_IN_PROGRESS`/`STATUS_END_OF_ROUND` only) ✅
- ✅ `period = 0` guard at `FightDetailView.js:348` and `App.js` (mirror)
- ✅ `STATUS_FINAL` fallback to `scheduledRounds || 3` ✅

### F4.1 — Unknown ESPN status codes silently pass through (P2)

`FightDetailView.js:332-377` — only the four documented statuses (`STATUS_IN_PROGRESS*`, `STATUS_END_OF_ROUND`, `STATUS_FINAL`, and `STATUS_SCHEDULED`/`STATUS_FIGHTERS_WALKING` as no-ops) are handled. Anything else — e.g. `STATUS_DELAYED`, `STATUS_CANCELED`, `STATUS_POSTPONED` — falls through to `prevStatus = statusName; break` without any side effect, but never alerts. If ESPN changes their enum (they do, occasionally), the app silently ignores it forever. Minor — a `console.warn('[FightPoll] Unknown ESPN status', statusName)` would surface it.

### F4.2 — Local-date-only check for event-level poll (P2)

`App.js:403-406` — uses local-date (`new Date()` → format) to decide whether to poll. A user on UTC+12 viewing a US Saturday-night card just past local midnight will see the event tagged as "tomorrow" locally and the event-level poll will not trigger. The per-fight poll in `FightDetailView.js:287-388` uses `fight.event_date` directly, so it still works once the user enters fight detail. But on the event-list screen, the LIVE badge depends on `isLiveEvent` which uses local date (`App.js:852-862`) — same timezone hole. Mitigation: server-side `poll-live-fights` Edge Function already covers this; the client just won't auto-update. Low blast radius.

## §5. CLAUDE.md conventions — frontend implications

| # | Convention | Frontend audit |
|---|---|---|
| 1 | Join on `fight_url`, never `bout` | ✅ `getScoredFights()` joins meta via `fight_url` |
| 2 | `judge_scores.event_name` ≠ `fights.event_name` | ✅ `getFightDetail()` uses date ±1 day |
| 3 | `weight_class` vs `weight_class_clean` | ✅ `FightDetailView.js:495` prefers `weight_class_clean`, `FightCard` shows raw — matches spec |
| 4 | Order by `card_position ASC, id ASC` | ✅ `App.js:655` |
| 5 | Service key for scraper only | ✅ Verified — service key not in `src/` or build |
| 6 | Read from `fight_dna_metrics` view | ✅ `getDNAAndChartData` `dataService.js:29` |
| 7 | Bout name `Fighter1 vs Fighter2` | ✅ `App.js:72`, `FightDetailView.js:487` consistent split on `/ vs /i` |
| 8 | `normName()` for cross-source | ✅ `FightDetailView.js:104` + canonical-mirror comment at line 102 |
| 9 | Reversed-bout fallback | Handled in RPCs, not frontend — N/A |
