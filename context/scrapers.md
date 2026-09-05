# Scrapers Reference

Architecture, phases, environment variables, and gotchas for all Python data pipelines.
Update this file whenever scraper phases change or new guards/flags are added.

---

## Environment Variables (`.env` in `ufc-web-app/`)

```
REACT_APP_SUPABASE_URL=...         # Project URL (also used by scrapers)
REACT_APP_SUPABASE_ANON_KEY=...    # Public read-only (frontend only)
SUPABASE_SERVICE_KEY=...           # Service role — required for ALL scraper writes
SUPABASE_MANAGEMENT_KEY=...        # Account-level Management API token (view/function SQL)
```

Both scrapers load `.env` via `Path(__file__).parent / '.env'`.

---

## Python Path

`C:/Users/sabzu/AppData/Local/Programs/Python/Python39/python.exe`

---

## Dependencies

```
requests, beautifulsoup4, python-dotenv, supabase, python-dateutil
```

---

## `master file for data update.py`

Single canonical pipeline. Run after each UFC event to update the DB.

```bash
python "master file for data update.py"              # Full pipeline (manual / day-of)
python "master file for data update.py" --live       # Live-event mode: Phases 2-4 only (see below)
python "master file for data update.py" --post-event # Post-event mode: Phases 0/0.5/1/5/6 (see below)
```

### Phases

| Phase | What it does |
|---|---|
| **0** | Upcoming events & fights |
| **1** | Completed events — consecutive-skip counter `STOP_AFTER=5` handles gaps |
| **2** | Completed fights — includes auto-delete guard (see below) |
| **3** | Fight metadata & winners — `sync_meta` scans ALL completed fights unless scoped by `event_name`. After the insert loop, calls `rescrape_null_winner_decisions()` to re-check any `winner IS NULL AND method ILIKE 'Decision%'` rows; updates only when the parse now returns a winner (real draws stay untouched). |
| **4** | Round-by-round stats — upsert with `on_conflict`; `time.sleep(1)` between requests. Stamps `fight_url` from `task['fight_url']` onto every merged row before upsert so the FK link is set at insert time (S-P1-5 fix). |
| **5** | Event start times from ESPN API — also populates `fights.espn_competition_id` and `fights.scheduled_rounds` for upcoming fights. Covers all future events **plus** any event up to `PHASE5_BACKFILL_DAYS` (45) in the past whose `start_time` is still NULL (see below) |
| **6** | Judge scores — `subprocess.run([sys.executable, "scrape_mmadecisions.py", "--yes"])` |

After Phase 4, every mode calls **`stamp_event_ended_at(event_name)`** — stamps `ufc_events.ended_at` = the event's latest `fight_ended_at` (for events with NULL `ended_at`), **but only once the MAIN EVENT row (lowest `card_position`, fallback lowest `id` — same rule as the poller) has a `fight_ended_at`**. The main-event gate is critical: `--live` mode calls this mid-event after every cycle, and an "any fight ended" check stamps `ended_at` right after the first prelim ends, which kills the frontend LIVE display for the rest of the card (observed at UFC FN: Muhammad vs Bonfim, 2026-06-06 — `ended_at` got stamped 21:18, the first prelim's end, 5.5h before the main event; fixed 2026-06-09). Durable backstop for the frontend LIVE badge in case `poll-live-fights` never saw the main event finalize (e.g. an unmatchable main-event opponent swap). Idempotent; full-run is bounded to events from the last 14 days.

### ufcstats Anti-Bot Proof-of-Work Challenge

As of ~2026-05-30 ufcstats.com serves a **self-hosted SHA-256 JavaScript proof-of-work challenge** (origin `nginx/1.10.1`, **not** Cloudflare — no `cf-ray`) to plain HTTP clients: a tiny "Checking your browser…" stub with `<noscript>This site requires JavaScript.</noscript>` instead of the real page. This broke every ufcstats fetch (Phases 0/1/2/3/4) and — because Phase 0's `find('table').find_all(...)` had no None-guard — **crash-aborted the whole run on the first phase**, starving the completed-results phases too. Header/User-Agent tweaks and `cloudscraper` do **not** clear it (it isn't Cloudflare).

