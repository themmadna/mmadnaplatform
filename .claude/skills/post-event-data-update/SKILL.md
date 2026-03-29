---
name: post-event-data-update
description: Runs the full post-UFC-event data pipeline to update fight stats, metadata, and judge scorecards. Use when user says "update data after the event", "run the scrapers", "scrape last night's results", "it's fight week let's update", "run master file", "phase 1 through 6 scraper", "mmadecisions scraper", "pull in the new fights", or "get the new data".
---

# Post-Event Data Update

Run the full UFC data pipeline after a live event. This is a two-part process: phases 1–5 via the main scraper, then phase 6 (judge scorecards) separately.

## Environment Requirements

Before running anything, confirm these are set in the shell environment:
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_KEY` — **Service key required for all writes.** Anon key fails silently with no error.

Python path: `C:/Users/sabzu/AppData/Local/Programs/Python/Python39/python.exe`

Working directory: `c:/Users/sabzu/Documents/VS Ufc/ufc-web-app/`

---

## Step 1 — Run Phases 1–5 (Main Scraper)

```bash
cd "c:/Users/sabzu/Documents/VS Ufc/ufc-web-app"
C:/Users/sabzu/AppData/Local/Programs/Python/Python39/python.exe "master file for data update.py"
```

**What this covers:**
- Phase 1: UFC events
- Phase 2: Fight metadata (fight_url, bout, weight class)
- Phase 3: Fight meta details (fighter names, title fight flag, weight_class_clean)
- Phase 4: Round-by-round stats (round_fight_stats)
- Phase 5: Fight card positions (from ESPN)

**Runtime:** 30–90 minutes depending on event size.

**Watch for:**
- Any `UnicodeEncodeError` → file is missing `sys.stdout.reconfigure(encoding='utf-8', errors='replace')` at top
- `401` or silent write failures → wrong key (must be SERVICE key, not anon)
- Scraper stopping early on gaps → should use consecutive-skip counter, not break-on-first-miss; investigate if it stops before expected

---

## Step 2 — Run Phase 6 (Judge Scorecards)

```bash
C:/Users/sabzu/AppData/Local/Programs/Python/Python39/python.exe scrape_mmadecisions.py
```

**What this covers:** Official judge names, per-round scores, decision type from mmadecisions.com.

**Runtime:** 2–3 hours (threaded, mmadecisions rate-limits requests).

**Critical join rules (embedded — do not deviate):**
- Join to UFC fights by `date ±1 day` — never by `event_name` (names never match across sources)
- Fighter name matching uses `normName()` with NFD Unicode decomposition — never exact string match
- If names fail to match, check all 6 strategies: exact → space-collapse → anagram (length≥5) → first-name prefix → last-name → word-subset

---

## Step 3 — Verify Data

After both scrapers complete, run a verification query against the `fight_scraping_status` view:

```sql
SELECT * FROM fight_scraping_status
WHERE event_date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY event_date DESC;
```

Or via Supabase dashboard / Management API:
```
POST https://api.supabase.com/v1/projects/hyvyzuzlmnekzvtlauwi/database/query
Authorization: Bearer <SUPABASE_MANAGEMENT_KEY>
{ "query": "SELECT * FROM fight_scraping_status WHERE event_date >= NOW() - INTERVAL '7 days' ORDER BY event_date DESC" }
```

**Healthy result:** All fights from the event show stats populated, `judge_scores` present for completed fights.

**If judge scores missing:** This is expected for fights with no mmadecisions entry (pre-2010 or obscure cards). Current baseline: 5,412 complete, 55 partial, 678 missing.

---

## Step 4 — Deploy to Vercel (if needed)

Only needed if frontend code changed alongside the data update:

```bash
cd "c:/Users/sabzu/Documents/VS Ufc/ufc-web-app"
npm run build
git add -p
git commit -m "..."
git push
```

Vercel auto-deploys on push to main.

---

## Common Failure Modes

| Symptom | Likely Cause | Fix |
|---|---|---|
| Silent write failures, no error | Using anon key instead of service key | Set `SUPABASE_SERVICE_KEY` |
| `UnicodeEncodeError` | Missing UTF-8 reconfigure | Add `sys.stdout.reconfigure(encoding='utf-8', errors='replace')` at top of scraper |
| Scraper stops after 1 missing record | break-on-first logic | Should use consecutive-skip counter (N misses before stopping) |
| Threading errors with Supabase client | Shared client across threads | Each thread must use its own thread-local Supabase instance |
| Wrong fighter matched | Name format variation | Check all 6 `matchesFighter()` strategies; run normName debug |
| Judge scores not linking | event_name mismatch | Always join on `date ±1 day`, never `event_name` |
| Bout fields reversed | `bout` reversal bug | Always join on `fight_url`, never `bout`; within-source: test both orderings |

---

## Key Constraints (Never Deviate)

- **Join key across sources:** `fight_url` only — never `bout`, never `event_name`
- **`fight_meta_details.bout` vs `round_fight_stats.bout`** are often reversed — always match both orderings when joining within-source
- **`fight_dna_metrics` is a VIEW** — frontend reads here, never from raw `round_fight_stats`
- **`.limit(N)` on incremental queries is a bug** — dedup is per-record check, not pagination

For deeper scraper reference, read: `c:/Users/sabzu/Documents/VS Ufc/ufc-web-app/context/scrapers.md`
