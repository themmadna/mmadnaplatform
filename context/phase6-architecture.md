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

### 6e.2 Steps 3+4 (not yet implemented)
Requires `round_fight_stats` join in the RPC:
- `striking_vs_grappling_bias` — winner's sig_strikes_landed diff vs (td_landed + ctrl_sec) diff
- `aggressor_bias` — sig_strikes_attempted diff (volume) vs user's award
- `takedown_quality_bias` — active ground (sub_attempts > 0 OR ground_strikes > 3) vs passive control (ctrl_sec > 30)
- `knockdown_bias` — on KD rounds (kd diff ≠ 0), % awarding fighter with the KD
- `bias_by_class` — striking vs grappling split per weight class

### 6e.2 Step 5 (not yet implemented)
Scored Fights list — all fights user has scored with total scorecard (e.g. 29-28 {f1Last}) + green/red win indicator. `getScoredFights(userId)` in dataService.

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
