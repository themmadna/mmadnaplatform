# Lessons Learned

Reusable patterns and non-obvious gotchas. Organized by topic — add new entries under the relevant section, not chronologically.

---

## Security

- **Supabase RLS is not enabled by default.** Tables are world-readable to any authenticated caller with the anon key unless you explicitly `ENABLE ROW LEVEL SECURITY` and add policies. Confirmed: user_round_scores, user_fight_scorecard_state, user_votes, and profiles were all open until 2026-04-14. Always deploy RLS policies in a version-controlled script — they are invisible if only configured in the dashboard.
- **Supabase Edge Function auth: check header presence ≠ validate JWT.** `if (!authHeader)` only confirms the header exists — it does not validate the token. To validate: call `${SUPABASE_URL}/auth/v1/user` with the Authorization header and SUPABASE_ANON_KEY as apikey. If the response is not 200, reject the request. `SUPABASE_ANON_KEY` is available as a built-in env var in Edge Functions.
- **`.gitignore` on Windows can silently corrupt to space-separated characters.** A UTF-16/encoding artifact can turn two rules on separate lines into one garbled line. Verify with `git status` — if an intended-excluded file shows as `??` untracked, the gitignore rule failed. Always check gitignore is actually working after editing on Windows.
- **`build/` must be in `.gitignore` for CRA projects.** CRA bakes `REACT_APP_*` env vars into `build/static/js/*.js` at compile time. The anon key is intentionally public, but committing build artifacts creates unnecessary permanent history exposure.
- **PostgreSQL RLS OR-combines PERMISSIVE policies for the same command.** A leftover `qual = true` SELECT policy on `user_votes` made the new `user_id = auth.uid()` own-only policy moot — `true OR own_only` reduces to `true`. When deploying RLS, always `DROP POLICY IF EXISTS` for any prior policy on the same (table, cmd) before `CREATE POLICY`, or run `pg_policies` after deploy to confirm only the intended policies remain.
- **A new deploy script does not replace old policies/functions** unless it explicitly drops them. April's `deploy_rls_policies.py` added 4 new `user_votes_*_own` policies but left 4 pre-existing policies untouched. Same trap for `get_user_judging_profile(uuid)`: redeploying the no-arg overload doesn't drop the deprecated arg overload — Postgres treats them as separate signatures. Audit `pg_policies` and `information_schema.role_routine_grants` after every redeploy.
- **Deprecated SECURITY DEFINER overloads remain exploitable.** A function granted to `anon` that takes `user_id` as a parameter and `SELECT`s from a user-data table under DEFINER privs is an IDOR vector even if the function later errors on renamed columns — the privileged SELECT runs before the error. Treat deprecated DEFINER functions as live security surface until DROPPED, not until "no longer called by the frontend."
- **Supabase backup tables created by migrations need explicit RLS + grant treatment.** `user_votes_backup` and `fight_ratings_backup` were left with `relrowsecurity = false` and full anon CRUD grants. The default `CREATE TABLE` in Supabase gives `anon` SELECT+INSERT+UPDATE+DELETE+TRUNCATE. Either drop the backup table immediately after the migration succeeds, or apply the same RLS treatment as the source table.
- **Bake destructive cleanup into the existing deploy script, not a one-off.** When dropping a deprecated policy/function/overload (Phase A of the 2026-05-16 audit remediation), prepend `DROP POLICY|FUNCTION|TABLE IF EXISTS` directly into the deploy_*.py script that already manages the surviving object, then run it. The script becomes self-healing: anyone running it on a fresh environment cleans up the legacy artifact automatically, and there's no separate `cleanup_*.py` to remember. `IF EXISTS` keeps it idempotent. The pre-flight (verify live data ≥ backup data) does belong in a standalone script — pre-flight is one-shot, the DROP itself goes in the durable deploy.
- **Pre-flight every destructive DB op against the live data it depends on.** Before dropping `user_votes_backup`, the cleanup script counted `live_user_votes vs backup_user_votes` and aborted if live < backup. Took 5 minutes to add, caught nothing (live was 240 vs 130 backup), but is the only defense against the case where the live table got truncated since the backup was taken. Verify the invariant the migration relied on still holds *at the moment of drop*, not at the moment the audit was written.
- **`supabase.auth.signOut()` only clears auth tokens — it does not touch app-managed client state.** Any sessionStorage/localStorage keys you populated (guest votes/scores/spoiler preferences) and any React state holding personalised data (userHistory, combatDNA, comparisonData) survive the sign-out unless you explicitly clear them. On a shared device, the next visitor inherits the leftover state. Pattern: a single `clearAll()` exported from the storage module that wipes every namespaced key, called from `handleSignOut` alongside the React `set*` resets. Co-locating the key list in the storage module (not in the sign-out handler) means a new key added later is automatically cleaned up.

---

## Testing

- **CRA's Jest ships with jsdom — `sessionStorage` works in tests with no mocking.** `beforeEach(() => sessionStorage.clear())` is the only setup needed for `guestStorage.js` tests. No manual mock or `jest.fn()` required.
- **`CREATE INDEX IF NOT EXISTS` makes index deploy scripts idempotent** — safe to re-run at any time without checking whether the index already exists. Use this pattern in all `deploy_indexes.py` style scripts.

---

## Database & Migrations

