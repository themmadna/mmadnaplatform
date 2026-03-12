# Phase 6 Scoring Architecture Reference

RoundScoringPanel, ScorecardComparison, Judging DNA, and live scoring flow.
Update this file whenever Phase 6 component architecture or scoring flow changes.

---

## New Tables & Fields (Phase 6a)

Added to `fights`:
- `espn_competition_id` (text) — ESPN competition ID for live status polling
- `fight_started_at` (timestamptz) — set when ESPN returns STATUS_IN_PROGRESS
- `fight_ended_at` (timestamptz) — set when ESPN returns STATUS_FINAL
- `scheduled_rounds` (integer) — populated by Phase 5 ESPN sync
- `rounds_fought` (integer) — convenience int mirror of `fight_meta_details.round`
- `ended_by_decision` (boolean) — set by Edge Function on FINAL

New tables: `user_round_scores`, `user_fight_scorecard_state` — see [schema.md](schema.md).

---

## RoundScoringPanel (`src/components/RoundScoringPanel.js`)

### Key props
- `totalRoundsOverride` — used for live/upcoming fights to pass `scorableRounds` (bypasses meta-derived round count)
- `readOnly` — `judgesRevealed && !isHistorical && isLocked` — stays editable mid-fight for new rounds
- `onAllRoundsScored` — fires when `Object.keys(newScores).length >= totalRounds`

### Scoring schema
- `f1_score` / `f2_score` — both sides explicitly stored. Winner gets 10, loser gets 9/8/7.
- One row per `(user_id, fight_id, round)`. Upsert with `onConflict: 'user_id,fight_id,round'`.
- `upsertScorecardState` with `onConflict: 'user_id,fight_id'` — only provided columns written on conflict (partial updates safe).

### Scoreable rounds
- Decisions → all `meta.round` rounds
- Finishes → `meta.round - 1` (partial finishing round excluded from judging)
- Live/upcoming → `totalRoundsOverride` from `scorableRounds`

### Historical fights
- `judgesRevealed = true` from the start
- Every save marks `modified_after_reveal = true` → leaderboard-ineligible automatically
- `leaderboard_eligible` always false at DB level for historical fights — no code enforcement needed

### Guest path
- Loads/saves via `sessionStorage` (guestStorage.js)
- Shows "✓ Saved locally" instead of DB confirmation

### Auto-reveal
Only fires when `isLocked || isHistorical` — prevents premature lockout between live rounds.

---

## ScorecardComparison (`src/components/ScorecardComparison.js`)

### Gating
- Received `hasUserScores` prop from `FightDetailView`
- Before all rounds scored: shows "Score this fight to reveal the comparison" prompt
- After all rounds scored: shows full comparison

### Layout
Three-column per round: **User** | **Official judges (3 cards, last name)** | **Community avg**

- Green/red per row vs majority judge decision (2+ of 3)
- No colour if split 1-1-1
- Community avg hidden until user has scored

### Data
- `FightDetailView` does a lightweight count check on mount (`user_round_scores`) to seed `hasUserScores` for returning users
- Community avg: `getCommunityScorecard(fightId)` RPC
- Guest user scores: from `sessionStorage`; community still from DB

### Architecture notes
- Final Scorecard card removed — ScorecardComparison is the single place for all scorecard data
- Round stat cards show stats only (no model/judges) — everything scoring-related is in ScorecardComparison

---

## Judging DNA (`src/components/JudgingDNACard.js`)

### Data fetch
`dataService.getUserJudgingProfile()` → `supabase.rpc('get_user_judging_profile')` — NO params.
Fetched once on profile view open. Skipped for guests.

### RPC join strategy
- Gets all `judge_scores` rows matching EITHER fighter's last name (date ±1 + round)
- Pivots with `MAX(CASE ...)` to produce judge_f1_score/judge_f2_score per (fight, round, judge)
- Only keeps complete pairs (both NOT NULL) — prevents cross-fight name collisions
- Window function computes f1_wins/f2_wins/judges_agreeing per (fight_id, round); DISTINCT ON collapses to one row per round

