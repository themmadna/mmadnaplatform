# UFC Web App — Claude Context

## Project Overview
A UFC fight analytics web app. React frontend served via Vercel, Supabase as the database. Python scripts scrape fight data from ufcstats.com and mmadecisions.com and load it into Supabase.

## Repo
- **GitHub:** https://github.com/themmadna/mmadnaplatform
- **Single git repo:** `ufc-web-app/.git` — the parent `VS Ufc/` folder is just a plain directory, not a git repo

## Project Structure
```
ufc-web-app/
  src/
    App.js                        # Main React component
    dataService.js                # All Supabase data fetching
    components/
      FightDetailView.js          # Fight detail page (stats, scoring, scorecard)
      RoundScoringPanel.js        # Per-round user scoring UI
      ScorecardComparison.js      # User vs judges vs community scorecard
      JudgingDNACard.js           # User judging profile / tendencies
      CombatScatterPlot.js        # Scatter plot visualization
    App.js copys/                 # Historical backup snapshots (ignore)
    dataService.JS copys/         # Historical backup snapshots (ignore)
  public/
  master file for data update.py  # Main scraper pipeline — run this to update DB
  scrape_mmadecisions.py          # Judge scorecard scraper (separate source)
  scoring_model/                  # ML model training scripts + scoring_model.json
  supabase/
    views/                        # .sql files for view definitions
    functions/                    # .sql files for RPC definitions
    fetch_schema.py               # Dumps live view/function SQL into views/ and functions/
  .env                            # Local secrets (gitignored)
  package.json
```

## Frontend
- React (Create React App)
- Tailwind CSS
- Supabase JS client
- Recharts for data visualization
- Lucide React for icons
- Deployed on Vercel

## Python Scrapers
- **`master file for data update.py`** — the single canonical pipeline. Run this after each UFC event to update the DB. Phases:
  - Phase 0: Upcoming events & fights
  - Phase 1: Completed events (consecutive-skip counter STOP_AFTER=5, handles gaps)
  - Phase 2: Completed fights
  - Phase 3: Fight metadata & winners (`sync_meta` scans ALL completed fights, no limit)
  - Phase 4: Round-by-round stats (upsert with on_conflict)
  - Phase 5: Event start times (ESPN API)
  - Phase 6: Judge scores — `subprocess.run([sys.executable, "scrape_mmadecisions.py", "--yes"])`
- **`scrape_mmadecisions.py`** — scrapes judge scorecards from mmadecisions.com. Called by Phase 6 automatically, or run separately with `--no-stop` to disable the 10-event stop threshold for gap-fill runs.

### Scraper Dependencies
```
requests, beautifulsoup4, python-dotenv, supabase, python-dateutil
```

### Environment Variables (.env in ufc-web-app/)
```
REACT_APP_SUPABASE_URL=...
REACT_APP_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_KEY=...        # Service role key — required for scraper writes
SUPABASE_MANAGEMENT_KEY=...    # Account-level Management API token — used to query view/function SQL definitions
```

## Supabase Tables

> Backup tables `fight_ratings_backup` and `user_votes_backup` exist but are not actively used.

### `ufc_events`
| Column | Type | Nullable |
|---|---|---|
| `id` | bigint PK | NOT NULL |
| `event_name` | text | NULL |
| `event_url` | text | NULL |
| `event_date` | date | NULL |
| `event_location` | text | NULL |
| `start_time` | text | NULL |