**Solver:** every ufcstats GET now routes through `fetch_ufcstats(url, timeout=20)` (in `master file for data update.py`):
1. GET via a shared module-level `requests.Session` (browser UA).
2. If the body looks like the challenge (`_looks_like_challenge`), parse `nonce` (`var nonce="<hex>"`) and difficulty (`new Array(<D>+1).join('0')` → D hex zeros).
3. Solve: smallest `n` where `sha256(f"{nonce}:{n}").hexdigest()[:D] == "0"*D` (difficulty 2 ≈ 256 hashes — instant; iteration-capped at 50M as a runaway guard).
4. `POST /__c` with form body `nonce=<nonce>&n=<n>` → `204` sets clearance cookie `_fmc` (Max-Age ~7 days).
5. Retry the GET. The cookie is cached on the session, so only the **first** challenged request per run pays the solve cost.

If the challenge can't be parsed (layout changed), `fetch_ufcstats` returns the challenge response unchanged and the caller's existing None/empty guard handles it. **Both `find('table', class_='b-statistics__table-events')` sites (Phase 0, Phase 1) now None-guard → skip+warn** instead of crashing, so a future challenge-structure change degrades gracefully rather than taking down Phases 1–4.

No new dependencies (`hashlib` + `re` are stdlib). `scrape_mmadecisions.py` hits a different origin (Apache, not challenged) and `poll-live-fights` uses ESPN — both unaffected.

### `--live` Mode (GitHub Actions automated)

Runs only Phases 2, 3, 4. Self-guarding via `is_live_window()`:

1. Queries `ufc_events` for today or yesterday (UTC) — 2-day window handles events crossing UTC midnight
2. **Fails safe** if `ufc_events.start_time` is NULL — Phase 5 must have run first (prerequisite)
3. Checks `now >= start_time + 20 min` (UTC)
4. Checks that at least one fight still has `fight_ended_at IS NULL` (upper bound — natural stop)

**Triggered automatically** via `.github/workflows/live-event-scraper.yml` on a `*/25 * * * *` cron. On non-event days exits after one DB query. Stop condition is natural: once all fights have `fight_ended_at` set, the function returns False and the run exits cleanly.

**Phase 3 scoping in `--live` mode:** `sync_meta(event_name=...)` limits the scan to today's event fights only, avoiding a full-history N+1 query scan. Full pipeline calls `sync_meta()` with no argument — unchanged behaviour.

**Required GitHub Secrets:** `REACT_APP_SUPABASE_URL`, `SUPABASE_SERVICE_KEY` (repo Settings → Secrets → Actions)

**Phase 5 prerequisite:** `ufc_events.start_time` must be populated before live mode activates. Run the full pipeline at least once on event day before the event starts.

### `--post-event` Mode (GitHub Actions automated)

Runs **all phases 0 → 6** (0, 0.5, 1, 2, 3, 4, then `stamp_event_ended_at`, 5, 6). Self-guarding via `is_post_event_window()`:

1. Queries `ufc_events` for any event in the past 3 days (3-day lookback handles UTC-midnight crossings)
2. **Fails safe** if `ufc_events.start_time` is NULL — Phase 5 must have run first (prerequisite)
3. Window open: `start_time + 5h` — event safely over even accounting for overruns
4. Window close: `start_time + 48h` — gives 2 days for late mmadecisions scorecard uploads

**Triggered automatically** via `.github/workflows/post-event-scraper.yml` on a `0 */2 * * *` cron (every 2 hours). On non-event days exits after one DB query. All phases are idempotent — re-runs within the window are safe. Phase 6 (`scrape_mmadecisions.py`) stops after 10 consecutive existing records, so later runs in the window are fast.

**Phase order:** sync_upcoming_events (0) → sync_upcoming_fights (0.5) → sync_events (1) → sync_fights (2) → sync_meta (3) → sync_round_stats (4) → stamp_event_ended_at → sync_event_times (5) → sync_judge_scores (6). Phases 2/3/4 ARE run here (not just in `--live`) — this is the path that pulls in completed results / replaced-matchup bouts if `--live` missed them or ufcstats posted late. `sync_meta(event_name=...)` is event-scoped so it's not a full-history scan.

