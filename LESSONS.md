# Lessons Learned

Reusable patterns and non-obvious gotchas. Organized by topic — add new entries under the relevant section, not chronologically.

---

## Database & Migrations

- **`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS` make migrations idempotent** — safe to re-run without side effects.
- **Supabase Management API (`/v1/projects/{ref}/database/query`) handles DDL fine** — send each statement separately to isolate errors.
- **`leaderboard_eligible` as `GENERATED ALWAYS AS ... STORED`** avoids app-layer logic drift — eligibility is always consistent with source booleans.
- **Don't change a DB schema mid-session without immediately updating both the data layer and the component.** The gap creates silent runtime errors (upsert inserts NULL into NOT NULL columns).
- **Storing `f1_score`/`f2_score` (both sides explicitly) is cleaner than `fighter_scored_for`/`points`.** Makes community scorecard aggregation trivial (just avg the columns); no need to know fighter names in the query. Convert at DB boundaries only — keep component internal logic in UI terms.
- **`accuracy_by_class` in RPCs must use a subquery to pre-aggregate before `json_agg`.** Cannot nest `AVG`/`COUNT` inside `json_agg(ORDER BY COUNT(*))` — PostgreSQL error 42803.

---

## Scrapers

- **`.limit(N)` on a query that claims to be "incremental" is usually a bug.** The per-record existence check is the deduplication mechanism, not the limit.
- **`break` on first existing record assumes no gaps ever exist.** A consecutive-skip counter (reset on any new insert) handles gaps without scanning all historical records.
- **Validate env var names against the actual `.env` file at the start of any scraper review.** Wrong variable names produce silent `None` failures that look like auth errors.
- **When a secondary scraper derives entity names from URL slugs, those names will never join to primary scraper data.** Always extract from link display text (proper casing, spaces). After fixing name derivation, truncate and re-scrape historical records — upsert conflict keys handle dedup cleanly.
- **For parallel scraping:** only the innermost tier (individual item pages) benefits from parallelization. Discovery tiers must stay sequential. Check thread-safety of the DB client — `supabase-py` is not concurrency-safe; use `threading.local()` per worker.
- **Always verify dedup/skip logic with a quick debug query before a long scraper run.** A broken dedup that always returns 0 results will re-scrape everything silently.
- **Phase 2 auto-delete guard requires two conditions:** local-date check (`date.today().isoformat()`, not `datetime.utcnow()`) AND `not any_newly_completed`. Either alone is insufficient — UTC rolls before US events end; `any_newly_completed` is False when Phase 0.5 re-adds already-completed fights from a prior run.

---

## Cross-Source Data Joining

- **Never join two different data sources on `event_name` or `bout` strings.** They will differ in formatting, punctuation, and casing. Use a neutral key like `date` or a normalized URL slug.
- **`fight_meta_details.bout` and `round_fight_stats.bout` are often reversed even though both come from ufcstats.** Always match both orderings: `rfs.bout = fmd.bout OR rfs.bout = TRIM(SPLIT_PART(fmd.bout,' vs ',2)) || ' vs ' || TRIM(SPLIT_PART(fmd.bout,' vs ',1))`. Discovered when bias stats showed 0% coverage for 4 of 7 weight classes despite data being present.
- **When broadening a DB-side filter for fuzzy matching, audit all downstream consumers.** A broader result set can introduce new bugs elsewhere (e.g. summary totals picking up rows from other fights on the same date).
- **Diagnostic "gaps" have three distinct root causes** — distinguish them before fixing: (a) data genuinely missing from the source, (b) wrong join condition (e.g. date offset for international events), (c) text format mismatch across sources. All three look the same until you dig.
- **±1 day date window** is correct for joining mmadecisions to UFC Stats. International events (Australia, Singapore, Abu Dhabi) consistently have a +1 day offset in mmadecisions dates.
- **Unicode accent normalization:** use `unicodedata.normalize('NFKD', s)` before the regex strip, not after. NFKD decomposes accented chars into base + combining mark, then the strip removes the combining mark. Omitting this causes name match failures (ñ→n, ä→a, ã→a).

---

## RPC / SQL Patterns

