# Lessons Learned

---

## judge_scores name matching audit & anagram fix — 2026-03-03

**What was done:**
- Ran `diagnose_judge_scores2.py` to audit coverage of `judge_scores` against `fight_meta_details`
- Discovered diagnostic scripts used exact date joins, reporting all Australian/international events as missing (false positives). Fixed both diagnostic scripts to use `±1 day` date window.
- Identified a genuine JS `matchesFighter` failure for Chinese names where ufcstats and mmadecisions use completely different character orderings: "Yizha"↔"Zha Yi", "Sulangrangbo"↔"Rangbo Sulang", "SuYoung You"↔"You Su Young"
- Fix: added a character-sort anagram check in `matchesFighter` — if both space-collapsed names have the same length (≥5 chars) and same sorted characters, treat as a match. Handles any source that reverses/reorders Chinese name segments.
- Also removed the leftover `pl-8` padding from filter legend labels (orphaned from the old dual-slider layout).

**What to watch:**
- Character-sort anagram check only fires when `aCol.length === bCol.length && length >= 5`. This prevents false positives on short names while catching the multi-character Chinese name segment reordering pattern.
- Diagnostic Check 4 SQL always shows 9/18 for fights where one fighter's name needs a JS fallback — this is expected (SQL can't replicate JS fuzzy logic). Only 0/18 rows warrant investigation.
- `Steve Erceg vs Ode Osbourne` (Aug 2025) shows 0/18 and is genuinely absent from mmadecisions — not a code issue.
- Historical events from 2015-2023 with zero judge_scores rows (UFC 293, UFC 284, UFC 275, many 2020 events, TUF Finales, Australian events) need the scraper re-run. These are data gaps, not code bugs.

---

## Dual-range filter + Q1/Q3 DNA presets — 2026-03-03

**What was done:**
- Converted all 5 fight filters from single-bound to `{ min, max }` range objects
- Two sliders per metric (Min/Max); each clamps against the other to prevent inversion
- "Apply My Stats" now uses Q1 (25th pct) → min and Q3 (75th pct) → max from `comparisonData`
- Added `duration` to `chartData` in `getDNAAndChartData` so Q1/Q3 can be computed for it
- `DEFAULT_FILTERS` constant defined once, used by both initial state and Reset button

**What to watch:**
- `comparisonData` must have `duration` populated — if it's null for some fights (no `metric_duration` in the view), Q1/Q3 will silently use 0
- Q1/Q3 requires `comparisonData.length >= 2`; "Apply My Stats" button is only shown when `combatDNA` is truthy, which is tied to having rated fights — may still show with only 1 fight (edge case, low priority)

---

## Judge scores bug investigation — 2026-03-02

**Bugs fixed:**
- `judge_scores.date` is stored from mmadecisions.com's local event date. For international events (Australia, Singapore, Abu Dhabi, Fight Island) this is consistently +1 day vs `ufc_events.event_date`. Fix: widen `getFightDetail` judge_scores query to ±1 day with `gte`/`lte` instead of `eq`.
- "Rong Zhu" (judge_scores) vs "Rongzhu" (fight_meta_details) — `matchesFighter()` failed all three strategies. Fix: added space-collapse step (`a.replace(/\s/g,'') === b.replace(/\s/g,'')`) before word-split fallbacks.
- `scrape_mmadecisions.py` event filter only matched `'UFC' in name`, skipping TUF Finale events listed as "TUF Latin America 3 Finale: ..." or "The Ultimate Fighter: ...". Fix: added `or 'TUF' in a.text or 'The Ultimate Fighter' in a.text`.

**Diagnostic approach that worked:**
- Check 1 (exact date join) incorrectly flagged ~20 events as "never scraped" — they were actually present with +1 day offset. Always verify with a ±2 day LATERAL join before concluding data is missing.
- Check 3 (exact norm match in SQL) flags names that `matchesFighter()` would actually catch via fuzzy fallbacks — SQL exact match is stricter than JS fuzzy logic. Use Check 4 (matched row count vs expected) as the real signal.

**What to watch:**
- The ±1 day window could theoretically pull scores from an adjacent event if UFC runs back-to-back days — hasn't happened yet; fighter name matching provides the safety net.
- One event genuinely has no data: "UFC Fight Night: Dos Anjos vs Ferguson" (2016-11-05) — mmadecisions lists it as "TUF Latin America 3 Finale: dos Anjos vs. Ferguson" and it was never scraped. Now covered by the TUF filter fix.

---

## Phase 3a: FightCard indicator + judge scores matching — 2026-03-02

**What was done:**
- Added ChevronRight "Details" indicator to FightCard (visible on all clickable cards, fades on hover via `group`/`group-hover`)
- Improved `matchesFighter()` with two fallbacks beyond exact normName: last-name match (handles "Alex" vs "Alexander"), and word-subset match (handles Jr., middle names, extra suffixes)
- Added console.log diagnostics in FightDetailView load — shows all judge_scores fighters returned for the date and the names being matched