### 6e.2 Stats (Phase 6e.2 Steps 1+2 — complete)
Sections in redesigned JudgingDNACard:
1. Overview strip (rounds scored, fights scored, accuracy, outlier rate)
2. Agreement breakdown — visual: all3 / 2of3 / 1of3 / 0of3
3. Judge match — closest judge name + agreement %
4. 10-8 section — rate + call quality together
5. Weight class breakdown — accuracy + rounds + avg loser score per class

### 6e.2 Step 3 — complete ✅
`round_fight_stats` join added to RPC. New CTEs in `get_user_judging_profile()`:
- `fight_stats_raw` — joins user_rounds → round_fight_stats via fmd_event_name+fmd_bout+round
- `fight_stats_pivoted` — one row per (fight_id, round); f1/f2 stats via last-name match
- `round_winner_stats` — derives winner/loser stats by user score (draws + incomplete rows excluded)
- `class_bias` — per-class striking/grappling bias (merged into accuracy_by_class)

New fields in RPC response: `striking_vs_grappling_bias`, `aggressor_bias`, `takedown_quality_bias`, `knockdown_bias`. `accuracy_by_class` now includes `striking_pct` and `grappling_pct`.

### 6e.2 Step 4 — complete ✅
"Scoring Tendencies" section added to `JudgingDNACard.js`:
- `SplitBar` component — two-tone bar (blue = striking, amber = grappling)
- "By Class ▾" toggle button switches Strike vs Grapple bar between overall and per-class rows
- 3-column stat grid: Aggressor Lean / Passive Control / KD Fighter
- Entire section gated on `hasBiasData` (`striking_vs_grappling_bias.rounds > 0`) — hidden when no `round_fight_stats` coverage
- `useState` for class toggle (only import added to component)

### 6e.2 Step 5 — complete ✅
Scored Fights collapsible section at the bottom of `JudgingDNACard.js`.

**Data:** `dataService.getScoredFights()` — 3-step client-side query:
1. `user_round_scores` for user → aggregate f1/f2 totals per fight_id
2. `fights` by fight_ids → event_name, bout, weight_class, fight_url, winner, status
3. Parallel: `fight_meta_details` by fight_url (fighter1_name, fighter2_name, weight_class_clean) + `ufc_events` by event_name (event_date)
Returns sorted by event_date desc. Passed as `scoredFights` prop; `onFightClick` passed from App.js.

**UI:** Collapsed by default. Header shows "Scored Fights N ▸". Each row:
- Green/red dot (normN comparison of user's pick vs fights.winner)
- Last-name vs last-name (from fighter1_name/fighter2_name, not fights.bout)
- Weight class + event name subline
- Scorecard total (e.g. "29–28 Poirier")
- Chevron; click calls onFightClick(sf) to navigate to fight detail

---

## FightDetailView Data Flow

- 2-trip fetch on load: meta first, then `round_fight_stats` + `judge_scores` in parallel
- `handleFightClick` spreads `event_date` into the fight object so FightDetailView has it for the judge_scores query
- `fight.scheduled_rounds` → `scheduledRounds` state; used before meta loads
- `scorableRounds` = `rounds_fought + ended_by_decision` (for completed fights)
- Render not gated on `meta !== null` — falls back to `fight.bout` string for header

---

## Leaderboard Eligibility Rules

| Scenario | `leaderboard_eligible` |
|---|---|
| Scored all rounds before judges revealed (live or historical before viewing) | ✅ true |
| Forfeited (chose to view judges mid-scoring) | ❌ false |
| Modified any score after judges revealed | ❌ false |
| Scored a historical fight with judges already visible | ❌ false |

Computed as `GENERATED ALWAYS AS (scored_blind AND NOT forfeited AND NOT modified_after_reveal) STORED` — no app-layer enforcement needed for historical case.
