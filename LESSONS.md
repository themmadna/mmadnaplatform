# Lessons Learned

---

## Project cleanup & git consolidation — 2026-03-01

**Bugs / errors encountered:**
- Two `.git` folders (`VS Ufc/.git` and `ufc-web-app/.git`) both pointed to the same GitHub remote. Pushing from the root repo put commits on `origin/main` that looked like deletions of `src/App.js`, `package.json`, etc. — which were destructive from the `ufc-web-app/` repo's perspective because they shared the same relative paths.
- Pulling into `ufc-web-app/` from that state triggered modify/delete conflicts and a merge that would have wiped the entire frontend. Had to abort and force push from `ufc-web-app/` instead.
- `git pull` in `ufc-web-app/` was silently being rejected by origin because the root repo had already pushed newer commits — this took a fetch + log comparison to diagnose.

**What I'd do differently:**
- Before doing any cleanup or file deletion work, check for multiple `.git` directories in the workspace first (`find . -name ".git" -maxdepth 3`). Identify which is the canonical repo before touching anything.
- When two repos share a remote, always establish which one is the source of truth and delete the other's `.git` before making any commits. Never push from both.
- Always check `git remote -v` in both repos before any push to confirm they're not pointing to the same remote.

---

## Frontend code review & bug fixes — 2026-03-01

**Bugs / errors encountered:**
- `event.location` was used throughout App.js but the DB column is `event_location`. Location never displayed on any event card or in the fights view header — silent failure with no console error.
- `fight.weight_class` was rendered in FightCard but the `fights` table doesn't have that column — it lives in `fight_meta_details`. Always fell back to `'MAIN CARD'`. Fix: fetch `fight_meta_details` in parallel inside `handleEventClick` and merge by `bout`.
- `fetchUserHistory` hardcoded `updateDnaAndCharts(merged, 'combined')` regardless of `dnaFilter` state. A user on the 'favorites' DNA tab who triggered a re-fetch would silently get 'combined' data while the tab still showed 'favorites' as active.

**What I'd do differently:**
- When reviewing frontend field access, cross-reference against the schema in CLAUDE.md first. A quick grep for `\.location` or `\.weight_class` against the table definitions would have caught both bugs immediately.
- When a function that re-fetches data also recomputes derived state (like DNA), check whether hardcoded arguments match the live UI state. Any hardcoded string where a state variable exists is a suspect.
- Check `fight_meta_details` vs `fights` split carefully — `fights` is the lightweight index table; `fight_meta_details` holds the rich attributes. Weight class, method, referee, etc. all live in meta.

---

## Data engineering review & pipeline fixes — 2026-03-01

**Bugs / errors encountered:**
- `scrape_mmadecisions.py` was using `SUPABASE_URL` and `SUPABASE_ANON_KEY` — neither exists in the `.env`. The Supabase client was silently constructed with `None` values; every DB call failed without any error surfacing to the terminal.
- Same file used bare `load_dotenv()` with no path, so it only worked if the script was launched from exactly `ufc-web-app/`. The master file's `Path(__file__).parent / '.env'` pattern is the correct fix.
- `round` in `judge_scores` was inserted as a raw string from `.text.strip()` instead of `int()`. Schema expects integer.
- `dataService.getRecommendations` accepted only `userId` but `App.js` was already passing `combatDNA` as a second arg — it was silently dropped, so the RPC was called with 6 missing parameters every time.
- `sync_meta` used `.limit(50)` while claiming to fetch "fights missing metadata" — it was actually just re-checking the 50 most recent fights. Metadata gaps in older fights could never be filled.
- `sync_upcoming_fights` skipped the entire event if any fight existed, making partial card inserts unrecoverable until the event completed.

**What I'd do differently:**
- Always validate env var names against the actual `.env` file at the start of any scraper review — wrong variable names produce silent `None` failures that look like auth errors.
- When reviewing a `dataService` function, always find its call site in `App.js` first to confirm the actual arguments being passed match the function signature.
- A `.limit(N)` on a scraper query that claims to be "incremental" is usually a bug — the per-record check is the deduplication mechanism, not the limit.
- `break` on first existing record in a scraper loop assumes no gaps ever exist. A consecutive-skip counter (reset on any new insert) is the right pattern — handles gaps without scanning all historical records.
- When a secondary scraper (mmadecisions) derives entity names from URL slugs, those names can never join to the primary scraper's data (ufcstats names). Always use the link display text, which has proper casing.
- After fixing fighter name derivation in a scraper, historical records with the old format must be truncated and re-scraped. Upsert conflict keys prevent duplication on re-scrape.

---
