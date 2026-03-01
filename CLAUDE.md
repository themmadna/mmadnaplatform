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
      CombatScatterPlot.js        # Scatter plot visualization
    App.js copys/                 # Historical backup snapshots (ignore)
    dataService.JS copys/         # Historical backup snapshots (ignore)
  public/
  master file for data update.py  # Main scraper pipeline — run this to update DB
  scrape_mmadecisions.py          # Judge scorecard scraper (separate source)
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
  1. Upcoming events & fights
  2. Completed events
  3. Completed fights
  4. Fight metadata & winners
  5. Round-by-round stats
  6. Event start times (ESPN API)
- **`scrape_mmadecisions.py`** — scrapes judge scorecards from mmadecisions.com. Run separately.

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

### `ufc_events`
| Column | Type |
|---|---|
| `id` | bigint PK |
| `event_name` | text |
| `event_url` | text |
| `event_date` | date |
| `event_location` | text |
| `start_time` | text |

### `fights`
| Column | Type |
|---|---|
| `id` | bigint PK |
| `event_name` | text NOT NULL |
| `bout` | text NOT NULL |
| `winner` | text |
| `fight_url` | text |
| `status` | text (`upcoming` / `completed`) |

### `fight_meta_details`
| Column | Type |
|---|---|
| `id` | uuid PK NOT NULL |
| `event_name` | text NOT NULL |
| `bout` | text NOT NULL |
| `fighter1_name` | text NOT NULL |
| `fighter1_nickname` | text |
| `fighter2_name` | text NOT NULL |
| `fighter2_nickname` | text |
| `winner` | text |
| `result` | text NOT NULL |
| `weight_class` | text NOT NULL |
| `method` | text NOT NULL |
| `method_details` | text |
| `round` | text NOT NULL |
| `time` | text NOT NULL |
| `time_format` | text NOT NULL |
| `referee` | text |
| `fight_url` | text NOT NULL |

### `round_fight_stats`
| Column | Type |
|---|---|
| `id` | uuid PK NOT NULL |
| `event_name` | text NOT NULL |
| `bout` | text NOT NULL |
| `fighter_name` | text NOT NULL |
| `round` | integer NOT NULL |
| `kd` | integer |
| `sig_strikes_landed` | integer |
| `sig_strikes_attempted` | integer |
| `sig_strike_pct` | numeric |
| `total_strikes_landed` | integer |
| `total_strikes_attempted` | integer |
| `takedowns_landed` | integer |
| `takedowns_attempted` | integer |
| `takedown_pct` | numeric |
| `sub_attempts` | integer |
| `reversals` | integer |
| `control_time` | text |
| `control_time_sec` | integer |
| `sig_strikes_head_landed` | integer |
| `sig_strikes_head_attempted` | integer |
| `sig_strikes_body_landed` | integer |
| `sig_strikes_body_attempted` | integer |
| `sig_strikes_leg_landed` | integer |
| `sig_strikes_leg_attempted` | integer |
| `sig_strikes_distance_landed` | integer |
| `sig_strikes_distance_attempted` | integer |
| `sig_strikes_clinch_landed` | integer |
| `sig_strikes_clinch_attempted` | integer |
| `sig_strikes_ground_landed` | integer |
| `sig_strikes_ground_attempted` | integer |
| `inserted_at` | timestamp |

### `fight_dna_metrics`
| Column | Type |
|---|---|
| `fight_id` | bigint PK |
| `status` | text |
| `metric_pace` | double precision |
| `metric_violence` | double precision |
| `metric_intensity` | double precision |
| `metric_control` | double precision |
| `metric_finish` | integer |
| `metric_duration` | double precision |
| `raw_head_strikes` | bigint |
| `raw_body_strikes` | bigint |
| `raw_leg_strikes` | bigint |

### `judge_scores`
| Column | Type |
|---|---|
| `id` | bigint PK NOT NULL |
| `event_name` | text NOT NULL |
| `bout` | text NOT NULL |
| `date` | date NOT NULL |
| `fighter` | text NOT NULL |
| `judge` | text NOT NULL |
| `round` | integer NOT NULL |
| `score` | integer NOT NULL |
| `referee` | text |
| `created_at` | timestamptz |

### `user_votes`
| Column | Type |
|---|---|
| `id` | uuid PK NOT NULL |
| `user_id` | uuid NOT NULL |
| `fight_id` | bigint NOT NULL (FK → fights.id) |
| `vote_type` | text |
| `created_at` | timestamptz |

### `fight_ratings`
| Column | Type |
|---|---|
| `fight_id` | bigint PK (FK → fights.id) |
| `likes_count` | integer |
| `dislikes_count` | integer |
| `favorites_count` | integer |

### `ufc_baselines`
League-average metric values used for normalising DNA scores.
| Column | Type |
|---|---|
| `strikePace` | numeric |
| `violenceIndex` | numeric |
| `intensityScore` | numeric |
| `engagementStyle` | numeric |
| `finishRate` | numeric |
| `avgFightTime` | numeric |

### Views
| View | Purpose |
|---|---|
| `fight_scraping_status` | Shows missing/partial round data (`❌ MISSING`, `⚠️ PARTIAL`) |
| `user_votes_backup` | Backup of user_votes |
| `fight_ratings_backup` | Backup of fight_ratings |

## RPC Functions

### `get_fight_recommendations(p_user_id, p_pace, p_violence, p_intensity, p_control, p_finish, p_duration)`
Returns personalised fight recommendations based on DNA metric weights for a given user.

### `get_liked_fight_stats()`
Returns aggregate stats on fights the user has liked.

