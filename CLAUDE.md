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
| Table | Purpose |
|---|---|
| `ufc_events` | Events (name, date, location, start_time) |
| `fights` | Fights with status (`upcoming`/`completed`), winner, fight_url |
| `fight_meta_details` | Detailed fight metadata (method, referee, weight class) |
| `round_fight_stats` | Per-round strike/takedown stats |
| `judge_scores` | Scorecard data from mmadecisions.com |
| `fight_dna_metrics` | Pre-calculated DNA metrics (used by frontend) |
| `fight_scraping_status` | SQL view — shows missing/partial round data |
| `user_votes` | User fight ratings/votes |

## Key Conventions
- Bout name format is always `Fighter1 vs Fighter2` (no period after "vs")
- `clean_bout_name()` in the master scraper standardises this and strips `\xa0`
- Scrapers use `SUPABASE_SERVICE_KEY` (not the anon key) for all DB writes
- The `fight_dna_metrics` table stores pre-calculated metrics — frontend reads from here, not raw stats tables

## Git Workflow
- Single branch `main` for active development
- Feature branches used for larger additions
- Push from `ufc-web-app/` only — never from the parent `VS Ufc/` folder