### `fights`
| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | bigint PK | NOT NULL | auto-increment; insertion order = UFC card order (main event first) |
| `event_name` | text | NOT NULL | |
| `bout` | text | NOT NULL | often reversed vs `fight_meta_details.bout` — join on `fight_url` |
| `winner` | text | NULL | |
| `fight_url` | text | NULL | upcoming: `fighter-details/` URL; corrected to `fight-details/` on completion |
| `status` | text | NULL | `'upcoming'` / `'completed'` |
| `weight_class` | text | NULL | raw scraped value (e.g. "UFC Bantamweight Title Bout") |
| `scheduled_rounds` | integer | NULL | |
| `rounds_fought` | integer | NULL | convenience int mirror of `fight_meta_details.round` (text) |
| `ended_by_decision` | boolean | NULL | |
| `espn_competition_id` | text | NULL | ESPN competition ID for live status polling |
| `fight_started_at` | timestamptz | NULL | set when ESPN returns STATUS_IN_PROGRESS |
| `fight_ended_at` | timestamptz | NULL | set when ESPN returns STATUS_FINAL |

### `fight_meta_details`
| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid PK | NOT NULL | gen_random_uuid() |
| `event_name` | text | NOT NULL | |
| `bout` | text | NOT NULL | |
| `fighter1_name` | text | NOT NULL | |
| `fighter1_nickname` | text | NULL | |
| `fighter2_name` | text | NOT NULL | |
| `fighter2_nickname` | text | NULL | |
| `winner` | text | NULL | |
| `result` | text | NOT NULL | |
| `weight_class` | text | NOT NULL | raw scraped value |
| `method` | text | NOT NULL | |
| `method_details` | text | NULL | |
| `round` | text | NOT NULL | text e.g. "3"; cast to int where needed |
| `time` | text | NOT NULL | |
| `time_format` | text | NOT NULL | |
| `referee` | text | NULL | |
| `fight_url` | text | NOT NULL | join key — always use this, never `bout` |
| `weight_class_clean` | text | NULL | normalized division name (e.g. "Bantamweight") |
| `is_title_fight` | boolean | NULL | default false |
| `is_interim_title` | boolean | NULL | default false |

### `round_fight_stats`
One row per (fighter, round). Unique constraint: `(event_name, bout, round, fighter_name)`.

| Column | Type | Nullable |
|---|---|---|
| `id` | uuid PK | NOT NULL |
| `event_name` | text | NOT NULL |
| `bout` | text | NOT NULL |
| `fighter_name` | text | NOT NULL |
| `round` | integer | NOT NULL |
| `kd` | integer | NULL |
| `sig_strikes_landed` | integer | NULL |
| `sig_strikes_attempted` | integer | NULL |
| `sig_strike_pct` | numeric | NULL |
| `total_strikes_landed` | integer | NULL |
| `total_strikes_attempted` | integer | NULL |
| `takedowns_landed` | integer | NULL |
| `takedowns_attempted` | integer | NULL |
| `takedown_pct` | numeric | NULL |
| `sub_attempts` | integer | NULL |
| `reversals` | integer | NULL |
| `control_time` | text | NULL |
| `control_time_sec` | integer | NULL |
| `sig_strikes_head_landed` | integer | NULL |
| `sig_strikes_head_attempted` | integer | NULL |
| `sig_strikes_body_landed` | integer | NULL |
| `sig_strikes_body_attempted` | integer | NULL |
| `sig_strikes_leg_landed` | integer | NULL |
| `sig_strikes_leg_attempted` | integer | NULL |
| `sig_strikes_distance_landed` | integer | NULL |
| `sig_strikes_distance_attempted` | integer | NULL |
| `sig_strikes_clinch_landed` | integer | NULL |
| `sig_strikes_clinch_attempted` | integer | NULL |
| `sig_strikes_ground_landed` | integer | NULL |
| `sig_strikes_ground_attempted` | integer | NULL |
| `inserted_at` | timestamp | NULL (default now()) |

### `judge_scores`
One row per (fighter, judge, round). Unique constraint: `(bout, date, judge, fighter, round)`.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | bigint PK | NOT NULL | |
| `event_name` | text | NOT NULL | from mmadecisions — never matches `fights.event_name` |
| `bout` | text | NOT NULL | |
| `date` | date | NOT NULL | join to fights via ±1 day window |
| `fighter` | text | NOT NULL | one row per fighter (not a pair) |
| `judge` | text | NOT NULL | |
| `round` | integer | NOT NULL | |
| `score` | integer | NOT NULL | |
| `referee` | text | NULL | |
| `created_at` | timestamptz | NULL | default now() |