## Local Development Commands
```bash
# Frontend (from ufc-web-app/)
npm start               # Dev server at localhost:3000
npm run build           # Production build

# Scrapers (from ufc-web-app/)
python "master file for data update.py"   # Full pipeline — run after each UFC event
python scrape_mmadecisions.py             # Judge scorecards — run separately
```

## Combat DNA — Concept & Metrics
DNA metrics describe a fight's character without hardcoded categories. They power two things:
1. **Fight identity** — each fight gets a fingerprint based on how it was actually fought
2. **User profile** — a user's rated fights are averaged into a DNA profile that represents the *style* of fights they enjoy, used to drive personalised recommendations

### Metric definitions
All metrics are pre-calculated in the `fight_dna_metrics` **view** (not a table — it's computed live from `fights`, `round_fight_stats`, and `fight_meta_details`). The frontend averages them across a user's rated fights via `dataService.getCombatDNA()`.

| DB column | Frontend key | Formula | Unit / scale |
|---|---|---|---|
| `metric_pace` | `strikePace` | `total_sig_strikes_attempted / fight_duration_minutes` | Attempts/min (UFC avg: ~16.3) |
| `metric_violence` | `violenceIndex` | `(total_KD + total_sub_attempts) / fight_duration_minutes` | Rate (UFC avg: ~0.27) |
| `metric_intensity` | `intensityScore` | `(ground_att + clinch_att + sub_att×5 + reversals×5) / (control_minutes + 2)` | Composite ratio (UFC avg: ~5.4) |
| `metric_control` | `engagementStyle` | `(control_time_sec / total_fight_time_sec) × 100` | % of fight time (UFC avg: ~40%) |
| `metric_finish` | `finishRate` | `100 if KO/TKO/Sub, else 0` | 0 or 100 (UFC avg: ~52) |
| `metric_duration` | `avgFightTime` | Total fight time | Minutes (UFC avg: ~10.6) |
| `raw_head_strikes` | `totalHeadStrikes` | `sum(sig_strikes_head_attempted)` | Count |
| `raw_body_strikes` | `totalBodyStrikes` | `sum(sig_strikes_body_attempted)` | Count |
| `raw_leg_strikes` | `totalLegStrikes` | `sum(sig_strikes_leg_attempted)` | Count |

### `ufc_baselines` view
Simple average of all metrics across all fights in `fight_dna_metrics`. Used to render the background "grey polygon" on the DNA radar chart:
`strikePace: 16.27, violenceIndex: 0.27, intensityScore: 5.38, engagementStyle: 40.1, finishRate: 52.0, avgFightTime: 10.6`

### `fight_scraping_status` view
Joins `ufc_events` → `fights` → `fight_meta_details` → `round_fight_stats`. Computes expected rows as `rounds_fought × 2` (one row per fighter per round) and compares to actual rows inserted.
Status logic:
- `❓ NO META DATA` — `rounds_fought` is NULL (fight_meta_details not scraped yet)
- `❌ MISSING` — `actual_rows = 0`
- `⚠️ PARTIAL` — some rows present but fewer than expected
- `✅ COMPLETE` — `actual_rows >= expected_rows`

## Key Conventions
- Bout name format is always `Fighter1 vs Fighter2` (no period after "vs")
- `clean_bout_name()` in the master scraper standardises this and strips `\xa0`
- Scrapers use `SUPABASE_SERVICE_KEY` (not the anon key) for all DB writes
- The `fight_dna_metrics` table stores pre-calculated metrics — frontend reads from here, not raw stats tables

## Git Workflow
- Single branch `main` for active development
- Feature branches used for larger additions
- Push from `ufc-web-app/` only — never from the parent `VS Ufc/` folder

## Session & Planning Workflow

### One task at a time
When work is broken into phases or has sub-tasks, tackle **one task at a time** before moving to the next. This keeps the session context focused and makes it easy to review, test, and commit each piece independently before moving on.

### Project plan + status (one file)
For any multi-phase project, maintain a single **`PROJECT_PLAN.md`** file where the plan and status are always together. Status lives inline with each task so they can never drift out of sync.

Each task uses a status marker:
- `[ ]` Not started
- `[~]` In progress
- `[x]` Complete
- `[!]` Blocked / needs decision

Example structure:
```
## Phase 1: Data Pipeline
- [x] Scrape events from ufcstats.com
- [x] Insert into ufc_events table
- [~] Scrape round-by-round stats
  - [x] Parse base stats table
  - [ ] Parse zone stats table
- [ ] Schedule scraper to run weekly

## Phase 2: Frontend
- [ ] Build fight card component
```

`PROJECT_PLAN.md` lives in `ufc-web-app/` and is committed to git so progress is visible across sessions. Update it as each task is completed — never let it fall behind the actual work.

### Lessons learned (LESSONS.md)
After completing each task, update **`LESSONS.md`** with a short retrospective entry. This is written for Claude — not the user — to avoid rediscovering the same problems in future sessions.

Each entry should be brief and tied to the task it came from:

```
## [Task name] — [date]

**Bugs / errors encountered:**
- Short description of the problem and what fixed it.

**What I'd do differently:**
- One or two concrete changes to approach, order of operations, or assumptions.
```

Only log things that are genuinely reusable — recurring patterns, non-obvious gotchas, or mistakes that cost unnecessary compute. Skip anything obvious or one-off. `LESSONS.md` lives in `ufc-web-app/` and is committed alongside `PROJECT_PLAN.md`.

### Commit and push after each task group
After completing a task group and updating the MD files, **always ask the user** if they want to commit and push the changes to GitHub before moving to the next task group. Do not skip this step or assume they want to continue without committing.
