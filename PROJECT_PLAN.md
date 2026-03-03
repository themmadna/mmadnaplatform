# UFC Web App — Project Plan

---

## Phase 1: Codebase Review & Hardening — complete

All bugs, performance issues, dead code, and UX gaps identified and fixed. Full detail in git history.

### Deferred (low priority, not yet actioned)
- [ ] Initial "Loading..." spinner is unstyled
- [ ] Back button loses year/scroll position
- [ ] Year tabs have no scroll affordance on mobile
- [ ] Redundant DNA headers
- [ ] CombatScatterPlot mobile responsiveness
- [ ] `fetchYears` optimisation — query already light (~6KB); true distinct requires a DB function

---

## Phase 2: Data Cleanup — complete

- judge_scores fully re-scraped with clean fighter names (link text, not URL slugs)
- Historical backfill complete (2007–2026): 5,412 complete, 55 partial, 678 missing (pre-2010 / no mmadecisions data)
- Phase 6 added to master pipeline: `sync_judge_scores()` calls `scrape_mmadecisions.py --yes` automatically
- `judge_scores_coverage` view built — SQL in `supabase/views/judge_scores_coverage.sql`

---

## Phase 3: Predictive Scoring Feature

### 3a + 3b — complete
FightDetailView built with round-by-round stats, judge scorecards, and fuzzy cross-source name matching.
Rules-based `scoreRound()` in FightDetailView.js is a temporary placeholder pending Phase 3c.
`validate_scoring_model.py` measures agreement rate vs judges (overall, per judge, per weight class).

### 3c. ML Scoring Model — Python training pipeline

#### Step 1: Data extraction
- [ ] Script to join `round_fight_stats` + `judge_scores` using normalized name matching (same logic as frontend)
- [ ] Export matched dataset to CSV: one row per (fight, round, judge) with fighter stat differentials and judge winner label
- [ ] Report how many rounds matched cleanly vs had name mismatches (data quality baseline)

#### Step 2: Exploratory data analysis
- [ ] Distribution of round winners (how often does the fighter with more sig strikes win the round per judge?)
- [ ] Feature correlations — which stats most predict the judge's decision?
- [ ] Class balance — how common are 10-8 rounds in the data?
- [ ] Compare rules-based model accuracy to a naive "more sig strikes wins" baseline

#### Step 3: Feature engineering
- [ ] Compute differential features per round: f1_stat - f2_stat for each stat column
- [ ] Add ratio features: sig_strike_acc_diff, takedown_acc_diff
- [ ] Decide on 10-8 prediction: binary (win/lose round) first, then optionally multi-class (10-9 / 10-8 / 10-10)

#### Step 4: Train general model
- [ ] Train logistic regression on all fights — interpretable baseline
- [ ] Train random forest / XGBoost — likely more accurate
- [ ] Cross-validate (time-based split: train on older fights, test on recent)
- [ ] Compare accuracy vs rules-based model and naive baseline

#### Step 5: Per-weight-class analysis
- [ ] Train separate models per weight class
- [ ] Compare per-class accuracy vs general model — does specialisation help?
- [ ] Identify which weight classes the general model struggles with most

#### Step 6: Per-judge analysis
- [ ] For judges with 50+ scored rounds, train judge-specific models
- [ ] Compare per-judge accuracy vs general model — do judges weight strikes vs grappling differently?
- [ ] Identify the most "predictable" and "unpredictable" judges

#### Step 7: Model selection & export
- [ ] Pick the best model(s) based on validation accuracy
- [ ] Export model coefficients/weights to JSON (for logistic regression this is straightforward)
- [ ] OR pre-compute round predictions and store in DB if model is too complex for client-side

#### Step 8: Integrate into app
- [ ] Replace rules-based `scoreRound()` in FightDetailView.js with ML model predictions
- [ ] If per-weight-class models are used, select correct model based on `meta.weight_class`
- [ ] Show model confidence alongside predictions (probability of winner, not just binary)

