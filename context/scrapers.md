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
python "master file for data update.py"
```

### Phases

| Phase | What it does |
|---|---|
| **0** | Upcoming events & fights |
| **1** | Completed events — consecutive-skip counter `STOP_AFTER=5` handles gaps |
| **2** | Completed fights — includes auto-delete guard (see below) |
| **3** | Fight metadata & winners — `sync_meta` scans ALL completed fights, no limit |
| **4** | Round-by-round stats — upsert with `on_conflict` |
| **5** | Event start times from ESPN API — also populates `fights.espn_competition_id` and `fights.scheduled_rounds` for upcoming fights |
| **6** | Judge scores — `subprocess.run([sys.executable, "scrape_mmadecisions.py", "--yes"])` |

### Phase 2 Auto-Delete Guard

Prevents deletion of fight records mid-event. **Both conditions required:**

1. `len(scraped_ids) > 0 and not any_newly_completed and event_is_past`
2. `event_is_past` uses `date.today().isoformat()` (local time, NOT `datetime.utcnow()`) — UTC rolls to next day before US events end
3. `any_newly_completed` = True if any fight updated upcoming→completed in this Phase 2 run

`any_newly_completed` alone is insufficient: Phase 0.5 re-adds fights already completed in a prior run, so `any_newly_completed` stays False even though the event isn't over.

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