**Required GitHub Secrets:** Same as live mode — `REACT_APP_SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

### Phase 5 Backfill Window

Phase 5 selects future events **plus** events up to `PHASE5_BACKFILL_DAYS` (45) in the past that still have `start_time IS NULL`. It was future-only (`gte(event_date, today)`) until 2026-09-05.

Why it matters: an event ingested after the fact — the normal outcome whenever automation lapses and a later run backfills it — would land with `start_time = NULL` forever. Both `is_live_window()` and `is_post_event_window()` **fail safe on a NULL `start_time`**, so such an event is permanently invisible to the automation that would otherwise finish populating it. It also leaves the frontend's `isPastEventWindow()` false, so `eventConcluded` never trips for that event.

The ESPN comp-id / `card_position` half of Phase 5 (step 4b) still only matches `status = 'upcoming'` fights, so for a backfilled past event only `start_time` is filled; expect a noisy "ESPN comps not matched to DB" warning on those. Harmless — card ordering falls back to Convention #4 (`fights.id ASC`).

### GitHub Actions 60-Day Inactivity Disable

**Both scraper workflows are scheduled, and GitHub disables scheduled workflows after 60 days with no repository activity.** This fired on 2026-08-09 (last commit 2026-06-09) and the data pipeline stopped silently for a month — the DB sat at the 2026-08-08 Gamrot vs Salkilld card while 4 events went unscraped.

- Diagnose with `curl -s https://api.github.com/repos/themmadna/mmadnaplatform/actions/workflows` — a `"state": "disabled_inactivity"` is conclusive and needs no auth. **Check this before debugging the scrapers**; the scraper code was fine throughout.
- A commit resets the 60-day timer but does **not** re-enable an already-disabled workflow. Re-enable via the Actions tab ("Enable workflow" button) or `PUT /repos/<owner>/<repo>/actions/workflows/<id>/enable` with an `actions: write` token.
- The disable lands mid-cron, so the event in flight is left half-scraped rather than cleanly skipped.
- Mitigation: `.github/workflows/keepalive.yml` pushes an empty commit on `0 6 1 * *` (monthly). The message carries `[skip ci]` so Vercel does not redeploy for it. The keepalive is itself a scheduled workflow, so it keeps *itself* alive too — but only while it is enabled; if everything is ever disabled again, it must be re-enabled by hand like the others.

### Data Freshness Check (`supabase/check_data_freshness.py`)

