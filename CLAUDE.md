# UFC Web App — Claude Context

## Project Overview

A UFC fight analytics web app. React frontend on Vercel, Supabase as the database. Python scripts scrape fight data from ufcstats.com and mmadecisions.com.

- **GitHub:** https://github.com/themmadna/mmadnaplatform
- **Single git repo:** `ufc-web-app/.git` — the parent `VS Ufc/` folder is just a plain directory, not a git repo

---

## Project Structure

```
ufc-web-app/
  src/
    App.js                        # Main React component
    dataService.js                # All Supabase data fetching
    guestStorage.js               # sessionStorage wrapper for guest mode
    components/
      FightDetailView.js          # Fight detail page (stats, scoring, scorecard)
      RoundScoringPanel.js        # Per-round user scoring UI
      ScorecardComparison.js      # User vs judges vs community scorecard
      JudgingDNACard.js           # User judging profile / tendencies
      CombatScatterPlot.js        # Scatter plot visualization
      CombatDNAVisual.js          # Body map visualization
    App.js copys/                 # Historical backup snapshots (ignore)
    dataService.JS copys/         # Historical backup snapshots (ignore)
  public/
  master file for data update.py  # Main scraper pipeline
  scrape_mmadecisions.py          # Judge scorecard scraper
  scoring_model/                  # ML model training scripts + scoring_model.json
  supabase/
    views/                        # .sql files for view definitions
    functions/                    # .sql files for RPC definitions
    fetch_schema.py               # Dumps live view/function SQL into views/ and functions/
    deploy_judging_profile.py     # Deploys get_user_judging_profile() RPC
  context/                        # Reference docs — read on demand (see Context Directory below)
  .env                            # Local secrets (gitignored)
  package.json
```

---

## Tech Stack

- React (Create React App), Tailwind CSS, Recharts, Lucide React
- Supabase JS client, deployed on Vercel
- Python 3.9 scrapers: `requests`, `beautifulsoup4`, `python-dotenv`, `supabase`, `python-dateutil`

---

## Dev Commands

```bash
# Frontend (from ufc-web-app/)
npm start               # Dev server at localhost:3000
npm run build           # Production build

# Scrapers (from ufc-web-app/)
# Python: C:/Users/sabzu/AppData/Local/Programs/Python/Python39/python.exe
python "master file for data update.py"   # Full pipeline — run after each UFC event
python scrape_mmadecisions.py             # Judge scorecards — run separately
```

---

## Key Conventions

These are the highest-stakes gotchas. Violating any of these causes silent bugs.

1. **Always join on `fight_url`, never on `bout` string.** `fights.bout` and `fight_meta_details.bout` are often reversed relative to each other.
2. **`judge_scores.event_name` never matches `fights.event_name`.** Always join judge_scores to fights via `date` with a ±1 day window (`gte`/`lte`), never `eq`.
3. **`fights.weight_class` (raw) vs `fight_meta_details.weight_class_clean` (analytics).** Raw shown on fight cards. Clean used in fight detail header and all analytics.
4. **`fights.id` insertion order = UFC card order** (main event first → lowest id). Frontend orders by `id ASC`.
5. **`SUPABASE_SERVICE_KEY` for all scraper writes** — not the anon key. Wrong key = silent auth failure.
6. **`fight_dna_metrics` is a VIEW, not a table.** Frontend reads from here, not raw `round_fight_stats`.
7. **Bout name format:** `Fighter1 vs Fighter2` (no period after "vs"). `clean_bout_name()` in the master scraper standardises this.
8. **Cross-source name matching:** use `normName()` (lowercase + strip all non-alphanumeric except spaces). Never exact string match across UFC Stats and mmadecisions.
9. **`fight_meta_details.bout` vs `round_fight_stats.bout` are often reversed** — even though both come from ufcstats. When joining them, always match both orderings: `rfs.bout = fmd.bout OR rfs.bout = TRIM(SPLIT_PART(fmd.bout,' vs ',2)) || ' vs ' || TRIM(SPLIT_PART(fmd.bout,' vs ',1))`.

---

## Git Workflow

- Single branch `main` for active development; feature branches for larger additions
- Push from `ufc-web-app/` only — never from the parent `VS Ufc/` folder
- Before any cleanup or deletion work, check for multiple `.git` dirs — two repos sharing a remote causes destructive-looking commits

---

## Session Workflow

### One task at a time
Complete and mark done before moving to the next.

### Status markers (PROJECT_PLAN.md)
`[ ]` not started · `[~]` in progress · `[x]` complete · `[!]` blocked

### Session start
At the start of a session, read the relevant `context/` file(s) for the task area before writing any code. Do not rely on MEMORY.md alone for detail work.

### REQUIRED concluding steps — do not skip
After every task group:
1. **Update PROJECT_PLAN.md** — mark completed tasks `[x]`
2. **Update LESSONS.md** — add entry under the relevant topic section (not chronologically)
3. **Update context/ files** — if the task changed anything covered by a context file, update it (see sync table below)
4. **Update MEMORY.md** — if any stable pattern was confirmed or a context file was updated
5. **Ask the user** if they want to commit and push before continuing

### Context file sync table
When a task changes something in these areas, update the corresponding file:

| Changed area | File to update |
|---|---|
| Table schema, view definition | `context/schema.md` |
| RPC function signature or logic | `context/rpc-functions.md` |
| Scraper phases, guards, or flags | `context/scrapers.md` |
| ESPN polling, Edge Function, live scoring render | `context/live-events.md` |
| ML model features, threshold, or JS integration | `context/ml-model.md` |
| DNA metrics or formulas | `context/combat-dna.md` |
| Phase 6 scoring UI or Judging DNA architecture | `context/phase6-architecture.md` |
| Completed a full phase | `context/completed-phases.md` + condense in PROJECT_PLAN.md |
| Critical conventions or git/session workflow | `CLAUDE.md` directly |

### Canonical hierarchy
`context/` files are canonical for detail. MEMORY.md is canonical for quick always-on conventions. When they conflict, fix the `context/` file first, then update MEMORY.md to match.

### Deprecation rule
When replacing existing architecture — not just adding to it — find every file that references the old approach and update all of them in the same session. Stale references in any file are worse than no reference.

### MEMORY.md pruning
When a phase is fully complete and its detail lives in `context/`, shrink the MEMORY.md entry for that area to a one-line pointer. MEMORY.md has a hard 200-line limit — keep it lean.

---

## Context Directory

Read these files at the start of a session when the task touches that area.

| File | Covers | When to read |
|---|---|---|
| `context/schema.md` | All table schemas + views (full column detail) | DB migrations, new queries, schema questions |
| `context/rpc-functions.md` | All RPC signatures, return shapes, implementation notes | Modifying or calling RPCs |
| `context/scrapers.md` | Scraper phases, auto-delete guard, env vars, gotchas | Scraper work, data pipeline changes |
| `context/live-events.md` | ESPN status codes, Edge Function, polling architecture, live scoring render | Live event feature work |
| `context/ml-model.md` | Model features, JS integration, 10-8 threshold, training scripts | Scoring model work |
| `context/combat-dna.md` | DNA concept, metric formulas, frontend key mapping | DNA/recommendations feature work |
| `context/phase6-architecture.md` | RoundScoringPanel, ScorecardComparison, Judging DNA, leaderboard eligibility | Phase 6 scoring UI or Judging DNA work |
| `context/completed-phases.md` | Condensed summaries of Phases 1, 2, 3, 4.5, 7 | Historical reference only |
