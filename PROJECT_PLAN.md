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

## Phase 4.5: Weight Class Normalization

**Problem:** `fight_meta_details.weight_class` stores raw scraped values like `"UFC Bantamweight Title Bout"`, `"UFC Interim Bantamweight Title Bout"`, `"Bantamweight Bout"`. These are all the same division. Grouping by raw `weight_class` produces duplicate buckets that fragment analytics, accuracy breakdowns, and fight card displays.

**Goal:** Clean division name everywhere by default. Title fight status becomes a separate boolean — used only when explicitly filtering for title vs non-title fights.

**Examples of normalization:**
| Raw `weight_class` | `weight_class_clean` | `is_title_fight` | `is_interim_title` |
|---|---|---|---|
| `Bantamweight Bout` | `Bantamweight` | false | false |
| `UFC Bantamweight Title Bout` | `Bantamweight` | true | false |
| `UFC Interim Bantamweight Title Bout` | `Bantamweight` | true | true |
| `Women's Flyweight Bout` | `Women's Flyweight` | false | false |
| `UFC Women's Strawweight Championship` | `Women's Strawweight` | true | false |
| `Catchweight Bout` | `Catchweight` | false | false |
| `Open Weight Bout` | `Open Weight` | false | false |

**Rule:** Keep `Women's` prefix (different division from men's). Strip everything else: `UFC`, `Interim`, `Title`, `Championship`, `Bout`.

### 4.5a. DB Migration

- [ ] Add `weight_class_clean` (text) to `fight_meta_details`
- [ ] Add `is_title_fight` (boolean, default false) to `fight_meta_details`
- [ ] Add `is_interim_title` (boolean, default false) to `fight_meta_details`
- [ ] One-time `UPDATE` to backfill all three columns from existing `weight_class` values using regex stripping
- [ ] Verify: `SELECT weight_class, weight_class_clean, is_title_fight, COUNT(*) FROM fight_meta_details GROUP BY 1,2,3 ORDER BY 1` — check for edge cases

**Migration SQL sketch:**
```sql
ALTER TABLE fight_meta_details
  ADD COLUMN IF NOT EXISTS weight_class_clean text,
  ADD COLUMN IF NOT EXISTS is_title_fight boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_interim_title boolean DEFAULT false;

UPDATE fight_meta_details SET
  is_title_fight  = (weight_class ILIKE '%title%' OR weight_class ILIKE '%championship%'),
  is_interim_title = (weight_class ILIKE '%interim%'),
  weight_class_clean = TRIM(
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(weight_class, '\s*Bout\s*$',         '', 'i'),
            '\s*(Title|Championship)\s*$', '', 'i'),
          '\s*Title\s*',                   ' ', 'i'),
        '^UFC\s+Interim\s+',               '',  'i'),
      '^UFC\s+',                           '',  'i')
  );
```
Run the SELECT verification query above before and after — spot-check Women's classes and any "Open Weight" / "Catchweight" rows.

### 4.5b. Scraper update

- [ ] Update `master file for data update.py` Phase 3/4 (`sync_meta`) to populate `weight_class_clean`, `is_title_fight`, `is_interim_title` on every upsert going forward
- [ ] Logic is identical to the migration — extract into a small helper function `parse_weight_class(raw)` that returns `(clean, is_title, is_interim)`

### 4.5c. Frontend updates

Everywhere `weight_class` is displayed or grouped, switch to `weight_class_clean`. The raw `weight_class` column stays in the DB for reference but is never shown in the UI.

- [ ] `FightDetailView.js` — weight class display in fight header
- [ ] `FightCard.js` — weight class badge/label (if shown)
- [ ] `JudgingDNACard.js` `accuracy_by_class` — already uses `weight_class` from the RPC; update RPC to use `weight_class_clean`
- [ ] `get_user_judging_profile()` RPC — replace `weight_class` with `weight_class_clean` in `user_rounds` CTE and all downstream aggregations
- [ ] Any other RPC or query that groups/filters by `weight_class`

### 4.5d. Title fight filter (future use)

Once the column exists, any view that wants title-fight-only stats simply adds `WHERE is_title_fight = true`. No changes needed now — just confirm the column is correctly populated.

---

## Phase 5: Weight Class Analytics

One analytics page per division. All computable from existing tables — no new scraping needed.
Join key: `fight_meta_details.weight_class_clean` (replaces raw `weight_class`). Requires Phase 4.5 complete.

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

## Phase 6: User Round Scoring & Judging DNA

Users score individual rounds using full judge-style input. Compare their scorecard to official judges and the community. Build a personal judging profile showing their accuracy and tendencies over time.

Live event support via ESPN's unofficial API (free, no key required, already used in project for event start times). Frontend clients poll fight status; the first client to detect a status change calls a Supabase Edge Function which writes the timestamp to the DB. No always-running backend needed.

---

### 6a. DB Migration

New tables and columns. All additive — no existing data touched.

- [x] Add `fights.espn_competition_id` (nullable text — ESPN's competition ID for status polling)
- [x] Add `fights.fight_started_at` (nullable timestamptz — set when ESPN returns `STATUS_IN_PROGRESS`)
- [x] Add `fights.fight_ended_at` (nullable timestamptz — set when ESPN returns `STATUS_FINAL`)
- [x] Create `user_round_scores` table (schema below)
- [x] Create `user_fight_scorecard_state` table (schema below)

```sql
-- fights: new columns
ALTER TABLE fights ADD COLUMN espn_competition_id text;
ALTER TABLE fights ADD COLUMN fight_started_at timestamptz;
ALTER TABLE fights ADD COLUMN fight_ended_at timestamptz;

-- user_round_scores
CREATE TABLE user_round_scores (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL,
  fight_id            bigint NOT NULL REFERENCES fights(id) ON DELETE CASCADE,
  round               integer NOT NULL,
  fighter_scored_for  text NOT NULL,
  points              integer NOT NULL CHECK (points IN (10, 9, 8, 7)),
  submitted_at        timestamptz DEFAULT now(),
  UNIQUE (user_id, fight_id, round)
);

-- user_fight_scorecard_state
CREATE TABLE user_fight_scorecard_state (
  user_id                uuid NOT NULL,
  fight_id               bigint NOT NULL REFERENCES fights(id) ON DELETE CASCADE,
  scored_blind           boolean DEFAULT false,     -- all rounds scored before judges revealed
  forfeited              boolean DEFAULT false,     -- chose to view judges mid-scoring
  modified_after_reveal  boolean DEFAULT false,     -- changed a score after judges were shown
  judges_revealed_at     timestamptz,
  leaderboard_eligible   boolean GENERATED ALWAYS AS (
    scored_blind AND NOT forfeited AND NOT modified_after_reveal
  ) STORED,
  PRIMARY KEY (user_id, fight_id)
);
```

---

### 6b. Live Event Sync — ESPN polling + Edge Function

No new Python script or external API key needed. ESPN's scoreboard API is already used in the project.

**How it works:**
1. `sync_event_times()` (existing Phase 5 scraper) is extended to also populate `fights.espn_competition_id` for upcoming fights by matching ESPN's competition list to our `fights` rows by fighter name.
2. During a live event, each user's browser polls `https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc/events/{eventId}/competitions/{competitionId}/status` every 30-60s.
3. The first client to detect `STATUS_IN_PROGRESS` / `STATUS_FINAL` calls a Supabase Edge Function (`record-fight-status`) which writes `fight_started_at` / `fight_ended_at` using a NULL-safe update (only writes if the column is currently NULL — safe against race conditions).
4. All subsequent clients read `fight_started_at` / `fight_ended_at` from the DB and skip ESPN entirely.

**Users never write directly to `fights`.** The Edge Function runs with service role and validates the ESPN payload before writing.

- [x] Extend `sync_event_times()` to populate `fights.espn_competition_id` for upcoming fights
- [ ] **[Deferred]** Schedule master scraper to run automatically on event day: once in the morning (catch card changes) and ~1 hour before start time (confirm all competition IDs set, catch last-minute cancellations)
- [x] Create Supabase Edge Function `record-fight-status` (validates ESPN status, writes started_at / ended_at if NULL)
- [x] Frontend: poll ESPN per-fight status every 60s when fight is upcoming; call Edge Function on state change
- [x] Frontend: gate scoring UI on `fight_started_at IS NOT NULL`; lock submissions on `fight_ended_at IS NOT NULL` — `isLive`/`isLocked` derived in FightDetailView; 3-state status block with TODO 6c hooks
- [x] Test against a historical ESPN event ID to confirm competition-level status data shape — `site.api.espn.com/scoreboard?dates=YYYYMMDD` returns `STATUS_FINAL` for completed events; `comp.status.type.name` confirmed correct

---

### 6c. Scoring UI in FightDetailView

Full judge-style scoring: pick winner per round + optional 10-8 / 10-7 flag. Judge scores hidden by default.

- [x] Add round scoring panel to `FightDetailView.js` (appears for all fights — live and historical) — `src/components/RoundScoringPanel.js`
- [x] Judge scores hidden until: all rounds scored → auto-reveal, or "Forfeit & view" clicked
- [x] Score finality: scores submitted before judges visible = locked (no edits). Post-reveal edits allowed but mark `modified_after_reveal = true` → leaderboard-ineligible
- [x] Historical fights always `scored_blind = false` (judges already known) → leaderboard-ineligible
- [x] Only scoreable rounds shown: decisions → all rounds; finishes → rounds 1 to R-1 (partial finishing round excluded)
- [x] Schema migration: `fighter_scored_for`/`points` → `f1_score`/`f2_score` — DDL run, dataService + RoundScoringPanel updated

**Leaderboard eligibility rules:**
- Scored ALL rounds while judges were hidden (live or historical before viewing) = ✅ eligible
- Forfeited, or modified after reveal, or scored historical fight with judges visible = ❌ ineligible

**Scoring flow UX improvements (deferred — to be built during 6e.2):**
- [ ] "View judges without scoring" option — user can choose to skip scoring and just see the judges' cards. Triggers forfeit path (marks `forfeited = true` → leaderboard-ineligible)
- [ ] Ineligibility warning modal — shown in two situations:
  1. User attempts to view judges before completing all rounds (currently the "Forfeit & view" path) — warn that their scoring will not count towards the leaderboard before confirming
  2. User returns to a fight they've already fully scored and attempts to change any score — warn that editing after judges are revealed marks their scorecard as modified and removes leaderboard eligibility
- [ ] Warning should be a confirmation step (cancel / proceed), not just a dismissible notice

---

### 6d. Scorecard Reveal View — complete

Shown in FightDetailView after judges are revealed.

- [x] Three-column scorecard: **User** | **Official judges (3 cards)** | **Community average**
- [x] Highlight round-level agreements (green) and disagreements (red) vs majority judge decision
- [x] Community average: aggregate of all `user_round_scores` for that fight per round
- [x] Add `getCommunityScorecard(fightId)` to `dataService.js`
- [x] `ScorecardComparison.js` — gated by `hasUserScores` from FightDetailView
- [x] Reveal triggers when ALL scoreable rounds scored (`onAllRoundsScored`) not just the first

---

### 6e. Judging DNA Profile (User Profile Page) — complete ✅ verified

Added to existing profile page (above voting history tabs). Requires ≥5 fights scored.

**Accuracy stats:**
- [x] Overall accuracy % (rounds matching majority judge decision)
- [x] Accuracy by weight class (top 4 classes with ≥3 rounds)

**Judging tendencies:**
- [x] 10-8 rate (how often user gives 10-8 rounds)
- [x] Closest official judge match (highest agreement % with ≥5 shared rounds)
- [ ] Striking vs grappling bias (deferred — requires round_fight_stats join)
- [ ] Aggressor bias (deferred)

**Implementation:**
- [x] `get_user_judging_profile()` RPC — date ±1 join + last-name fighter match + majority computation. `supabase/deploy_judging_profile.py`
- [x] `JudgingDNACard.js` — `src/components/JudgingDNACard.js`
- [x] `dataService.getUserJudgingProfile()` → `supabase.rpc('get_user_judging_profile')`
- [x] App.js: fetch on profile view open (once), render above voting tabs

---

### 6e.2 Judging DNA — Overhaul

Full redesign of the Judging DNA page. Replaces the existing `JudgingDNACard.js` UI and significantly expands the RPC.

**Confirmed stats (12 total):**
1. Rounds scored — prominently displayed (not buried in header)
2. Agreement breakdown — % of rounds where you agreed with all 3 / 2 of 3 / 1 of 3 / 0 of 3 judges
3. Outlier rate — % of rounds where you're the lone dissenter (opposite to 2+ judges)
4. Judge you're most like — highest agreement % with ≥5 shared rounds (future: clickable → judge profile)
5. Striking vs grappling bias — when you award a round, is the winner's striking or grappling advantage the driver?
6. Aggressor bias — do you favor the fighter throwing more volume regardless of accuracy?
7. Takedown quality — do you reward passive control time or require active ground work (sub attempts + ground strikes)?
8. Knockdown bias — when a fighter scores a KD, do you always give them the round regardless of everything else?
9. 10-8 call quality — when you give a 10-8, do the judges agree it was a dominant round?
10. Rounds scored per weight class — count alongside existing accuracy breakdown
11. Scoring strictness by weight class — avg loser score per class (9.2 vs 9.6 = stricter/more lenient)
12. Striking vs grappling bias by weight class — does your preference shift by division?

**Implementation — Step 1: RPC overhaul (Group A — no round_fight_stats join)**

Stats 1–4, 9, 10, 11 all derivable from `user_round_scores` + `judge_scores`. Existing RPC scaffolding covers most of it.

- [x] Expand `get_user_judging_profile()` to return:
  - `rounds_scored` (already present, just ensure surfaced)
  - `agreement_breakdown` — { all3, two_of_three, one_of_three, lone_dissenter } counts + percentages
  - `outlier_rate` — % rounds as lone dissenter
  - `ten_eight_quality` — of user's 10-8 rounds, % where judges agreed it was dominant (all gave ≥10-8 equivalent)
  - `accuracy_by_class` extended — add `rounds` count + `avg_loser_score` per class
- [x] Redeploy via `supabase/deploy_judging_profile.py`

**Implementation — Step 2: UI overhaul**

Full redesign of `JudgingDNACard.js` as a blank slate — new layout, sections, all Step 1 data wired in.

- [x] Redesign `JudgingDNACard.js` with sections:
  - Overview strip (rounds scored, fights scored, accuracy, outlier rate)
  - Agreement breakdown (visual breakdown of all3/2of3/1of3/0of3)
  - Judge match (closest judge name + agreement %)
  - 10-8 section (rate + call quality together)
  - Weight class breakdown (accuracy + rounds + avg loser score per class)

**Implementation — Step 3: RPC extension (Group B — round_fight_stats join)**

Stats 5, 6, 7, 8, 12 all require joining `round_fight_stats` per scored round. One join, five stats.

- [ ] Add `round_fight_stats` join to RPC for each user-scored round
- [ ] Compute and return:
  - `striking_vs_grappling_bias` — for awarded rounds, compare winner's sig_strikes_landed diff vs (takedowns_landed + control_time_sec) diff. Output: `{ striking_pct, grappling_pct }` — which was the bigger driver
  - `aggressor_bias` — compare user award vs sig_strikes_attempted diff (volume). Flag rounds where you sided with higher-volume fighter even when accuracy favoured opponent
  - `takedown_quality_bias` — bucket rounds: "active ground" (sub_attempts > 0 OR ground_strikes > 3) vs "passive control" (ctrl_sec > 30, low activity). % of passive-control rounds you still awarded
  - `knockdown_bias` — on KD rounds (kd diff ≠ 0), % of time you awarded the fighter with the KD
  - `bias_by_class` — striking vs grappling split per weight class (merge into `accuracy_by_class`)
- [ ] Redeploy

**Implementation — Step 4: UI additions for Group B**

- [ ] Add bias/tendency section to redesigned `JudgingDNACard.js`
  - Striking vs grappling bias bar (overall + by class toggle)
  - Aggressor bias indicator
  - Takedown quality bias
  - Knockdown bias stat

**Implementation — Step 5: Scored Fights list**

Tab or section at the bottom of the Judging DNA page showing every fight the user has scored. Styled like existing fight cards but with the user's scorecard in place of the like/dislike/favorite buttons.

- [ ] Data query: fetch all fights the user has scored — `user_round_scores` grouped by `fight_id`, summed to produce total f1/f2 scorecard (e.g. 29-28). Join `fights` + `fight_meta_details` for display info (fighters, event, weight class, method, result)
- [ ] Add to `dataService.js`: `getScoredFights(userId)` — returns fights with user totals attached
- [ ] UI: tab or collapsible section at the bottom of the Judging DNA view
  - Fight card layout matching existing style (fighter names, event, weight class)
  - Replace like/dislike/fav buttons with user's total scorecard (e.g. "29–28 {f1Last}")
  - Optionally show green/red dot indicating if user picked the correct winner
  - Clicking a card navigates to the fight detail view (same as existing fight cards)

---

### 6f. Leaderboard (Points System — deferred)

Leaderboard based on accuracy % for v1. Points system (bonus for correct 10-8 calls, etc.) added later once the feature has traction.

- [ ] Leaderboard page or section: rank users by accuracy % — overall and by weight class
- [ ] Only `leaderboard_eligible = true` scorecards count

---

### Build order
6a → 6b → 6c → 6d → 6e → 6e.2 (Step 1 → Step 2 → Step 3 → Step 4) → 6f (leaderboard deferred)
