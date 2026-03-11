# Database Schema Reference

Full table and view definitions. Update this file whenever a migration adds, removes, or renames columns.

---

## Tables

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
| `id` | bigint PK | NOT NULL | auto-increment; insertion order = UFC card order (main event first → lowest id) |
| `event_name` | text | NOT NULL | |
| `bout` | text | NOT NULL | **often reversed vs `fight_meta_details.bout`** — always join on `fight_url` |
| `winner` | text | NULL | |
| `fight_url` | text | NULL | upcoming: `fighter-details/` URL; corrected to `fight-details/` on completion |
| `status` | text | NULL | `'upcoming'` / `'completed'` |
| `weight_class` | text | NULL | raw scraped value e.g. "UFC Bantamweight Title Bout" — shown on fight cards only |
| `scheduled_rounds` | integer | NULL | populated by ESPN sync (Phase 5) |
| `rounds_fought` | integer | NULL | convenience int mirror of `fight_meta_details.round` (text) |
| `ended_by_decision` | boolean | NULL | set by Edge Function when ESPN returns FINAL |
| `espn_competition_id` | text | NULL | ESPN competition ID for live status polling |
| `fight_started_at` | timestamptz | NULL | set when ESPN returns STATUS_IN_PROGRESS |
| `fight_ended_at` | timestamptz | NULL | set when ESPN returns STATUS_FINAL |

### `fight_meta_details`
| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid PK | NOT NULL | gen_random_uuid() |
| `event_name` | text | NOT NULL | |
| `bout` | text | NOT NULL | **often reversed vs `fights.bout`** — always join on `fight_url` |
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
| `fight_url` | text | NOT NULL | **canonical join key — always use this** |
| `weight_class_clean` | text | NULL | normalized division name e.g. "Bantamweight" — used in analytics |
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
| `sig_strike_pct` | numeric | NULL | stored as 0-100 percentage (not 0-1) |
| `total_strikes_landed` | integer | NULL |
| `total_strikes_attempted` | integer | NULL |
| `takedowns_landed` | integer | NULL |
| `takedowns_attempted` | integer | NULL |
| `takedown_pct` | numeric | NULL | stored as 0-100 percentage (not 0-1) |
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
| `event_name` | text | NOT NULL | from mmadecisions — **never matches `fights.event_name`** |
| `bout` | text | NOT NULL | |
| `date` | date | NOT NULL | join to fights via ±1 day window, never `eq` |
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
| `f1_score` | integer | NOT NULL | CHECK IN (10, 9, 8, 7) |
| `f2_score` | integer | NOT NULL | CHECK IN (10, 9, 8, 7) |
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

---

## Views

### `fight_dna_metrics`
Computed live from `fights` LEFT JOIN `round_fight_stats` (aggregated by event_name+bout) LEFT JOIN `fight_meta_details` (joined on fight_url). **This is a view, not a table — frontend reads from here, not raw stats.**

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
