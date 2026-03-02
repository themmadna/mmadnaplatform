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

## Performance & dead code cleanup — 2026-03-01

**Patterns confirmed:**
- `CombatDNACard` had its own `getGlobalBaselines()` call in a `useEffect`, duplicating the parent's fetch. Always check if a child component is re-fetching data the parent already has — pass it as a prop instead.
- `getCombatDNA` and `getComparisonData` queried the same table with identical filters. Whenever two sequential `await` calls hit the same table with the same `.in()` + `.eq()`, merge them into one and split the result client-side.
- `recommendationReason` was normalised in `dataService` but never rendered anywhere in `App.js`. Before writing a data mapping, grep for the key in the render tree first.
- `import React` is not needed in React 17+ with the new JSX transform (Create React App default). IDE will flag it as an unused import — safe to remove.

**What I'd do differently:**
- When auditing dead code, grep for the key in the JSX render tree before concluding it's unused. A key set in `dataService` might be used in a component — check both layers.

---

## Phase 1b UI/UX fixes — 2026-03-01

**Changes made:**
- Empty state added to fights view (was blank after load with no data)
- Filter panel: Reset button added inline with the "Fight Finder" heading
- Profile tabs: empty state per tab ("No favorites yet." etc.)
- Theme selector: click-outside closes dropdown — wrapped Palette button + dropdown in a shared `ref`'d container so the toggle button click doesn't re-open after outside-click closes it
- Search results: `locked={isUpcoming(f.event_date)}` — upcoming fights now locked in search just like in events view
- Locked message: "Voting opens at start time" → "Voting opens at event start" (accurate for both start_time and date-based locking)

**What I'd do differently:**
- When adding a click-outside handler with a ref, always check whether the toggle button is inside or outside the ref'd element. If outside, a click on the toggle button triggers the outside handler first then the onClick — causing a double-toggle. Fix: wrap both in a single ref'd container.
- When a `locked` prop defaults to `false` in a component, grep all call sites to confirm every context that should lock is actually passing the prop.

---

## Phase 1a UX gap fixes — 2026-03-01

**Changes made:**
- Added `loadingFights` state + spinner in fights view — previously blank while `handleEventClick` awaited data.
- Fixed `isVotingLocked` to fall back to `event_date` when `start_time` is absent — upcoming events without a start time were incorrectly voteable. Moved `isUpcoming` above `isVotingLocked` so it can be called as a fallback.

**What I'd do differently:**
- When a guard clause like `if (!x) return false` is on a nullable field that has semantic meaning (upcoming vs past), always ask: what should the fallback actually be? `false` is not always the safe default.
- Always follow the concluding steps (LESSONS, MEMORY, commit prompt) immediately after finishing a task group — don't wait to be reminded.

---

## Scraper concurrency optimization — 2026-03-01

**Changes made:**
- Replaced sequential fight-page loop with `ThreadPoolExecutor(max_workers=5)` — fight scorecard pages per event now fetched concurrently.
- Reduced `time.sleep` from 1.5s → 0.75s per request.
- Added retry logic with exponential backoff (3 attempts, 429-aware with jitter).
- Supabase client is not thread-safe (`httpx.Client` shared internally) — added `threading.local()` with `get_thread_db()` to give each worker its own client.
- Thread-local `requests.Session` per worker for HTTP keep-alive reuse.
- Full re-scrape runtime: ~2+ hours → ~25–35 minutes.

**What I'd do differently:**
- Check thread-safety of the DB client library before parallelizing any DB-writing loop. The supabase-py `SyncPostgrestClient` wraps `httpx.Client` which is not concurrency-safe — thread-local clients are mandatory.
- The pool should be created per-event (not globally) so fight-page fetches for different events never overlap. This is safer for rate-limiting on small fan sites.
- Only the innermost tier (fight pages) benefits from parallelization. Discovery tiers (year/event pages) must stay sequential — they depend on each other's output.

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
