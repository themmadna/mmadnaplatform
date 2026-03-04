# UFC Web App — Project Plan

---

## Phase 1: Codebase Review & Hardening — complete

All bugs, performance issues, dead code, and UX gaps identified and fixed. Full detail in git history.

### Deferred (low priority, not yet actioned)
- [x] Initial "Loading..." spinner is unstyled
- [x] Back button loses year/scroll position
- [x] Year tabs have no scroll affordance on mobile
- [x] Redundant DNA headers
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
- [x] Script to join `round_fight_stats` + `judge_scores` using normalized name matching (same logic as frontend)
- [x] Export matched dataset to CSV: one row per (fight, round, judge) with fighter stat differentials and judge winner label
- [x] Report how many rounds matched cleanly vs had name mismatches (data quality baseline)
  - `scoring_model/build_ml_dataset.py` — cross-source join via date ±1 + 5-strategy fuzzy name match + unicode accent normalization
  - Result: 3,321/3,352 bouts matched (99.1%), 30,725 CSV rows, 100% round stats coverage
  - 31 unmatched bouts: 9 from UFC 311 (meta not yet scraped), ~8 systematic name mismatches (Josh Van, Yanal Ashmoz), ~14 scattered (name changes, accents beyond NFKD)

#### Step 2: Exploratory data analysis
- [x] Distribution of round winners — f1 wins 56.2% (positional bias confirmed → fixed via augmentation)
- [x] Feature correlations — sig_landed r=0.547, ctrl_sec r=0.446, kd r=0.196, reversals r=0.006 (dropped)
- [x] Class balance — draws 0.4%, 10-8 rounds 3.8% overall; women's title bouts highest at 12%
- [x] Baseline comparison — rules-based 81.0%, naive sig-strikes 77.2%
  - `scoring_model/eda_report.py`

#### Step 3: Feature engineering
- [x] 13 differential features (f1_stat - f2_stat); reversals dropped (r≈0), total_landed dropped (collinear)
- [x] 5 ratio features (f1/(f1+f2+1)) for sig_landed, head_landed, td_landed, ctrl_sec, ground_landed
- [x] post_2016 era flag — ended up coef≈0 (stats already capture the shift)
- [x] Symmetric augmentation: mirrored every row to eliminate f1-position bias; intercept converged to -0.000000

#### Step 4: Train general model
- [x] Logistic Regression: **82.50%** holdout ← winner (LR beats tree models with clean diff features)
- [x] Random Forest: 81.88% holdout
- [x] XGBoost: 82.01% holdout
- [x] Rolling year-by-year CV (2019-2025): LR consistently +1-3% above rules-based each year

#### Step 5: Per-weight-class analysis
- [x] General model evaluated per division on holdout; most divisions improved +1-3%
- [x] Struggles: Light Heavyweight -2.6%, Heavyweight -2.3%, UFC Bantamweight Title -5.3%
- [x] Separate per-class training not needed — general model is competitive across all divisions

#### Step 6: Per-judge analysis
- [x] 72 judges with 50+ rounds evaluated; model avg 82.6%
- [x] Most predictable: Patricia Morse Jarman 87.9%, David Lethaby 85.2%
- [x] Least predictable: Jerin Valel 67.8%, Jeff Collins 74.2%, Anthony Maness 75.4%

#### Step 7: Model selection & export
- [x] Winner: Logistic Regression (82.50% holdout, +1.14pp over rules-based)
- [x] Exported `scoring_model/scoring_model.json` — 19 features, coefficients + scaler for client-side JS
- [x] Key insight: ctrl_sec_diff is #1 feature (coef=+1.007) — massively underweighted in rules model

#### Step 8: Integrate into app — complete
- [x] Replace rules-based `scoreRound()` in FightDetailView.js with ML model predictions
- [x] General model used (per-weight-class not needed — general model is competitive across all divisions)
- [x] Show model confidence alongside predictions (probability %, shown next to round score)

**Note:** For fights that didn't go to decision (KO/TKO/sub), the model can still score completed rounds before the finish using `round_fight_stats`. A fight ending in round 3 has full stats for rounds 1 and 2. This extends the model's value well beyond the ~40% of fights that go to decision.

---

## Phase 4: Judge Profile Pages

One page per judge. Data source: `judge_scores` joined with `round_fight_stats` and `fight_meta_details`.
All analysis feasible with current data. Min threshold: 50+ rounds judged to avoid noise.

**Cross-source join strategy note:** When joining `judge_scores` to fights at scale, the ±1 day date window returns all bouts on the card. Individual fuzzy name matching risks cross-fight collisions (e.g. two fighters named "Silva" on the same card). For Phase 4 data pipelines, use **pair-matching**: extract unique fighter pairs per event from `judge_scores`, score each pair against the target fight's fighters as a unit (`max(sim(a,f1)+sim(b,f2), sim(a,f2)+sim(b,f1))`), and take the highest-scoring pair. More robust than per-name matching and avoids the both-sides requirement workaround used in FightDetailView.

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