**Note:** For fights that didn't go to decision (KO/TKO/sub), the model can still score completed rounds before the finish using `round_fight_stats`. A fight ending in round 3 has full stats for rounds 1 and 2. This extends the model's value well beyond the ~40% of fights that go to decision.

---

## Phase 4: Judge Profile Pages

One page per judge. Data source: `judge_scores` joined with `round_fight_stats` and `fight_meta_details`.
All analysis feasible with current data. Min threshold: 50+ rounds judged to avoid noise.

### 4a. Style Preference
Correlate round winner (per judge) with stat differentials (sig strikes, takedowns, control time).
Show as radar vs league average — "Strikes-heavy", "Grappling-friendly", "Control time matters", etc.

### 4b. Consensus & Controversy
- Outlier rate — % of rounds where they are the lone dissenter vs the other two judges
- Most controversial decision — the fight where their card deviated most from the other two
- Rank all judges by outlier rate (most/least predictable)

### 4c. 10-8 Round Tendency
Count 10-8 rounds as % of total rounds judged, broken down by weight class.

### 4d. Weight Class Breakdown
Outlier rate and style preference split by division.

### 4e. Era / Trend Analysis
Plot outlier rate and style preference weights by year — has their scoring changed over their career?

### 4f. Head-to-Head Judge Comparison
Style radar (overlaid), outlier rate, 10-8 frequency, rounds judged, years active, fights they disagreed on.

### 4g. Judge Leaderboard / Directory
Sortable table: rounds judged, outlier rate, 10-8 frequency, style tag. Click through to individual profile.

---

## Phase 5: Weight Class Analytics

One analytics page per division. All computable from existing tables — no new scraping needed.
Join key: `fight_meta_details.weight_class` (filter out non-standard/open weight bouts).

### 5a. Division Overview
Total fights, finish rate, avg fight duration, decision/KO/sub breakdown over time.
"Most exciting division" ranking by DNA violence index and finish rate.

### 5b. Style Trends Over Time
Per division: avg sig strikes, takedowns, control time per round by year.
Surface inflection points — is the division becoming more or less striker-heavy?

### 5c. Style Fingerprint per Division
Radar chart of each division's DNA vs UFC average. Compelling side-by-side comparison.

### 5d. Most Controversial Division
Which division has the highest judge outlier rate and most split decisions? (cross-ref Phase 4)

---

## Phase 6: User Round Scoring

Users score individual rounds themselves. Compare their card to judges, the ML model, and the community.

### Part A: Historical Fight Scoring — immediately buildable, no new data needed
- Add round scoring UI to FightDetailView: per round, pick Fighter A / Fighter B / Draw (+ optional 10-8)
- Store in new `user_round_scores` table (see schema below)
- After submitting: show their card vs each judge, vs ML model, vs community consensus
- Surface "controversial rounds" — rounds where community is split (e.g. 52% / 48%)

### Part B: User Scoring Profile
- Style preference radar (same analysis as judge profiles, but for the user)
- Agreement rate with official judges overall and per judge; agreement rate with ML model
- Most contrarian fights — where their card differed most from everyone else

### Part C: Controversial Decision Analysis
- Rank fights by community disagreement (rounds closest to 50/50 split)
- Fights where majority of users scored it differently from the judges
- Filterable by weight class, era, specific judge

### Part D: Live Scoring — future (requires live data source)
UFCStats only publishes stats after the fight ends. Options to investigate:
- ESPN unofficial MMA API (already used for event times) — probe for live fight data depth
- SportRadar — enterprise-level live UFC feed, likely expensive
- Crowdsourced live stats — users self-report, reconcile with official stats after

Build Parts A–C first (no blockers). Revisit live scoring once historical scoring has traction.

### New DB table: `user_round_scores`
```
user_id       text         (FK → auth.users)
fight_url     text         (FK → fights.fight_url)
round         int
winner_picked text         (fighter name or "draw")
score         text         ("10-9", "10-8", "10-10")
created_at    timestamptz
UNIQUE (user_id, fight_url, round)
```