- **When two independently-computed percentages don't sum to 100%, normalize for display.** Show `s/(s+g)` and `g/(s+g)` so bar and labels agree. Keep raw values in the RPC; normalize only at the display layer.
- **Adding `judges_agreeing` as a window function in the `majority` CTE** alongside existing `f1_wins`/`f2_wins` is a clean extension — same partition, no extra CTE needed.
- **For `ten_eight_quality`, join `complete_judges` back to `round_accuracy`** (instead of a correlated subquery or EXISTS). Gives a clean flat join and avoids self-referencing CTE issues.
- **`agreement_breakdown` using `COUNT(*) FILTER (WHERE ...)` in a single aggregation** over `round_accuracy` is cleaner than a separate CTE — eliminates one CTE entirely.
- **Don't use `EXISTS` referencing a CTE name inside another CTE's WHERE clause.** SQL sees the CTE name as the table it's being filtered against, creating confusing scope. Use a JOIN instead.
- **`agreement_breakdown` and `accuracy` have different denominators by design:** agreement uses all rounds with judge data (including split-decision rounds where majority_winner IS NULL); accuracy uses only rounds with a clear majority. If the UI surfaces both totals, add a tooltip.

---

## Frontend Patterns

- **Cross-reference field access against the schema before writing any frontend code.** Silent failures (`undefined` rendering as nothing) are common when a field exists in one table but the query hits another. The `fights` vs `fight_meta_details` split is the main source of this.
- **Any hardcoded string argument where a state variable exists is a suspect.** If a re-fetch function hardcodes `'combined'` but a filter state variable controls the active tab, the tab will desync on re-fetch.
- **When adding click-outside handling, wrap the toggle button and dropdown in a single ref'd container.** Attaching the ref only to the dropdown causes a double-toggle: outside-click closes it, then the toggle button's `onClick` immediately re-opens it.
- **When a `locked` prop defaults to `false`, grep all call sites.** Every context that should lock must explicitly pass the prop — the default silently permits voting where it shouldn't.
- **When a child component re-fetches data the parent already has, pass it as a prop instead.** Duplicate fetches are a common performance leak in component trees.
- **When two sequential `await` calls hit the same table with identical filters, merge them into one query and split the result client-side.**
- **Gate/lock booleans should be derived state, not computed inline in JSX.** `isLive = !!fightStartedAt && !fightEndedAt` — keeps 3-state branching readable.
- **For badge conditions that depend on DB fields not reliably present on fight objects, inject at the data layer** (e.g. `handleEventClick` spreading `event_date`), not via conditional logic in the badge render.

---

## Live Events & ESPN

- **ESPN scoreboard works for historical dates** — `site.api.espn.com/.../scoreboard?dates=YYYYMMDD` returns `STATUS_FINAL` for past events. `comp.status.type.name` is the correct field.
- **ESPN scoreboard is ephemeral** — only serves live data during the event window. Always persist to DB immediately on state change; do not rely on ESPN being available after the event.
- **Poll timing:** immediate `poll()` on effect mount fires before `eventFights` loads from Supabase → `liveFights.length === 0` → silent no-op. Fix with `setTimeout(poll, 3000)` for the first call.
- **Event-level poll should skip ticks (return), not stop, when `liveFights.length === 0`.** Stopping permanently prevents re-detection if fights load late.
- **ESPN-detected FINAL fights have `fight_ended_at` set but `status` still `'upcoming'` until the scraper runs.** Badge `isCompleted` must check `|| !!fight.fight_ended_at`, not just `status === 'completed'`.
- **`verify_jwt` must be `false` on Edge Functions called from the browser.** Default `true` causes Supabase middleware to reject valid user JWTs before function code runs. Set via Management API PATCH.
- **For all Edge Functions deployed via Management API: use `fetch` + REST API. No esm.sh imports.** Management API deployments are not pre-bundled; `esm.sh` imports cause BOOT_ERROR. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected env vars.
- **Deploy a minimal no-import function first** to confirm the runtime is healthy before adding logic.
- **`STATUS_FIGHTERS_WALKING` should NOT trigger live.** Treat as upcoming — do not call the Edge Function.

---

## ML Model & Scoring