**What to watch:**
- If console shows `judgeScores.length === 0`, it's a coverage gap in judge_scores (event not scraped), not a matching issue
- `matchesFighter` fallback 2 could false-positive on very common single-word last names — guarded by `w.length > 1`
- `group-hover` on the chevron requires `group` class on the card root div — don't remove it

---

## Phase 1d + 1e: Mobile responsiveness & fight click all views — 2026-03-02

**What was done:**
- Phase 1d: Tailwind responsive class fixes across App.js and FightDetailView.js — all targeted, no structural changes.
- Phase 1e: Fight card click now works from all views (profile, search, For You, fights).

**Key decisions:**
- Added `previousView` state to track which view was active before entering fightDetail. `onBack` uses this to return correctly — profile → profile, search → events, fights → fights.
- `handleFightClick` now uses `fight.event_date ?? selectedEvent?.event_date`. This means every fight object must carry `event_date` before it can open fightDetail.
- `fetchUserHistory` was missing `event_date` (fights table has no event_date column). Fixed by adding a batch lookup against `ufc_events` after the fights fetch — same pattern already used in search results merge.
- `loadForYou` similarly needed a batch event_date lookup. Refactored from two divergent code paths (recs vs favs) into a unified `fights` array → single lookup → `setRecommendations`.

**What to watch:**
- If the RPC `get_fight_recommendations` is changed to return event_date directly, remove the batch lookup in `loadForYou`.
- The `event_date` on fight objects added during `handleVote` (line ~516 `newHistoryItem`) does NOT include event_date — these are ephemeral optimistic updates, so it's fine as long as the user's next `fetchUserHistory` refresh picks it up.

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

## Phase 2: judge_scores re-scrape — 2026-03-02

**Bugs / errors encountered:**
- Windows `cp1252` terminal encoding can't render emoji characters (✅ ❌ ⚠️ ⏭️). `print()` calls with emojis inside worker threads threw `UnicodeEncodeError` AFTER the Supabase UPSERT had already committed. This caused `fetch_fight_page_and_insert` to raise instead of returning `True`, so `new_fights_processed` stayed 0 for every event, the consecutive-skip counter hit `STOP_THRESHOLD=10`, and the run terminated after only 10 events.
- Data was actually being inserted (visible in row count) but the counter was silently broken — only caught by cross-checking the DB.

**What I'd do differently:**
- Never use emoji in `print()` on Windows unless stdout is explicitly UTF-8. Use plain ASCII tags: `[OK]`, `[ERROR]`, `[WARN]`.
- After any scraper run that "stopped early", immediately check the DB row count — it tells you whether data was inserted despite apparent failures.
- Per-year timing added to the year loop was useful: ~4 min/year is a reliable baseline for dense UFC years.

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

## Phase 3: Fight detail view + scoring model — 2026-03-02

**Bugs / errors encountered:**
- `judge_scores.event_name` is sourced from mmadecisions.com link text (e.g. "UFC Fight Night 241: Holloway vs Allen") while `fights.event_name` comes from ufcstats.com (e.g. "UFC Fight Night: Holloway vs Allen"). These never match — querying `judge_scores` by `event_name` always returns zero rows. Fix: query by `date` instead, which is a plain calendar date and consistent across both sources.
- Fighter names in `judge_scores.fighter` can differ from `fight_meta_details.fighter1_name` due to apostrophe/quote character variants (e.g. straight `'` vs right single quote `'`). This caused the DB `.in('fighter', fighters)` filter to silently drop rows for the non-matching fighter. Fix: remove the fighter filter from the DB query and do normalized name matching in JS instead (`normName()` strips all punctuation + lowercases before comparing).
- `buildSummaryTotals` derived judge names from `judgeScores` array directly. After removing the fighter filter, `judgeScores` contains all fights on that date — judge names from other fights would bleed into the summary. Fix: derive judge names from `rounds.flatMap(r => r.judges)` which is already filtered to this fight's fighters.
- The rules-based scoring model was mistaken by the user for the ML model that was requested. Clarified: the rules-based `scoreRound()` is a temporary placeholder; the real goal is a trained ML pipeline (Phase 3c).

**What I'd do differently:**
- When a join spans two different data sources (ufcstats + mmadecisions), never assume shared text fields like `event_name` or `bout` will match exactly. Use date or a normalized key as the join column. Verify this assumption at the start of any cross-source join.
- When removing a DB-side filter to improve fuzzy matching, audit all downstream consumers of that array to check whether the broader result set causes new bugs (e.g. summary totals picking up other fights).
- Be explicit with the user about what "model" means — rules-based weighted computation vs trained ML model are very different things. When a plan says "build a model", confirm which is intended before writing any code.

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