### `user_votes`
Unique constraint: `(user_id, fight_id)`.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid PK | NOT NULL | |
| `user_id` | uuid | NOT NULL | FK → auth.users |
| `fight_id` | bigint | NOT NULL | FK → fights.id |
| `vote_type` | text | NULL | `'like'` / `'dislike'` / `'favorite'` |
| `created_at` | timestamptz | NULL | default now() |

### `fight_ratings`
Aggregated vote counts, maintained by `update_fight_ratings` trigger.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `fight_id` | bigint PK | NOT NULL | FK → fights.id |
| `likes_count` | integer | NULL | default 0 |
| `dislikes_count` | integer | NULL | default 0 |
| `favorites_count` | integer | NULL | default 0 |

### `user_round_scores`
One row per (user_id, fight_id, round). Unique constraint: `(user_id, fight_id, round)`.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid PK | NOT NULL | |
| `user_id` | uuid | NOT NULL | |
| `fight_id` | bigint | NOT NULL | FK → fights.id |
| `round` | integer | NOT NULL | |
| `f1_score` | integer | NOT NULL | winner gets 10, loser gets 9/8/7 |
| `f2_score` | integer | NOT NULL | |
| `submitted_at` | timestamptz | NULL | default now() |

### `user_fight_scorecard_state`
Primary key: `(user_id, fight_id)`.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `user_id` | uuid | NOT NULL | |
| `fight_id` | bigint | NOT NULL | FK → fights.id |
| `scored_blind` | boolean | NULL | default false |
| `forfeited` | boolean | NULL | default false |
| `modified_after_reveal` | boolean | NULL | default false |
| `judges_revealed_at` | timestamptz | NULL | |
| `leaderboard_eligible` | boolean | GENERATED | `scored_blind AND NOT forfeited AND NOT modified_after_reveal` |

## Supabase Views

### `fight_dna_metrics`
Computed live from `fights` LEFT JOIN `round_fight_stats` (aggregated by event_name+bout) LEFT JOIN `fight_meta_details` (joined on fight_url).

| Column | Type | Formula |
|---|---|---|
| `fight_id` | bigint | |
| `status` | text | |
| `metric_pace` | double precision | sig_strikes_attempted / fight_duration_min |
| `metric_violence` | double precision | (total_kd + total_sub_att) / fight_duration_min |
| `metric_intensity` | double precision | (ground_att + clinch_att + sub_att×5 + reversals×5) / (ctrl_min + 2) |
| `metric_control` | double precision | control_time_sec / total_fight_time_sec × 100 |
| `metric_finish` | integer | 100 if KO/TKO/Submission, else 0 |
| `metric_duration` | double precision | total fight time in minutes |
| `raw_head_strikes` | bigint | sum(sig_strikes_head_attempted) |
| `raw_body_strikes` | bigint | sum(sig_strikes_body_attempted) |
| `raw_leg_strikes` | bigint | sum(sig_strikes_leg_attempted) |

### `ufc_baselines`
League averages across all fights in `fight_dna_metrics`. Used for the radar chart background polygon.

| Column | Type |
|---|---|
| `strikePace` | numeric |
| `violenceIndex` | numeric |
| `intensityScore` | numeric |
| `engagementStyle` | numeric |
| `finishRate` | numeric |
| `avgFightTime` | numeric |

### `fight_scraping_status`
Joins `ufc_events` → `fights` → `fight_meta_details` → `round_fight_stats`. Expected rows = `rounds_fought × 2`.

| Column | Notes |
|---|---|
| `event_name`, `event_date`, `bout`, `fight_url` | identifiers |
| `rounds_fought` | from fight_meta_details |
| `expected_rows`, `actual_rows`, `missing_rows` | computed |
| `fight_status` | `❓ NO META DATA` / `✅ COMPLETE` / `❌ MISSING` / `⚠️ PARTIAL` |