- **`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and `CREATE TABLE IF NOT EXISTS` make migrations idempotent** — safe to re-run without side effects.
- **Supabase Management API (`/v1/projects/{ref}/database/query`) handles DDL fine** — send each statement separately to isolate errors.
- **`leaderboard_eligible` as `GENERATED ALWAYS AS ... STORED`** avoids app-layer logic drift — eligibility is always consistent with source booleans.
- **When adding a FK to a table with 40k+ rows, the Management API statement timeout blocks a single UPDATE JOIN.** Backfill in Python instead: fetch the mapping table, build a dict, then PATCH via the REST API in batches grouped by the target FK value. The REST API has a 1000-row default page limit — always paginate with offset loops.
- **A FK requires a UNIQUE constraint (or PK) on the referenced column.** `fights.fight_url` had no unique constraint — `ADD CONSTRAINT fights_fight_url_key UNIQUE (fight_url)` must come first. Check for duplicates before adding: `SELECT fight_url, COUNT(*) FROM fights GROUP BY fight_url HAVING COUNT(*) > 1`.
- **Don't change a DB schema mid-session without immediately updating both the data layer and the component.** The gap creates silent runtime errors (upsert inserts NULL into NOT NULL columns).
- **Storing `f1_score`/`f2_score` (both sides explicitly) is cleaner than `fighter_scored_for`/`points`.** Makes community scorecard aggregation trivial (just avg the columns); no need to know fighter names in the query. Convert at DB boundaries only — keep component internal logic in UI terms.
- **`accuracy_by_class` in RPCs must use a subquery to pre-aggregate before `json_agg`.** Cannot nest `AVG`/`COUNT` inside `json_agg(ORDER BY COUNT(*))` — PostgreSQL error 42803.
- **Nullable FK columns silently rot.** `round_fight_stats.fight_url` was added with a FK (April migration) but kept nullable. The scraper's Phase 4 insert never started populating it, so 270 recent rows have NULL fight_url and the FK never fires. Either tighten to `NOT NULL` after the backfill, or pair the FK migration with a same-PR scraper change. A nullable FK does not enforce what its name suggests. **Resolved 2026-05-24 (S-P1-5):** stamped `fight_url` at the Phase 4 upsert site (value was already in the `fight_scraping_status` task dict — no extra HTTP); one-time backfill cleared 334 historical rows via `supabase/backfill_rfs_fight_url.py`. The audit's 270-row estimate was low because a 6th event had landed in the interim — pre-flight count is the source of truth, not the audit.
- **Sibling-FK parity is its own audit lens.** When several tables hang off the same parent FK (e.g. 4 user-data tables on `fights.id`), check that they share one `ON DELETE` behavior. `user_votes.fight_id` was `NO ACTION` while the other 3 CASCADE'd — invisible to the live app, but the day someone deletes a fight you get a half-deleted state (3 tables cleared, 1 blocks). A single `pg_constraint` query joining sibling tables exposes the drift in seconds and is worth running whenever a new user-data table is added. Resolved 2026-05-24 (S-P1-7) via `supabase/migrate_user_votes_cascade.py`.
- **Swap a FK delete behavior with a single-transaction DROP + ADD.** PostgreSQL has no `ALTER CONSTRAINT ... ON DELETE CASCADE` syntax — you must drop and re-create. Wrap in `BEGIN ... COMMIT` so the column is never momentarily unconstrained. Pre-flight should re-check orphan count (re-adding the FK will fail if any orphans exist) and exit clean if the constraint is already in the target state (`pg_constraint.confdeltype = 'c'` for CASCADE, `'a'` for NO ACTION).
- **Uniqueness keys built on display strings fail under aliasing — and the failure is silent.** `round_fight_stats` UNIQUE is `(event_name, bout, round, fighter_name)`. Fight 8754 was scraped under two name variants ("Patricio Freire" on one ufcstats page, "Patricio Pitbull" on another) and the UNIQUE key let both sets coexist because `bout` differed. Both sets had identical stats AND `fighter_name='Patricio Pitbull'` — so any GROUP BY `fighter_name` aggregation (per-fighter career stats, scoring-model features) silently doubled this fight's contribution. The frontend was fine because `fight_dna_metrics` happens to filter by a specific `bout`, but the bug was invisible from the view layer. **Lesson:** when a UNIQUE key includes any column that's a scraped display string subject to aliasing, treat duplicates-under-alias as a "when" not "if" — pair the UNIQUE with a stable opaque key (here, `fight_url`) and prefer that key for joins and aggregations. The S-P1-5 (`rfs.fight_url` populate + backfill) and S-P2-11 (view refactor to join via `fight_url`) work is the durable fix; one-off dedup scripts like `fix_fight_8754_alias.py` are band-aids until that lands.
- **When deduping bout-aliased rows, UPDATE the parent's bout BEFORE the DELETE — both inside one transaction.** Any view or query that joins `fights.bout = round_fight_stats.bout` would briefly return no rows for the fight in the window between a child DELETE and a parent UPDATE if they ran separately. Wrap both in `BEGIN ... COMMIT` so that's structurally impossible, and order them UPDATE-then-DELETE as a defensive belt-and-braces — the row never disappears from the view even mid-transaction.
- **A view that joins on the same key its source data was backfilled with by mistake will hide the backfill bug forever.** April 2026's `migrate_round_stats_fk.py` backfilled `rfs.fight_url` from `fmd` with a bout-text-only join (no `event_name` filter). For 1237 rows from 220 fighter pairs that fought twice across events (rematches), Postgres picked the wrong `fmd` row and stamped the wrong `fight_url`. The bug was invisible for ~5 weeks because `fight_dna_metrics` joined on `(event_name, bout)` text, not on `rfs.fight_url` — so the dormant misstamps had no behavioral effect. It only surfaced as a 215-fight regression risk when pre-flighting the S-P2-11 refactor (which would have switched the view to join on `fight_url`). **How to apply:** when refactoring a join key, don't just compare row counts pre/post — diff *per-row aggregates* under both join strategies on the live data. Bucket the diff (identical / new-only / old-only / partial drift). Any non-identical bucket > 0 means hidden data divergence, not refactor risk. Resolved 2026-05-24 (S-P1-18) via `supabase/fix_rfs_fight_url_misstamps.py` — re-stamped with an event-aware bidirectional bout match, then deployed S-P2-11 view refactor on top.
- **Backfilling any text-aliased FK requires the parent's natural key in the join, not just the textual match.** The mistake in `migrate_round_stats_fk.py` was joining `rfs.bout = fmd.bout` without `rfs.event_name = fmd.event_name`. The "fighter1 vs fighter2" string is not unique across the historical UFC catalog — the same pairing recurs at multiple events. Same trap will bite any future text-based backfill (judge_scores → fights, fighter aliases → roster). **How to apply:** when writing a backfill UPDATE that uses a "natural" text key, add every column needed to uniquely identify the row in the parent. If unsure, run `SELECT key_cols, COUNT(*) FROM target GROUP BY key_cols HAVING COUNT(*) > 1 LIMIT 5` first.
- **For a view refactor, "expected" divergence is sometimes a fix, not a regression — but you must enumerate it.** S-P2-11 left exactly 1 fight (id=3436, the Ultimate Japan Sakuraba/Silveira "Overturned" no-contest) with a value drop: old view had 4 sig-strikes (text-joined from the same-card rematch's rfs), new view has 0. The old view was double-counting the rematch's stats onto the no-contest because both fights rows share identical (event, bout) text. The new view correctly attributes to one. The deploy script whitelists `{3436}` as an EXPECTED_DIVERGENCES set and fails only on unexpected drift — keeps the parity check honest without false-flagging known-good fixes.

---

## Deployment

- **Vercel auto-detects `requirements.txt` and tries to install Python deps — even for React projects.** If a `requirements.txt` exists, Vercel runs `uv pip install` on it before the Node build. Pinned old packages (e.g. `pandas==1.5.3`) break on Vercel's current Python (3.14+). Fix: add a `vercel.json` that explicitly sets `installCommand: "npm install"` to prevent Vercel ever touching the Python packages. The scraper deps are local-only and have no place in a Vercel build.

---

## Post-Event Data Ops

- **After every master scraper run, audit the updated event card before presenting the summary.** Check for: stale `upcoming` fights (cancelled bouts), duplicate `card_position` rows (replaced matchups — delete the upcoming one), and `completed` fights with `winner: null` (scrape the `fight_url` for No Contest or draw). Report findings to Bastian before making any changes.
- **Cancelled bouts don't get UFCStats fight pages** — they remain in the DB as `upcoming` indefinitely unless manually deleted. The scraper has no mechanism to detect cancellations.
- **Replaced matchups leave two rows at the same `card_position`** — one `upcoming` (original opponent), one `completed` (replacement). The `upcoming` one should be deleted.
- **No Contest results appear as `nc` in UFCStats HTML** — the scraper doesn't currently parse these, so NCs land as `completed` with `winner: null`. Fix by setting `winner: 'NC'` manually after auditing the fight page.
- **Draw detection: count completed-status updates vs winner writes.** If Phase 2 updates N fights to `completed` but Phase 3 only writes N-1 winners, the missing fight is a draw (scraper skips winner writes for draws). Confirm with a DB query (`winner: null, status: completed`) and manually set `winner: 'Draw'`. Catch weight bouts are especially prone to draws.
- **`fights.winner = NULL` on a "Decision - X" method is not automatically a parser bug — verify against ufcstats first.** UFCStats labels Majority Draws and Unanimous Draws under the same "Decision - Majority" / "Decision - Unanimous" `Method` field, distinguishing only by both fighters having "D" status (vs one "W" + one "L"). The Phase 3 parser correctly returns `winner=None` for these because neither `r1` nor `r2` is `"W"`. **Why:** during the 2026-05-23 S-P1-4 investigation, the 2026-05-16 audit had flagged 3 NULL-winner decisions (8281/8269/8761) as a parser silent-failure and proposed backfilling synthetic winners — all 3 were genuine draws. Blind backfill would have corrupted the data. **How to apply:** before any "backfill NULL winner" work, screenshot the ufcstats page (or scrape with browser headers and check the status icons). Three judges scoring 28-28 across the board is the signature pattern.
- **For a frontend that hides draws, `winner=NULL` is invisible — render "Draw — {method}" explicitly on completed fights where winner is NULL and the method starts with "Decision".** Before 2026-05-23, `ScorecardComparison`'s "Official Result" card fell through to displaying just `meta.method` ("Decision - Majority"), with no "Draw" wording. `FightDetailView`'s green result banner hid entirely. Users couldn't tell whether the data was missing or the fight ended in a draw.
- **A replaced opponent gets a NEW ESPN competition ID — which defeats *both* of the poller's match strategies at once.** On UFC Fight Night: Song vs Figueiredo (2026-05-30), three bouts had late opponent swaps (Salikhov→Harris, Aguilar→Gurule, Taveras→Vera). ESPN re-created each competition under a new id, so `espn_competition_id` (we stored the old one) missed, and `boutMatchesComp` missed too because it requires *both* fighters to match and one had changed. Result: the rows never got `fight_started_at`/`fight_ended_at` and sat frozen as `upcoming`. **How to apply:** when a fight is stuck `upcoming` after an event, check ESPN's live card for the *same fighter with a different opponent* before assuming cancellation — and verify against ESPN, since the surface symptom ("upcoming after the event") is identical for cancellations and swaps. Confirmed via the ESPN scoreboard: all 13 bouts were FINAL; only the second fighter differed on three.
- **The frontend "event is over" signal must key off the main event, never "all fights ended."** `isLiveEvent()` was purely time-based (`event_date===today && start_time<=now`), so an event showed LIVE until local midnight. The instinct to fix it with "are all fights done?" fails: scratched/replaced bouts never reach FINAL, so that check never trips. The robust signal is the main event (lowest `card_position`) finalizing — it always fights last, so once it ends the card is over. Implemented as `ufc_events.ended_at`, stamped by `poll-live-fights` and checked by `isLiveEvent`. Same `ended_at` (or `eventFights[0].fight_ended_at`) gates the fights view to hide never-started bouts so phantom "Upcoming" cards disappear without waiting on DB cleanup. Add two backstops so the rare "main event itself is unmatchable" case can't keep an event LIVE: a frontend time fallback (`now > start_time + 8h`) and a scraper-side `stamp_event_ended_at` (sets `ended_at` = the event's latest `fight_ended_at`).
- **ESPN and ufcstats can name the same fighter differently — producing a split-data duplicate where one row has the live data and the other has the result.** On Song vs Figueiredo, Ding Meng's opponent is "Jose Henrique" on ESPN but "Jose Souza" on ufcstats (same person). The poller stamped the original `upcoming` row (ESPN name "Jose Henrique") with `fight_started/ended_at` + `comp_id`; the later ufcstats Phase 2 scrape didn't recognize the name and inserted a SECOND `completed` row ("Jose Souza vs Ding Meng") carrying the winner/method/fmd/rfs. Net: two rows, one physical fight, data split across them. **How to apply:** (1) the surface symptom ("orphan upcoming row after the event + a duplicate completed row") is identical for a genuine opponent swap vs a cross-source name variant — verify against BOTH sources before acting: if ESPN's comp competitors include the *old* name AND it's FINAL, it's a name variant, not a swap (per [[verify-audit-premise-before-fix]]). (2) Merge by KEEPING the completed row (it owns the real `fight_url` + fmd + rfs), porting the ESPN fields (comp_id/card_position/scheduled_rounds/timestamps) onto it, and deleting the orphan — never the reverse, because deleting the row that owns the canonical `fight_url` risks cascading away fmd/rfs. (3) Check user-data counts on BOTH rows first — `fight_id` deletes now CASCADE (S-P1-7), so an orphan with votes/scores must have that data moved before delete. Here both rows had 0 user data → lossless. Durable prevention: add the variant to `_FIGHTER_ALIASES` so the poller/Phase 2 stop re-duplicating. Resolved 2026-05-31 via `supabase/fix_ding_meng_souza_dup.py`.
- **A fighter is unique within an event — so matching an unclaimed ESPN comp by a SINGLE shared fighter is safe, and it resolves opponent swaps.** When an opponent change defeats both the id match and the both-fighters name match, you can still confidently re-attach the fight to ESPN: among comps not already claimed by another fight, find the one sharing exactly one fighter (require a single unambiguous candidate). On match, re-link `espn_competition_id` AND rewrite `bout` to ESPN's two names. The bout rewrite is the key trick — it means the later ufcstats scrape matches the row in place (both fighters now correct) instead of inserting a duplicate completed row. Confirmed live on Song vs Figueiredo: the deployed swap-aware poller resolved all 3 swapped rows (Matthews/Harris, Tsuruya/Gurule, Zhu/Vera) within one cron cycle, no duplicates, no manual deletion needed. Caveat: `fight_started_at`/`fight_ended_at` get set to poll-time (not real fight time) for a bout first seen already-FINAL — cosmetic; real round data comes from ufcstats. The mirrored `FightDetailView` client poll deliberately does NOT replicate swap-resolution.

---

## Scoring UI

- **A "submit" step is only needed if the reveal timing matters for eligibility AND auto-reveal can't cover all paths.** If you add a `useEffect` that auto-reveals when the fight locks (covering the case where all rounds were saved before the final bell), the explicit submit button becomes dead UI and can be removed entirely. Check all trigger paths before adding any manual step.

---

## Scrapers

- **`.limit(N)` on a query that claims to be "incremental" is usually a bug.** The per-record existence check is the deduplication mechanism, not the limit.
- **`break` on first existing record assumes no gaps ever exist.** A consecutive-skip counter (reset on any new insert) handles gaps without scanning all historical records.
- **Validate env var names against the actual `.env` file at the start of any scraper review.** Wrong variable names produce silent `None` failures that look like auth errors.
- **When a secondary scraper derives entity names from URL slugs, those names will never join to primary scraper data.** Always extract from link display text (proper casing, spaces). After fixing name derivation, truncate and re-scrape historical records — upsert conflict keys handle dedup cleanly.
- **For parallel scraping:** only the innermost tier (individual item pages) benefits from parallelization. Discovery tiers must stay sequential. Check thread-safety of the DB client — `supabase-py` is not concurrency-safe; use `threading.local()` per worker.
- **Always verify dedup/skip logic with a quick debug query before a long scraper run.** A broken dedup that always returns 0 results will re-scrape everything silently.
- **Phase 2 auto-delete guard requires two conditions:** UTC datetime + 34-hour buffer AND `not any_newly_completed`. Either alone is insufficient. The 34-hour buffer (`event_date midnight UTC + timedelta(days=1, hours=10)`) covers UTC-8 events plus card overrun — never use `date.today()` which is UTC on GitHub Actions runners and fires the guard mid-event.
- **GitHub Actions runners are UTC — `date.today()` is not local time.** Any scraper logic that was deliberately written to use local time (e.g. the Phase 2 auto-delete guard) breaks when run on a GitHub Actions ubuntu-latest runner. Rewrite using UTC datetime arithmetic with explicit timezone buffers instead of relying on the execution environment's clock.
- **`is_live_window()` must use a 2-day UTC window** (`yesterday_utc` to `today_utc`) to find the current event — mirrors the `poll-live-fights` Edge Function. US events run Saturday 10pm-2am ET which is Sunday UTC; a single-day `event_date = today` query finds nothing during the main card.
- **Fail-safe on NULL `start_time` in live guards.** If `ufc_events.start_time` is NULL (Phase 5 hasn't run), the live-mode guard must exit cleanly rather than proceed without a window check. Running Phases 2-4 without knowing the event has started risks triggering the auto-delete guard prematurely.
- **Use `fight_ended_at IS NULL` as the live-mode upper bound**, not `start_time + N hours`. It's accurate regardless of whether `start_time` is NULL, and self-heals when `poll-live-fights` writes the final timestamp. A time-bound upper limit would exit prematurely if a card runs long.
- **`concurrency: cancel-in-progress: false` for scraper workflows.** Using `true` kills a mid-write Phase 3 run when the next cron fires, risking partial `fight_meta_details` inserts. Let the in-flight run complete.
- **Alias-aware dedup must be applied everywhere a fight name is compared, not just in `_names_match`.** Phase 0.5 used an exact-string `existing_bouts` set — so even though `_FIGHTER_ALIASES` mapped "Patricio Pitbull" → "Patricio Freire", Phase 0.5 still inserted a duplicate because the set check doesn't use aliases. Fix: use `_bout_matches(f1, f2, b)` as a fallback after the exact check. Same fix applied to Phase 2's `existing_map` lookup — fall back to a linear `_bout_matches` scan before inserting a new completed fight.
- **A scrape source can start gating its pages behind a JS challenge overnight — and an unguarded `find('table')` turns that into a total pipeline crash.** As of ~2026-05-30 ufcstats.com began serving a self-hosted **SHA-256 proof-of-work** challenge (origin `nginx`, NOT Cloudflare) to plain `requests` — "Checking your browser…" instead of the real page. Two compounding failures: (1) the block was invisible because the ESPN-based `poll-live-fights` poller kept working (event showed live→ended normally), so only the *ufcstats-sourced* data silently vanished — clean break in the DB (every event through 2026-05-16 complete, 2026-05-30 had 0 winners/0 round-stats); (2) Phase 0's `soup.find('table',…).find_all(…)` had no None-guard, so the challenge raised `AttributeError` and **crash-aborted the entire run on the first phase**, so Phases 1–4 never ran either. **How to apply:** (a) when post-event data is missing but the event otherwise looks handled, fetch the source URL directly and check for a challenge stub before assuming a parser/join bug — confirm with sandbox disabled since a sandbox proxy can produce a similar interstitial. (b) Header/UA tweaks and `cloudscraper` do NOT clear a non-Cloudflare PoW challenge. (c) The lightweight fix: parse the embedded `nonce` + difficulty, solve `sha256(f"{nonce}:{n}")[:D]=="0"*D` in Python, `POST /__c` for the clearance cookie (`_fmc`, ~7-day TTL), reuse it on one `requests.Session` — routed through `fetch_ufcstats()`. (d) ALWAYS pair a chained `find('x').find_all(...)` with a None-guard so a future block degrades to skip+warn, never a crash that starves later phases. Resolved 2026-05-31.

---

## Cross-Source Data Joining

- **Never join two different data sources on `event_name` or `bout` strings.** They will differ in formatting, punctuation, and casing. Use a neutral key like `date` or a normalized URL slug.
- **`fight_meta_details.bout` and `round_fight_stats.bout` are often reversed even though both come from ufcstats.** Always match both orderings: `rfs.bout = fmd.bout OR rfs.bout = TRIM(SPLIT_PART(fmd.bout,' vs ',2)) || ' vs ' || TRIM(SPLIT_PART(fmd.bout,' vs ',1))`. Discovered when bias stats showed 0% coverage for 4 of 7 weight classes despite data being present.
- **When broadening a DB-side filter for fuzzy matching, audit all downstream consumers.** A broader result set can introduce new bugs elsewhere (e.g. summary totals picking up rows from other fights on the same date).
- **Diagnostic "gaps" have three distinct root causes** — distinguish them before fixing: (a) data genuinely missing from the source, (b) wrong join condition (e.g. date offset for international events), (c) text format mismatch across sources. All three look the same until you dig.
- **±1 day date window** is correct for joining mmadecisions to UFC Stats. International events (Australia, Singapore, Abu Dhabi) consistently have a +1 day offset in mmadecisions dates.
- **Unicode accent normalization:** use `unicodedata.normalize('NFKD', s)` (Python) or `.normalize('NFD').replace(/[\u0300-\u036f]/g, '')` (JS) before the regex strip, not after. Decomposes accented chars into base + combining mark, then the strip removes the combining mark. Without this, `normName()` drops diacritics entirely (e.g. `Peričić` → `Perii` instead of `Pericic`), causing ESPN match failures.
- **NFD decomposition does NOT handle all non-ASCII letters.** Characters like `ł` (Polish), `ø` (Nordic), `ð/þ` (Icelandic) are standalone Unicode codepoints with no combining-mark decomposition — NFD leaves them intact, so they survive the regex strip as unrecognized characters. The fix is an explicit transliteration table applied before NFD: `{'ł':'l','Ł':'l','ø':'o','Ø':'o','ð':'d','Ð':'d','þ':'th','Þ':'th','ß':'ss','æ':'ae','Æ':'ae','œ':'oe','Œ':'oe'}`. Without this, ESPN's `Ruchała` → `ruchaa` while DB's `Ruchala` → `ruchala` — no match, fight gets no `espn_competition_id`, live event polling skips it entirely.
- **`card_position` for fight ordering:** `fights.id` insertion order breaks when UFC reshuffles cards or adds/removes fights. Use `card_position` derived from ESPN competition order (main event = 1). Frontend sorts by `card_position ASC nullsLast, id ASC`.
- **Cross-source nickname vs full name mismatch:** mmadecisions URL slugs use short names (e.g. "Josh Van") while ufcstats uses full names ("Joshua Van"). `matchesFighter()` now has a first-name prefix strategy to handle this. Short last names (≤3 chars like "Van") also bypass the last-name-only fallback, so the prefix check is the only path that catches them.
- **UFCStats uses different names for the same fighter on different pages of its own site.** The event listing page (scraped into `fight_meta_details.bout`) uses "Patricio Pitbull"; the round stats page (scraped into `round_fight_stats.bout`) uses "Patricio Freire". This is a same-source inconsistency, not a cross-source one — the reversed-bout fallback can't rescue it because neither ordering matches. Fix: the master scraper must normalize UFC Stats nicknames to legal names (or vice versa) before inserting into `round_fight_stats`, using the same `_FIGHTER_ALIASES` dict. When a backfill finds a row it can't match, check this as the first hypothesis.
- **ESPN displays some fighters by nickname rather than legal name** (e.g. "Patricio Pitbull" vs UFC Stats "Patricio Freire"). The `_names_match` function has a `_FIGHTER_ALIASES` dict (normalized nickname → normalized legal name) to handle known cases. When ESPN fails to link a fight, check whether it's a nickname mismatch first — add an entry to `_FIGHTER_ALIASES` rather than adding a new matching strategy. Both before/after the alias lookup, use `_norm_name` so the dict keys are consistent.
- **Card reshuffles and injuries require manual DB cleanup.** When a fight is moved to a future event, delete the row from the current event's card (by `id`) and let the scraper re-add it when the new event is scraped. The scraper has no mechanism to detect moves — it only adds and completes, never relocates.

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

## Phase 6 — Scoring & Leaderboard

- **`modified_after_reveal` fires on first round scored for historical fights.** `judgesRevealed` is forced `true` at load time for completed fights (`|| isHistorical`), so the `if (judgesRevealed)` guard in `handleSubmitRound` fires immediately on first scoring — incorrectly flagging every historical fight as ineligible. Fix: `if (judgesRevealed && !isHistorical)`. Eligibility for historical fights is determined by `forfeited` only.
- **`leaderboard_eligible` as a GENERATED column hides bugs when the source booleans are themselves wrong.** The column is consistent with its inputs — but if the inputs are incorrectly set, the generated value is wrong too. Always audit what's writing to `scored_blind`, `forfeited`, and `modified_after_reveal` before debugging the generated column itself.
- **`handleReveal` never fires for historical fights** — the `!judgesRevealed` guard blocks it because `judgesRevealed` starts as `true`. Any logic that needs to run when a historical fight is "completed" must be triggered differently (e.g. in the last-round score submit path directly).
- **Spoiler protection: always pass `scheduled_rounds` (not actual rounds fought) as `totalRoundsOverride` when spoiler is active.** Deriving round count from `meta.round` and `meta.method` reveals the finish round and duration before the user scores. Use the fallback chain: `fight.scheduled_rounds || parseInt(meta?.time_format?.match(/^(\d+)\\s*Rnd/)?.[1]) || 3`. `fight.scheduled_rounds` is only populated for fights that went through ESPN sync as upcoming; `meta.time_format` covers all historical fights correctly including non-title 5-round main events.
- **Decision-only leaderboard uses `fmd.method ILIKE 'Decision%%'`, not `fights.ended_by_decision`.** `ended_by_decision` is only set by the Edge Function for live events — unreliable for historical fights. `fmd.method` is populated by the Phase 2 scraper for all fights.
- **Round accuracy in the leaderboard reuses the exact judge-join pattern from `get_user_judging_profile`.** Date ±1 day window + last-name split_part match + pivot + window majority vote. Copy from there rather than reinventing.

---

## RPC / SQL Patterns

- **When two independently-computed percentages don't sum to 100%, normalize for display.** Show `s/(s+g)` and `g/(s+g)` so bar and labels agree. Keep raw values in the RPC; normalize only at the display layer.
- **Adding `judges_agreeing` as a window function in the `majority` CTE** alongside existing `f1_wins`/`f2_wins` is a clean extension — same partition, no extra CTE needed.
- **For `ten_eight_quality`, join `complete_judges` back to `round_accuracy`** (instead of a correlated subquery or EXISTS). Gives a clean flat join and avoids self-referencing CTE issues.
- **`agreement_breakdown` using `COUNT(*) FILTER (WHERE ...)` in a single aggregation** over `round_accuracy` is cleaner than a separate CTE — eliminates one CTE entirely.
- **Don't use `EXISTS` referencing a CTE name inside another CTE's WHERE clause.** SQL sees the CTE name as the table it's being filtered against, creating confusing scope. Use a JOIN instead.
- **`agreement_breakdown` and `accuracy` have different denominators by design:** agreement uses all rounds with judge data (including split-decision rounds where majority_winner IS NULL); accuracy uses only rounds with a clear majority. If the UI surfaces both totals, add a tooltip.

---

## Audits

- **"Phase complete" in PROGRESS.md is not proof; grep the code.** The 2026-05-16 app audit found Phase 8 (Pulse redesign) marked ✅ but 5 components (Login, JudgeDirectory, JudgeProfileView, JudgeComparison, UserJudgeComparison) still shipped `#D4AF37` gold + `text-white/40` failing-contrast tokens. Phase 8f.4 a11y marked ✅ but the RoundScoringPanel modals had no focus trap, no Escape handler, no focus restoration. When a phase touches many files and ships in stages, the checklist drifts ahead of the actual code. For any "phase ✅" claim that spans >3 files, audit by `grep`ing for the old pattern before declaring done.
- **Static audits can verify everything except rendering and a11y interaction.** Static-only finds: token regressions (grep), debug `console.log`s left behind, dead code, dep drift, RPC signature drift, env var prefix discipline, service-key absence in build output. Cannot find without a browser: actual layout on mobile viewports, color contrast in computed CSS, modal focus behavior, screen-reader announcements, animation timing. State both halves explicitly in the audit deliverable rather than implying everything was checked. The 2026-05-16 app audit's `05-ui-ux.md` and `06-accessibility.md` headers both note "static-only" up front.
- **Verify service-key absence in the compiled bundle, not just `src/`.** `grep SUPABASE_SERVICE src/` returning 0 matches is necessary but not sufficient — a transitive import could pull a fixture or copy-paste from a backup file. Confirm by `grep "service_role" build/static/js/main.*.js` after `npm run build`. (The string may appear in the `.map` sourcemap as a library identifier, which is fine — sourcemaps don't contain `.env` values, only variable names.)

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
- **RoundScoringPanel internal state uses `{ f1_score, f2_score }` — not `{ fighterScoredFor, points }`.** The old model assumed a winner always gets 10. The new model stores each fighter's score independently, supporting point deduction draws (9-9, 8-8). DB schema (`user_round_scores`) already had `f1_score`/`f2_score` columns, so no migration was needed.
- **RPC progress fields can have multiple blocking conditions — always surface the real one.** The Tier 1 → Tier 2 progress badge showed "62 / 102 rounds" by adding `total_needed = 40` on top of the current count, implying the user needed 40 more rounds. But Tier 2 also requires 15+ men's AND 15+ women's rounds — the actual blocker was the women's minimum. Fix: check each condition in order (total rounds, then women's, then men's) and show the specific message for whichever is unmet.

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
- **Separate RPC for computationally heavy extensions** — `get_scoring_insights()` is a separate RPC from `get_user_judging_profile()` to keep base DNA load fast. Lazy-loaded on user action rather than on view open. Both share the same CTE foundation (user_rounds → fight_stats_pivoted → round_winner_stats) but run independently.
- **Stat correlation via simple AVG(CASE) is sufficient for fingerprinting** — for each stat, `AVG(CASE WHEN winner_X > loser_X THEN 1.0 ELSE 0.0 END)` gives a 0-1 correlation that's meaningful with as few as 15 rounds. No ML library needed.
- **Pattern break detection via dot product of stat differentials × fingerprint weights** — `CROSS JOIN` a single-row fingerprint CTE. Positive sum = predicted f1, negative = predicted f2. When prediction disagrees with actual pick, that's a pattern break. Entirely in SQL, no client-side math needed.

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

## UI/UX Redesign

- **Build full-app mockups (all 14 pages) before committing to a design direction.** Single-page concept mockups are not enough to evaluate — patterns only emerge across the full page set. B and D got full mockups; E was started but 3 pages in was enough to confirm D was the winner.
- **Concepts must be truly distinct, not color swaps.** First round of alternatives were rejected because they were just palette variations. Second round (D/E/F/G) each had fundamentally different navigation paradigms and layout systems.
- **Chosen design: Concept D (Pulse).** Barlow Condensed + Inter, red/blue fighter colors, charcoal (#0e0e12), Instagram Stories-style swipe nav, bottom sheet details. Mockups in `mockups/concept-D-pulse/`.
- **Use a `currentTheme` object as a single point of control for Tailwind class tokens.** Swapping the entire theme (gold→Pulse) was a one-object change; all components that consume `currentTheme` inherited the new look automatically.
- **CSS custom properties (`:root` vars) + Tailwind `extend.colors` together give maximum flexibility.** Tailwind classes for component styling, CSS vars for anything that needs runtime access (e.g. gradients, borders with opacity).
- **Tab bars are better than long scroll for fight detail.** Organizing Overview/By Round/Scoring/Judges into tabs prevents mobile users from scrolling past content they care about.
- **R1 stoppages produce 0 scoreable rounds — show an explicit empty state** rather than rendering a blank panel. The formula is `isDecision ? roundsFought : roundsFought - 1`.
- **Mockups are design direction, not feature specs.** The Combat DNA mockup simplified metrics that were already richer in the app. Use mockups for visual language (colors, spacing, typography) but preserve existing feature depth.
- **Round selector colors should encode data, not just state.** Red/blue for which fighter won that round is more informative than green for "scored." Active round uses a white border + glow to avoid conflicting with the score color.
- **ScorecardComparison: collapse judges to majority with expandable detail.** Shows all info without cramming 7+ columns. "Judging majority" language is more accurate than "official judges" since individual judges often disagree.
- **Score cells colored by fighter corner (red/blue) across all sources** (You, Judges, Model) makes disagreements visually obvious before reading the match icon.
- **Split data-dense components into separate Pulse surface cards rather than one monolith.** JudgingDNACard went from one large card with border-t dividers to ~8 independent cards — each scannable on mobile without scrolling past unrelated sections.
- **Horizontal scroll cards work better than table rows for weight class data on mobile.** Each card is a self-contained unit with its own bar fill + stats, easier to compare visually than reading across columns.
- **Story progress bars should represent navigation depth, not global position.** A fixed linear bar implies a single journey; depth-based bars that adapt per section (different bar counts, path-dependent logic) match how users actually navigate between independent sections with varying drill-down levels.
- **Hide ML model predictions for finishing rounds in non-decision fights.** The last round of a stoppage has partial/incomplete stats, making the model output meaningless. Suppress in both the Round Breakdown (Overview tab) and the Model column (Judges tab/ScorecardComparison).

---

## User Preferences

- **Per-user settings belong in a `profiles` table (one row per user), not in transactional tables.** Transactional tables (`user_votes`, `user_round_scores`) are per-(user, fight) — wrong shape for global prefs. `profiles` with `user_id uuid PK REFERENCES auth.users` + `upsert` is the clean pattern.
- **Initialise per-fight state from the global default, then apply local overrides.** Spoiler protection follows this pattern: `useState(spoilerDefault)` in the component, auto-overridden when existing scores are found. The local state lives in the component and dies on unmount — no need to persist it.
- **Auto-reveal on `hasUserScores` via `useEffect`** — cleaner than checking in every render path. A single `useEffect([hasUserScores])` that calls `setSpoilerActive(false)` covers both the async DB check and the real-time `onAllRoundsScored` callback.

## UX Polish

- **CSS mask-image is the cleanest scroll affordance on mobile.** Apply `maskImage: 'linear-gradient(to right, black 80%, transparent 100%)'` directly to the scrollable container.
- **Scroll restoration needs two refs: a saved position and a previous-view tracker.** Save `window.scrollY` before navigating away; restore on transition FROM the detail view, not on every render.
- **Card-level headers inside a page that already has a section header are redundant.** Remove the card's own header if the page context makes its purpose obvious.
- **Skeleton loaders should mirror the real layout, not just show a spinner.** Match the avatar circles, stat rows, grid columns, etc. so the transition feels seamless.
- **Stagger animations via `animationDelay` + `animationFillMode: 'both'`** — keeps CSS-only (no JS timers). 60ms per card is a good balance between visible stagger and not feeling slow.
- **`active:scale-[0.94]` for small buttons, `active:scale-[0.98]` for large cards** — subtle press feedback that works well on mobile without feeling laggy.
- **44px minimum touch target matters.** Year pills, tab buttons, and gender toggles were all ~32–36px; bumping to `py-2`/`py-2.5` + `min-h-[44px]` fixes without visual bloat.
- **Tables need card-based alternatives on mobile.** JudgeDirectory's 5-column `<table>` was unusable below 768px. Sort pills + card list (md:hidden / hidden md:block split) gives full functionality on both form factors.
- **Fade-edge mask on scroll containers is the strongest affordance.** `maskImage: linear-gradient(to right, black 75%, transparent 95%)` signals "more content" without extra DOM. Use 70–75% cutoff (not 85%+ which is too subtle on small screens).
- **SVG accuracy rings need responsive sizing.** Fixed `w-24 h-24` wastes 40% of width on 320px phones. Use mobile-first base size with `sm:` breakpoint scaling.
- **10px font is below safe mobile minimum.** Bump badges, labels, and nav text to 11px; 12px for anything that must be read quickly.

## Accessibility

- **`text-pulse-text-3` at #5a5a6e fails WCAG AA on #0e0e12 background.** Lightened to #7a7a8e (~5.2:1 contrast ratio) which passes AA for all text sizes.
- **Icon-only buttons need `aria-label`.** Settings toggle, vote buttons (Star/ThumbsUp/ThumbsDown), profile avatar — all silent to screen readers without it. Also add `aria-hidden="true"` to the icon SVG itself.
- **Tab bars need `role="tablist"` + `role="tab"` + `aria-selected`.** Without these, screen readers can't distinguish tabs from regular buttons. Apply to DNA tabs, profile tabs, fight detail tabs.
- **Bottom nav needs `aria-label="Main navigation"` and `aria-current="page"`.** The `<nav>` element alone isn't enough; screen readers need the label to distinguish it from other nav regions.
- **Skip-to-content link is essential for keyboard users.** `sr-only` class hides it visually; `focus:not-sr-only` reveals it on Tab. Target the `<main>` element.
- **SVG data visualizations need `role="img"` + `aria-label` with the data value.** Accuracy rings, body map — screen readers skip unlabeled SVGs entirely.
- **Expandable rows need `aria-expanded` + keyboard Enter/Space/Escape.** Without these, keyboard users can't tell state or operate the control.
- **`text-white/40` and below fail WCAG AA.** Replace with `text-pulse-text-3` (now #7a7a8e) or use `text-white/60` minimum for body text.
- **Live region (`role="status" aria-live="polite"`) announces view changes.** Without it, SPA navigation is silent to screen readers.

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