Weekly guard against the pipeline dying silently, run by `.github/workflows/data-freshness-check.yml` (`0 12 * * 1`, Mondays after the weekend's events land). Two checks, both of which would have caught the 2026-08 outage within days:

1. **Freshness** — the newest fully-scraped past event must be within `STALE_AFTER_DAYS` (14). Catches "scraping stopped entirely." 14 rather than 7 because genuine two-week UFC gaps happen (December); a check that cries wolf gets ignored.
2. **Completeness** — no past event inside `COMPLETENESS_WINDOW_DAYS` (30) may still have fights stuck `upcoming` or missing a winner. Catches "scraping died partway through a card," which is what the mid-cron disable actually did to Gamrot vs Salkilld.

Exits non-zero on failure so the Actions run goes red and emails, and prints a ranked runbook of likely causes (workflow disabled → ufcstats challenge changed → stale secrets). Runs locally too: `python supabase/check_data_freshness.py`.

### Fighter Name Matching Across Sources

`_names_match()` tries, in order: exact normalized match → alias map (`_FIGHTER_ALIASES`) → generational-suffix strip (`_strip_suffix`) → space-collapse ("Rong Zhu"/"Rongzhu") → bare last-name match.

**The last-name fallback is deliberately loose** — any two fighters sharing a surname match (Charles/Donte Johnson, Ty/Juliana Miller, Levi/Gregory Rodrigues all collide). That is safe only because `_bout_matches()` requires **both** fighters to match before a bout is linked. Never use `_names_match` alone to identify a fighter.

`_strip_suffix` drops a trailing `jr/sr/ii/iii/iv` (added 2026-09-05). Sources disagree on these: ufcstats had "Sean King III" on Noche UFC where ESPN said "Sean King", and the last-name fallback couldn't rescue it because it landed on the suffix token `iii`, which also fails its `len > 3` test — leaving that fight with no `espn_competition_id` and therefore no live status.

### Phase 0.5 Duplicate Detection

Uses `_bout_matches(f1, f2, existing_bout)` as a fallback after exact-string check. This catches fighters known by different names across scrape sources (e.g. "Patricio Pitbull" on the ufcstats upcoming page vs "Patricio Freire" stored from a prior run). Without the alias-aware fallback, a new entry is created for the same fight, leaving it with no `espn_competition_id` and stuck as `upcoming` during the live event.

### Phase 2 Auto-Delete Guard

Prevents deletion of fight records mid-event. **Both conditions required:**

1. `len(scraped_ids) > 0 and not any_newly_completed and event_is_past`
2. `event_is_past` uses a UTC datetime + 34-hour buffer: `event_date midnight UTC + timedelta(days=1, hours=10)`. This covers UTC-8 (Hawaii) events plus a 2-hour card overrun. **Do not use `date.today()` — GitHub Actions runners are UTC and would falsely trigger the guard mid-event.**
3. `any_newly_completed` = True if any fight updated upcoming→completed in this Phase 2 run

`any_newly_completed` alone is insufficient: Phase 0.5 re-adds fights already completed in a prior run, so `any_newly_completed` stays False even though the event isn't over.

### Phase 3 NULL-Winner Decision Rescrape

`sync_meta` runs `rescrape_null_winner_decisions(event_name)` after the main insert loop. The function selects `fight_meta_details` rows where `winner IS NULL AND method ILIKE 'Decision%'`, optionally filtered to the current event's URLs, and re-fetches each via `parse_fight_meta_details`. If the parse returns a winner, both `fmd.winner`/`fmd.result` and `fights.winner` are updated. If the parse still returns `winner=None` (a genuine draw — both fighters have "D" status on ufcstats), no update fires.

**Why it exists:** the first scrape during `--live` mode can run before ufcstats has published the W/L status text for a just-finished fight. Without the re-scrape pass, the original skip-if-fmd-exists guard means the row never gets re-checked — the fight ends up permanently `winner=NULL` even when the page is updated minutes later. See `memory/LESSONS.md` "Post-Event Data Ops" for the verification protocol that prevents misclassifying real draws as a parser bug.

### Phase 2 Alias-Aware Fallback

Before inserting a new completed fight, Phase 2 falls back to a linear `_bout_matches` scan over `existing_fights`. This handles the case where UFC Stats reports a fighter by a different name post-event than what was stored pre-event (e.g. ufcstats used "Patricio Pitbull" on the completed fights page, but the DB row was "Patricio Freire"). Without this, Phase 2 inserts a duplicate completed fight rather than updating the existing upcoming row.

### `parse_weight_class(raw)` helper

Returns `(clean, is_title, is_interim)`. Used in Phase 3 to populate `weight_class_clean`, `is_title_fight`, `is_interim_title` on every new `fight_meta_details` insert.

### Windows requirement

```python
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
```
Must be at the top of the file. Prevents `UnicodeEncodeError` crashes on Windows `cp1252` terminals when emoji appear in print output.

---

## `scrape_mmadecisions.py`

Scrapes judge scorecards from mmadecisions.com. Called automatically by Phase 6, or run separately.

```bash
python scrape_mmadecisions.py              # Interactive (asks before writing)
python scrape_mmadecisions.py --yes        # Non-interactive (Phase 6 uses this)
python scrape_mmadecisions.py --no-stop    # Disable 10-event stop threshold (gap-fill runs)
```

**Event filter:** matches `'UFC'`, `'TUF'`, and `'The Ultimate Fighter'` — TUF Finale events are listed without "UFC" on mmadecisions.com.

**Name extraction:** always from link display text (proper casing, spaces), never from URL slugs. URL slugs produce names that never join to UFC Stats data.

**Data state (as of Phase 2 cleanup):** 5,412 complete, 55 partial (SQL name-match artefacts, frontend handles via matchesFighter), 678 missing (pre-2010 or mmadecisions genuinely lacks data).

---

## Cross-Source Join Rules (Scrapers)

- `judge_scores.event_name` from mmadecisions **never** matches `fights.event_name` from ufcstats — join by `date` ±1 day window only
- International events (Australia, Singapore, Abu Dhabi, Fight Island) consistently have +1 day offset in mmadecisions dates — always use ±1 day window (`gte`/`lte`), never `eq`
- Fighter names: use `normName()` (lowercase + strip all non-alphanumeric except spaces). Never exact string match
- Unicode accent normalization: `unicodedata.normalize('NFKD', s)` before regex strip — decomposes accented chars, then strip removes combining mark (ñ→n, ä→a)

---

## Scraper Patterns & Gotchas

- **`.limit(N)` on a query that claims to be incremental is usually a bug.** The per-record existence check is the deduplication mechanism, not the limit.
- **`break` on first existing record assumes no gaps.** Use a consecutive-skip counter (reset on any new insert) to handle gaps without scanning all history.
- **Validate env var names against the actual `.env` file.** Wrong variable names produce silent `None` failures that look like auth errors.
- **Only the innermost scraping tier benefits from parallelization.** Discovery tiers must stay sequential. `supabase-py` is not concurrency-safe — use `threading.local()` per worker.
- **`echo yes | python script.py` doesn't work in background task mode.** Use an explicit `--yes` argparse flag.
- **Python stdout in background bash tasks won't flush** unless launched with `-u` (unbuffered) flag.
