# Lessons Learned

Focused on reusable engineering patterns — implementation details live in git history.

---

## Phase 6a — DB Migration — 2026-03-07

**What worked:**
- `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS` make migrations idempotent — safe to re-run.
- Supabase Management API (`/v1/projects/{ref}/database/query`) handles DDL fine; each statement sent separately to isolate errors.
- `leaderboard_eligible` as a `GENERATED ALWAYS AS ... STORED` boolean column avoids app-layer logic drift — eligibility is always consistent with the source booleans.

**Nothing to change** — migration was straightforward.

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

## ML model — Phase 3c (round scoring)

- **Use differential features (f1_stat - f2_stat), not raw stats, for any symmetric prediction task.** The model should be position-agnostic; raw stats let it learn that one fighter "slot" is better.
- **Symmetric augmentation is the correct fix for positional bias in differential-feature models.** Mirror every row (negate diffs, flip label) so the training set is exactly 50/50. The LR intercept converges to ≈0 — a reliable sanity check.
- **`validate_scoring_model.py` was broken** — it joined judge_scores to round_fight_stats on `event_name`, which never matches across sources. The correct join is date ±1 via `ufc_events`, then fuzzy name matching. The existing validator's results were almost entirely from missing matches, not real agreement.
- **Control time is the most underweighted feature in the rules-based model.** EDA r=0.446 (third after sig_landed and total_landed), but the rules model assigns it weight=0.015. The ML model assigns it the highest coefficient (+1.007). Judges weight sustained control heavily.
- **Knockdowns are overweighted in the rules model** (weight=5.0). EDA r=0.196 — meaningful but lower than ctrl_sec, head_landed, dist_landed. A 5:1 ratio vs sig_landed is far too aggressive.
- **LR beats RF and XGBoost on well-engineered differential features.** The decision boundary for round scoring is largely linear — once you compute the right diffs, complex models add noise, not signal.
- **The 2016 ABC judging criteria shift shows in the data** (takedown advantage and ctrl_sec advantage both narrowed post-2016), but the `post_2016` feature coefficient converges to ≈0 during training. The stats themselves already encode the shift — the era flag is redundant once you have the actual stats.
- **Unicode accent normalization:** use `unicodedata.normalize('NFKD', s)` before the regex strip, not after. NFKD decomposes accented chars into base + combining mark, then the `[^a-z0-9\s]` strip removes the combining mark. This turns ñ→n, ä→a, ã→a correctly. Omitting this caused 45 name match failures.

---

## 10-8 round detection — empirical threshold derivation

- **KD is a poor signal for 10-8 detection.** 82.9% of real judge-scored 10-8 rounds had zero KD differential — the winner didn't land more knockdowns than the loser. The original rule (`winner_kd > 0`) was almost always wrong.
- **ML confidence is the correct signal.** 83.5% of real 10-8 rounds had model confidence ≥ 0.975, and the median was 0.997. Judges only score 10-8 when one fighter completely dominated the stats.
- **The threshold matters — start conservative.** 0.975 still produced too many 10-8s in practice. Tightening to 0.99 filtered out rounds that were dominant but not exceptional.
- **`ml_dataset.csv` already has an `is_10_8` flag** — no DB re-query needed for this kind of analysis. A short pure-Python script loading the CSV + `scoring_model.json` is sufficient.
- **Always deduplicate by `(fight_url, round)` when reading `ml_dataset.csv`** — it has one row per judge, so the same round appears 3× (once per judge). Use `is_10_8 = True` if ANY judge scored it 10-8.

---

## UX polish fixes

- **CSS mask-image is the cleanest scroll affordance on mobile.** Apply `maskImage: 'linear-gradient(to right, black 80%, transparent 100%)'` directly to the scrollable container — no background colour knowledge needed, works across all themes.
- **Scroll restoration needs two refs: a saved position and a previous-view tracker.** Save `window.scrollY` before navigating away, then in a `useEffect` watching `currentView`, restore when transitioning FROM the detail view (not on every render).
- **Card-level headers inside a page that already has a section header are redundant.** If the page header + context makes the card's purpose obvious, remove the card's own header rather than keeping both.

---

## Git hygiene

- **Before any cleanup or file deletion work, check for multiple `.git` directories** (`find . -name ".git" -maxdepth 3`). Two repos pointing to the same remote will produce destructive-looking commits from the other repo's perspective.
- **When two repos share a remote, establish the canonical one and delete the other's `.git` before making any commits.** Never push from both.
- **Always check `git remote -v` in both repos before any push** to confirm they're not sharing a remote.
