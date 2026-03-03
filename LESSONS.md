# Lessons Learned

Focused on reusable engineering patterns — implementation details live in git history.

---

## Cross-source data joining

- **Never join two different data sources on `event_name` or `bout` strings.** They will differ in formatting, punctuation, and casing. Use a neutral key like `date` or a normalized URL slug.
- **When broadening a DB-side filter for fuzzy matching, audit all downstream consumers.** A broader result set can introduce new bugs elsewhere (e.g. summary totals picking up rows from other fights on the same date).
- **Diagnostic "gaps" have three distinct root causes** — distinguish them before fixing: (a) data genuinely missing from the source, (b) wrong join condition (e.g. date offset for international events), (c) text format mismatch across sources. All three look the same until you dig.
- **±1 day date window** is the correct approach for joining across mmadecisions and UFC Stats. International events (Australia, Singapore, Abu Dhabi) consistently have a +1 day offset in mmadecisions dates.
- **Always verify dedup/skip logic with a quick debug query before a long scraper run.** A broken dedup that always returns 0 results will re-scrape everything on every run silently.

---

## Scraper patterns

- **`.limit(N)` on a query that claims to be "incremental" is usually a bug.** The per-record existence check is the deduplication mechanism, not the limit.
- **`break` on first existing record assumes no gaps ever exist.** A consecutive-skip counter (reset on any new insert) handles gaps without scanning all historical records.
- **Validate env var names against the actual `.env` file at the start of any scraper review.** Wrong variable names produce silent `None` failures that look like auth errors.
- **When a secondary scraper derives entity names from URL slugs, those names will never join to primary scraper data.** Always extract from link display text (proper casing, spaces). After fixing name derivation, truncate and re-scrape historical records — upsert conflict keys handle dedup cleanly.
- **For parallel scraping:** only the innermost tier (individual item pages) benefits from parallelization. Discovery tiers (listing/event pages) must stay sequential. Check thread-safety of the DB client before parallelizing any write loop — `supabase-py` is not concurrency-safe; use `threading.local()` per worker.

---

## Windows / Python gotchas

- **Never use emoji in `print()` on Windows without explicitly setting `sys.stdout` to UTF-8.** On `cp1252` terminals, emoji in worker threads throw `UnicodeEncodeError` after the DB write has already committed — the operation succeeds but the counter breaks, causing silent early termination.
- **`echo yes | python script.py` doesn't work in background task mode.** Use an explicit `--yes` argparse flag instead.
- **Python stdout in background bash tasks won't flush unless launched with `-u` (unbuffered) flag.**

---

## Frontend patterns

- **Cross-reference field access against the schema before writing any frontend code.** Silent failures (`undefined` rendering as nothing) are common when a field exists in one table but the query hits another. The `fights` vs `fight_meta_details` split is the main source of this.
- **Any hardcoded string argument where a state variable exists is a suspect.** If a re-fetch function hardcodes `'combined'` but a filter state variable controls the active tab, the tab will desync on re-fetch.
- **When adding click-outside handling, wrap the toggle button and dropdown in a single ref'd container.** Attaching the ref only to the dropdown causes a double-toggle: outside-click closes it, then the toggle button's `onClick` immediately re-opens it.
- **When a `locked` prop defaults to `false`, grep all call sites.** Every context that should lock must explicitly pass the prop — the default silently permits voting where it shouldn't.
- **When a child component re-fetches data the parent already has, pass it as a prop instead.** Duplicate fetches are a common performance leak in component trees.
- **When two sequential `await` calls hit the same table with identical filters, merge them into one query and split the result client-side.**

---

## Git hygiene

- **Before any cleanup or file deletion work, check for multiple `.git` directories** (`find . -name ".git" -maxdepth 3`). Two repos pointing to the same remote will produce destructive-looking commits from the other repo's perspective.
- **When two repos share a remote, establish the canonical one and delete the other's `.git` before making any commits.** Never push from both.
- **Always check `git remote -v` in both repos before any push** to confirm they're not sharing a remote.
