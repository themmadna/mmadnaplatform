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

## Judge Analytics (Phase 4)

- **Within a single data source, exact name matching against a split bout string works.** `judge_scores.fighter` and `judge_scores.bout` both come from mmadecisions, so `LOWER(TRIM(fighter)) = LOWER(TRIM(SPLIT_PART(bout, ' vs ', 1)))` is reliable without fuzzy matching.
- **Cross-source judge↔fight join path:** `judge_scores.date ±1 day → ufc_events.event_date → fight_meta_details.event_name`. Never join on event_name directly — it never matches across mmadecisions and ufcstats.
- **For judge profile outlier detection, filter out 10-10 drawn rounds from all pct denominators.** A draw round has no winner, so calling it "unanimous" or "majority" is meaningless.
- **`agreement_type` as a single derived column (`'unanimous'/'majority'/'lone_dissenter'/'draw'`)** is cleaner than separate boolean flags — single CASE expression, easy to filter in all aggregations downstream.
- **For head-to-head judge comparison, keep the RPC lightweight (pure judge_scores) and derive by-division overlay client-side** by merging the two already-fetched `by_class` arrays. Avoids an expensive third fmd join.
- **When a comparison component needs a list for a picker, fetch the directory list inside the component.** It's 74 rows of JSON — cheap, keeps App.js state minimal.
- **User vs judge comparison reuses the `user_rounds` CTE from `get_user_judging_profile` verbatim**, then restricts `judge_scores` to `WHERE judge = p_judge`. No new join strategy needed — the ±1 day + last-name pattern covers both cases.
- **Scoring Tendencies DualBar maps cleanly across user and judge:** user `striking_vs_grappling_bias.striking_pct` ↔ judge `style_preference.striking_pct`; user `aggressor_bias` ↔ judge `aggressor_pct`; user `knockdown_bias.kd_bias_pct` ↔ judge `kd_pct`. Same definitions, different sources.
- **Pass `initialJudge` to skip the picker when navigating from a pre-selected context** (e.g. clicking a judge row in Judging DNA). Component falls back to the picker when `initialJudge = null`.

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
- **`isLocked={false}` should be passed to RoundScoringPanel even after fight ends** (`upcoming && isLocked`). Passing `true` sets `canSubmit = false` and `readOnly = true`, blocking users from scoring remaining rounds. Leaderboard ineligibility is tracked separately via `modified_after_reveal`.
- **ESPN occasionally returns `period = 0` at STATUS_FINAL.** Guard: use `period > 0 ? period : (scorableRounds || scheduledRounds || 3)` before writing `rounds_fought` to DB. Writing 0 causes `scorableRounds = 0` and the scoring panel disappears.
- **`useState` initializer only runs once on mount.** If fight prop data arrives late (async), `scorableRounds` stays at 0. Fix with a `useEffect` that syncs from fight prop fields when `scorableRounds === 0`.
- **`rounds_fought` fallback chain for `scorableRounds`:** `fight.rounds_fought` (if > 0) → `fight.scheduled_rounds` → `3`. Always show panel for ended fights even when ESPN data is missing.
- **Client-side polling is unreliable** — if no user has the fight detail page open, `fight_ended_at` / `rounds_fought` never get written. Fix: `poll-live-fights` Edge Function + pg_cron every minute (guarded by `ufc_events.start_time` + all-fights-ended check).
- **Supabase Management API ZIP upload for Edge Functions returns 500.** Use `npx supabase functions deploy --project-ref <ref> --no-verify-jwt` with `SUPABASE_ACCESS_TOKEN` env var instead. CLI handles bundling correctly; Management API requires an eszip bundle which Python can't easily produce.
- **`pg_cron` and `pg_net` are not enabled by default on new Supabase projects.** Enable via `CREATE EXTENSION IF NOT EXISTS pg_cron; CREATE EXTENSION IF NOT EXISTS pg_net;` through the Management API database/query endpoint (requires service role). After that, `cron.schedule()` and `net.http_post()` are available.
- **pg_cron + pg_net pattern for calling an Edge Function every minute:** `SELECT cron.schedule('job-name', '* * * * *', $$ SELECT net.http_post(url := '...', headers := '{"Content-Type":"application/json"}'::jsonb, body := '{}'::jsonb) $$)`. `net.http_post` is async — returns request_id immediately, fires in background. No auth header needed if `verify_jwt = false`.
- **UTC midnight date bug for live event polling:** UFC events start late US time and are still ongoing after UTC midnight. Never use `new Date().toISOString().slice(0,10)` alone to match `event_date` — use a 2-day window (`event_date >= yesterday AND event_date <= today`). Also always use `event.event_date` (not UTC today) as the ESPN scoreboard `dates=` param.

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

## Judging DNA Analytics

- **`loser_grd` was missing from `round_winner_stats` CTE** — `winner_grd` was present but the loser-side column was omitted. Always add both winner and loser columns together when extending the CTE.
- **Gender split via `weight_class_clean ILIKE 'Women%'` is sufficient** — all women's divisions contain "Women" in the clean name. No separate gender column needed.
- **For a gender toggle that affects pre-aggregated RPC scalars, return a `gender_split` object with both sub-objects** rather than making two separate RPC calls. Client picks the right sub-object by key. `accuracy_by_class` can be filtered client-side since the raw array is already returned.
- **Hide secondary toggles (e.g. "By Class") when a primary filter is active** — showing per-class breakdown inside an already-filtered gender view is redundant and confusing.
- **For "overall-only" stats in a filtered view, show a short inline note** rather than hiding the stats entirely — users should know the numbers are still overall, not gender-filtered.

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