- **Use differential features (f1_stat - f2_stat), not raw stats, for any symmetric prediction task.** Raw stats let the model learn that one fighter "slot" is better.
- **Symmetric augmentation is the correct fix for positional bias.** Mirror every row (negate diffs, flip label) — LR intercept converges to ≈0.
- **Control time is the most underweighted feature in rules-based models.** EDA r=0.446; rules model assigns weight=0.015; ML assigns highest coefficient (+1.007).
- **Knockdowns are overweighted in the rules model** (weight=5.0 vs EDA r=0.196). A 5:1 ratio vs sig_landed is too aggressive.
- **LR beats RF and XGBoost on well-engineered differential features.** The decision boundary for round scoring is largely linear.
- **The 2016 ABC judging criteria shift shows in data but `post_2016` flag coefficient converges to ≈0.** The stats already encode the shift — era flag is redundant.
- **`validate_scoring_model.py` was broken** — it joined judge_scores to round_fight_stats on `event_name`. The correct join is date ±1 via `ufc_events`, then fuzzy name matching.
- **KD is a poor signal for 10-8 detection.** 82.9% of real 10-8 rounds had zero KD differential. ML confidence (≥ 0.99) is the correct signal.
- **Always deduplicate `ml_dataset.csv` by `(fight_url, round)`** — it has one row per judge, so the same round appears 3×. Use `is_10_8 = True` if ANY judge scored it 10-8.

---

## Phase 6 Scoring UI

- **`fighter_scored_for`/`points` schema was replaced by `f1_score`/`f2_score`.** Convert at DB boundaries only — `f1_score >= f2_score ? f1Name : f2Name` on load handles the tie edge case (10-10) by defaulting to f1.
- **`upsertScorecardState` with `onConflict`** — only provided columns written on conflict, so partial updates (e.g. just `modified_after_reveal: true`) don't overwrite other fields.
- **`pending` state initialized from DB scores on mount** → existing selections pre-highlighted on re-visit without special logic.
- **Auto-reveal only fires when `isLocked || isHistorical`** — prevents premature lockout between live rounds (e.g. between round 1 and round 2 of a live fight).
- **`RoundScoringPanel` needs `meta` for fighter names and round count.** Fights completed via ESPN polling (status still 'upcoming', meta null) cannot show the scoring panel until the scraper has run.
- **For a "scored fights" list, source fighter names from `fight_meta_details` (via `fight_url`), not `fights.bout`.** `fights.bout` is often reversed vs the f1/f2 ordering used in `user_round_scores`. Using `fighter1_name`/`fighter2_name` from meta is the only reliable way to map f1_total → correct fighter name.
- **When aggregating `user_round_scores` client-side, a 3-step query is sufficient:** (1) round scores → fight_id totals, (2) `fights` by IDs, (3) parallel `fight_meta_details` + `ufc_events`. No RPC needed. Sort by `event_date` desc (localeCompare on ISO string is safe).
- **Winner comparison in the scored fights list uses `normN` (lowercase + strip non-alphanumeric)** — `fights.winner` and `fight_meta_details.fighter1_name` both come from UFC Stats so they usually match exactly, but normN handles edge cases (punctuation, accents).

---

## UX Polish

- **CSS mask-image is the cleanest scroll affordance on mobile.** Apply `maskImage: 'linear-gradient(to right, black 80%, transparent 100%)'` directly to the scrollable container.
- **Scroll restoration needs two refs: a saved position and a previous-view tracker.** Save `window.scrollY` before navigating away; restore on transition FROM the detail view, not on every render.
- **Card-level headers inside a page that already has a section header are redundant.** Remove the card's own header if the page context makes its purpose obvious.

---

## Git Hygiene

- **Before any cleanup or file deletion work, check for multiple `.git` directories** (`find . -name ".git" -maxdepth 3`). Two repos pointing to the same remote produce destructive-looking commits.
- **When two repos share a remote, establish the canonical one and delete the other's `.git` before making any commits.** Never push from both.
- **Always check `git remote -v` in both repos before any push** to confirm they're not sharing a remote.

---

## Windows / Python

- **Never use emoji in `print()` on Windows without explicitly setting `sys.stdout` to UTF-8.** On `cp1252` terminals, emoji throw `UnicodeEncodeError` after the DB write has already committed — operation succeeds but counter breaks, causing silent early termination. Fix: `sys.stdout.reconfigure(encoding='utf-8', errors='replace')` at the top of the script.
- **`echo yes | python script.py` doesn't work in background task mode.** Use an explicit `--yes` argparse flag.
- **Python stdout in background bash tasks won't flush** unless launched with `-u` (unbuffered) flag.