### `judge_scores_coverage`
Coverage per decision fight. Joins `fight_meta_details` → `ufc_events` → `judge_scores` (±1 day window). SQL in `supabase/views/judge_scores_coverage.sql`.

| Column | Notes |
|---|---|
| `event_date`, `event_name`, `fight_url` | identifiers |
| `fighter1_name`, `fighter2_name`, `method`, `rounds_fought` | from fight_meta_details |
| `expected_rows` | rounds × 6 (3 judges × 2 fighters) |
| `score_rows_on_date` | actual judge_scores rows matched |
| `coverage_status` | `'missing'` / `'partial'` / `'complete'` |

## RPC Functions

### `get_community_scorecard(p_fight_id bigint)`
Returns per-round average scores across all users for a given fight.
```
Returns: TABLE(round integer, f1_avg numeric, f2_avg numeric, user_count integer)
```

### `get_fight_recommendations(p_user_id uuid, p_pace, p_violence, p_control, p_finish, p_duration, p_intensity)`
Returns up to 20 fight recommendations by Euclidean distance from the provided DNA weights. Excludes fights the user has already voted on.
```
Returns: TABLE(id, event_name, bout, event_date, fight_url, dist, match_reason)
```
> Overload: `get_fight_recommendations(p_user_id uuid)` — computes DNA automatically from the user's liked fights, then runs the same distance query.

### `get_liked_fight_stats()`
Returns all `round_fight_stats` rows for fights the current user (`auth.uid()`) has liked.
```
Returns: SETOF round_fight_stats
```

### `get_user_judging_profile()`
Returns a JSON object with the current user's (`auth.uid()`) judging accuracy and tendencies. Joins `user_round_scores` → `judge_scores` via ±1 day date window + last-name fighter matching.

```
Returns: json {
  fights_scored, rounds_scored, rounds_matched,
  accuracy,          -- % rounds matching majority judge
  outlier_rate,      -- % rounds where 0 judges agreed (lone dissenter)
  ten_eight_rate,    -- % rounds user scored 10-8
  ten_eight_quality, -- of user 10-8 rounds, % where judges also scored it dominant
  agreement_breakdown: { all3, two_of_three, one_of_three, lone_dissenter, total, *_pct },
  accuracy_by_class: [{ weight_class_clean, accuracy, rounds, avg_loser_score }],
  judges: [{ name, agreement_pct, rounds }]   -- closest judge matches (≥5 shared rounds)
}
```
> Overload: `get_user_judging_profile(p_user_id uuid)` — older version, takes explicit user ID. Uses an outdated join strategy; prefer the no-arg version from the frontend.

### `update_fight_ratings()` (trigger function)
Trigger on `user_votes` (INSERT/UPDATE/DELETE). Recounts likes/dislikes/favorites for the affected fight and upserts into `fight_ratings`.

## Local Development Commands
```bash
# Frontend (from ufc-web-app/)
npm start               # Dev server at localhost:3000
npm run build           # Production build

# Scrapers (from ufc-web-app/)
# Python path: C:/Users/sabzu/AppData/Local/Programs/Python/Python39/python.exe
python "master file for data update.py"   # Full pipeline — run after each UFC event
python scrape_mmadecisions.py             # Judge scorecards — run separately
```

## Combat DNA — Concept & Metrics
DNA metrics describe a fight's character without hardcoded categories. They power fight identity fingerprints and personalised recommendations via a user's average DNA across rated fights (`dataService.getCombatDNA()`).

All metrics are pre-calculated in the `fight_dna_metrics` **view** (computed live — not a table).

