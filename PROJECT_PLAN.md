# UFC Web App — Project Plan

Completed phases archived in `context/completed-phases.md`. Active and upcoming phases below.

Status markers: `[ ]` not started · `[~]` in progress · `[x]` complete · `[!]` blocked

---

## Completed

- **Phase 1** — Codebase Review & Hardening ✅ _(deferred: CombatScatterPlot mobile, fetchYears optimisation)_
- **Phase 2** — Data Cleanup ✅
- **Phase 3** — Predictive Scoring Feature (ML model) ✅
- **Phase 4.5** — Weight Class Normalization ✅
- **Phase 7** — Guest Mode ✅

---

## Phase 4: Judge Profile Pages

One page per judge. Min threshold: 50+ rounds judged. Data: `judge_scores` joined with `round_fight_stats` and `fight_meta_details`.

**Cross-source join strategy:** Use pair-matching — extract unique fighter pairs per event from `judge_scores`, score each pair against the target fight's fighters as a unit (`max(sim(a,f1)+sim(b,f2), sim(a,f2)+sim(b,f1))`). More robust than per-name matching; avoids cross-fight collisions.

- [ ] **4a. Style Preference** — correlate round winner (per judge) with stat differentials. Radar vs league average.
- [ ] **4b. Consensus & Controversy** — outlier rate, most controversial decision, judge rankings by outlier rate
- [ ] **4c. 10-8 Round Tendency** — count 10-8 rounds as % of total, by weight class
- [ ] **4d. Weight Class Breakdown** — outlier rate and style preference by division
- [ ] **4e. Era / Trend Analysis** — outlier rate and style preference by year
- [ ] **4f. Head-to-Head Judge Comparison** — overlaid radar, outlier rate, disagreements
- [ ] **4g. Judge Leaderboard / Directory** — sortable table, click through to individual profile

---

## Phase 5: Weight Class Analytics

One analytics page per division. All computable from existing tables. Join key: `fight_meta_details.weight_class_clean`.

- [ ] **5a. Division Overview** — total fights, finish rate, avg duration, decision/KO/sub breakdown over time
- [ ] **5b. Style Trends Over Time** — avg sig strikes, takedowns, control time per round by year
- [ ] **5c. Style Fingerprint per Division** — radar chart vs UFC average
- [ ] **5d. Most Controversial Division** — highest judge outlier rate and split decisions (cross-ref Phase 4)

---

## Phase 6: User Round Scoring & Judging DNA

### 6a. DB Migration — complete ✅
### 6b. Live Event Sync — complete ✅ _(deferred: schedule master scraper to auto-run on event day)_
### 6c. Scoring UI in FightDetailView — complete ✅

**Deferred UX improvements (to be built during 6e.2):**
- [ ] "View judges without scoring" option — triggers forfeit path (`forfeited = true`)
- [ ] Ineligibility warning modal — shown before forfeiting or before editing post-reveal scores. Confirmation step (cancel / proceed), not just dismissible notice

### 6d. Scorecard Reveal View — complete ✅
### 6e. Judging DNA Profile — complete ✅

### 6e.2 Judging DNA — Overhaul

**Steps 1+2 complete** (RPC overhaul + UI redesign). Current `get_user_judging_profile()` returns:
`rounds_scored`, `agreement_breakdown`, `outlier_rate`, `ten_eight_quality`, `accuracy_by_class` (with `rounds` + `avg_loser_score`).

**Step 3: RPC extension — round_fight_stats join**

Stats 5, 6, 7, 8, 12 require joining `round_fight_stats` per scored round.

- [ ] Add `round_fight_stats` join to RPC for each user-scored round
- [ ] Compute and return:
  - `striking_vs_grappling_bias` — winner's `sig_strikes_landed` diff vs (`takedowns_landed` + `control_time_sec`) diff → `{ striking_pct, grappling_pct }`
  - `aggressor_bias` — `sig_strikes_attempted` diff (volume) vs user award. Flag rounds where user sided with higher-volume fighter even when accuracy favoured opponent
  - `takedown_quality_bias` — "active ground" (`sub_attempts > 0` OR `ground_strikes > 3`) vs "passive control" (`ctrl_sec > 30`, low activity). % of passive-control rounds awarded
  - `knockdown_bias` — on KD rounds (`kd diff ≠ 0`), % of time user awarded the fighter with the KD
  - `bias_by_class` — striking vs grappling split per weight class (merge into `accuracy_by_class`)
- [ ] Redeploy via `supabase/deploy_judging_profile.py`

**Step 4: UI additions for Group B**

- [ ] Add bias/tendency section to `JudgingDNACard.js`:
  - Striking vs grappling bias bar (overall + by class toggle)
  - Aggressor bias indicator
  - Takedown quality bias
  - Knockdown bias stat

**Step 5: Scored Fights list**

- [ ] `getScoredFights(userId)` in `dataService.js` — fights user has scored with f1/f2 totals attached
- [ ] Tab or collapsible section at bottom of Judging DNA view
  - Fight card layout matching existing style (fighter names, event, weight class)
  - Replace like/dislike/fav with user's total scorecard (e.g. "29–28 {f1Last}")
  - Green/red dot indicating correct winner pick
  - Click navigates to fight detail

### 6f. Leaderboard — deferred

- [ ] Leaderboard page: rank users by accuracy % — overall and by weight class
- [ ] Only `leaderboard_eligible = true` scorecards count

---

## Build Order

6e.2 Step 3 → Step 4 → Step 5 → 6f (deferred) → Phase 4 → Phase 5
