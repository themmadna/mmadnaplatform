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