| DB column | Frontend key | Formula |
|---|---|---|
| `metric_pace` | `strikePace` | sig_strikes_attempted / fight_duration_min |
| `metric_violence` | `violenceIndex` | (total_KD + total_sub_att) / fight_duration_min |
| `metric_intensity` | `intensityScore` | (ground_att + clinch_att + sub_att×5 + reversals×5) / (ctrl_min + 2) |
| `metric_control` | `engagementStyle` | control_time_sec / total_fight_time_sec × 100 |
| `metric_finish` | `finishRate` | 100 if KO/TKO/Sub, else 0 |
| `metric_duration` | `avgFightTime` | total fight time in minutes |
| `raw_head_strikes` | `totalHeadStrikes` | sum(sig_strikes_head_attempted) |
| `raw_body_strikes` | `totalBodyStrikes` | sum(sig_strikes_body_attempted) |
| `raw_leg_strikes` | `totalLegStrikes` | sum(sig_strikes_leg_attempted) |

## ML Round Scoring Model
- Model file: `scoring_model/scoring_model.json` — Logistic Regression, 19 features, coefficients + scaler
- Loaded and run client-side in `FightDetailView.js` via `scoreRound(f1Stats, f2Stats)`
- Returns `{ winner: 'f1'|'f2', confidence }` where `confidence = max(p, 1-p)` (0.5–1.0)
- 10-8 threshold: confidence ≥ 0.99 (empirically derived — below this produces too many false 10-8s)
- Top feature: `ctrl_sec_diff` (coef +1.007) — control time is massively underweighted in rules-based models

## ESPN Live Status Codes
Used by the frontend to drive live event badges and the `record-fight-status` Edge Function:
- `STATUS_SCHEDULED` — not started
- `STATUS_FIGHTERS_WALKING` — walkout; treat as upcoming (do NOT trigger live)
- `STATUS_IN_PROGRESS` / `STATUS_IN_PROGRESS_2/3/4/5` — use `startsWith('STATUS_IN_PROGRESS')`
- `STATUS_END_OF_ROUND` — between rounds; treat as live
- `STATUS_FINAL` — fight over

Edge Function note: `verify_jwt` must be `false` on `record-fight-status` (set via Management API PATCH). Default `true` rejects valid user JWTs before function code runs.

## Key Conventions
- Bout name format is always `Fighter1 vs Fighter2` (no period after "vs")
- `clean_bout_name()` in the master scraper standardises this and strips `\xa0`
- Scrapers use `SUPABASE_SERVICE_KEY` (not the anon key) for all DB writes
- The `fight_dna_metrics` **view** provides pre-calculated metrics — frontend reads from here, not raw stats tables
- `fights.bout` and `fight_meta_details.bout` are often reversed — always join on `fight_url`, never on `bout` string
- `fights.weight_class` (raw text) is shown on fight cards; `fight_meta_details.weight_class_clean` is used in fight detail and all analytics
- `fights.id` insertion order = UFC stats card order (main event first → lowest id). Frontend orders by `id ASC`
- `judge_scores.event_name` never matches `fights.event_name` — always join on `date` with a ±1 day window

## Git Workflow
- Single branch `main` for active development
- Feature branches used for larger additions
- Push from `ufc-web-app/` only — never from the parent `VS Ufc/` folder

## Session & Planning Workflow

### One task at a time
Tackle one task at a time before moving to the next.

### Project plan (`PROJECT_PLAN.md`)
Status lives inline with each task using markers: `[ ]` not started, `[~]` in progress, `[x]` complete, `[!]` blocked. Committed to git — update as tasks complete.

### Lessons learned (`LESSONS.md`)
After each task, log reusable patterns and non-obvious gotchas — not obvious or one-off things. Committed alongside `PROJECT_PLAN.md`.

### REQUIRED: Concluding steps after every task group — do not skip
1. **Update PROJECT_PLAN.md** — mark completed tasks `[x]`
2. **Update LESSONS.md** — add a brief retrospective entry
3. **Update MEMORY.md** — if any stable conventions or patterns were confirmed
4. **Ask the user** if they want to commit and push before continuing
