# DECISIONS.md
*Key architectural and product decisions with reasoning. Read before making any significant architectural change.*

---

## Entry Format
```
## [YYYY-MM-DD] — [Decision title]
Decision:
Reasoning:
Alternatives considered:
```

---

## Decisions

---

## [~2024] — React (CRA) over Next.js
Decision: Use Create React App with client-side rendering, deployed on Vercel.
Reasoning: The app is primarily a data-display SPA with no SEO requirements and no server-rendered pages. CRA is simpler to maintain and avoids SSR/hydration complexity. All data is fetched client-side from Supabase.
Alternatives considered: Next.js — rejected because SSR adds complexity without benefit for an authenticated, non-indexed fan app.

---

## [~2024] — Supabase over Firebase / PlanetScale
Decision: Supabase (PostgreSQL + Auth + Edge Functions) as the sole backend.
Reasoning: PostgreSQL's relational model is essential — the data has many joins (fights ↔ stats ↔ judge scores ↔ user scores). Supabase provides auth, RPC functions, and Edge Functions in one service. RPC functions let complex aggregations run in the DB rather than client-side.
Alternatives considered: Firebase — rejected (no relational model, Firestore is poor fit for join-heavy queries). PlanetScale — rejected (no auth or serverless functions bundled).

---

## [~2024] — `fight_url` as the canonical cross-table join key
Decision: All joins between `fights`, `fight_meta_details`, and `round_fight_stats` use `fight_url`, never `bout` string.
Reasoning: `bout` field is inconsistently ordered across tables (Fighter A vs Fighter B in one, Fighter B vs Fighter A in another) even within the same data source. `fight_url` is stable and unique.
Alternatives considered: `bout` string matching — rejected after discovering silent join failures caused by bout reversal. Date + event_name — rejected because event_name formatting differs across sources.

---

## [~2024] — Date ±1 day window for cross-source joins (UFC Stats ↔ mmadecisions)
Decision: When joining judge scores to fight data, always use `date >= event_date - 1 AND date <= event_date + 1`, never `event_name = event_name`.
Reasoning: mmadecisions event names never match UFC Stats event names in formatting. International events (Australia, Singapore, Abu Dhabi) consistently have a +1 day offset in mmadecisions dates due to timezone differences.
Alternatives considered: Fuzzy event name matching — rejected because the string similarity is too low across sources to be reliable.

---

## [~2024] — In-browser ML inference (no API call)
Decision: The scoring model (`scoring_model.json`) is loaded and run entirely in the browser using JavaScript. No inference API endpoint.
Reasoning: The model is a small Logistic Regression (19 features, ~10KB exported JSON). Running it in-browser avoids API latency, removes a server dependency, and keeps the feature free to operate at scale.
Alternatives considered: Server-side inference via Supabase Edge Function or a dedicated API — rejected as unnecessary given model size and the clean JS port of LR inference.

---

## [~2024] — Logistic Regression over Random Forest / XGBoost
Decision: Logistic Regression is the production model (82.5% accuracy, 19 differential features).
Reasoning: The round-scoring decision boundary is largely linear when using differential features (f1_stat - f2_stat). LR outperformed RF and XGBoost on this dataset and is trivially portable to JS (weights + intercept only). Symmetric augmentation (mirroring every row) eliminates positional bias cleanly.
Alternatives considered: Random Forest — lower accuracy on differential features, harder to port to JS. XGBoost — similar accuracy to RF, much larger export size.

---

## [~2024] — No Redux or React Context API
Decision: All state managed via local `useState`/`useEffect` hooks + `dataService.js` as a singleton query layer.
Reasoning: The app has no cross-component shared state that couldn't be handled by prop-passing or local state. Adding Redux or Context would introduce boilerplate without a clear problem to solve at current scale.
Alternatives considered: Redux Toolkit — rejected (overkill for a single-developer app with no real-time shared state). React Context — rejected (props + `dataService.js` are simpler and equally maintainable).

---

## [~2024] — `fight_dna_metrics` as a VIEW, not a materialized table
Decision: DNA metrics are computed in a PostgreSQL VIEW at query time, not pre-aggregated into a table.
Reasoning: At ~3K fights the query is fast enough. A VIEW stays automatically up-to-date as `round_fight_stats` data is updated by the scrapers. A materialized table would require a refresh step after every scraper run.
Alternatives considered: Materialized view with periodic refresh — deferred until performance requires it (estimated 10K+ fights before noticeable slowdown).

---

## [~2024] — Supabase CLI for Edge Function deployment (not Management API ZIP)
Decision: Edge Functions are deployed via `npx supabase functions deploy --project-ref <ref>`, not the Management API ZIP upload endpoint.
Reasoning: Management API ZIP upload returns 500 errors for any function with imports. The CLI bundles correctly and handles eszip format internally.
Alternatives considered: Management API REST upload — attempted and failed. Python-generated eszip bundle — not feasible without a dedicated bundler.

---

## [~2024] — `f1_score` / `f2_score` schema for user round scoring (not `fighter_scored_for` + `points`)
Decision: `user_round_scores` stores both fighters' explicit scores (`f1_score INT`, `f2_score INT`) rather than a winner + points model.
Reasoning: Supports point-deduction rounds (9-9, 8-8 draws) cleanly. Community scorecard aggregation is trivial (`AVG(f1_score)`, `AVG(f2_score)`). No need to know fighter names in the query layer.
Alternatives considered: `fighter_scored_for` + `points` — rejected because it assumes a winner always gets 10, breaking draw scoring.

---

## [~2024] — `leaderboard_eligible` as a GENERATED ALWAYS column
Decision: `leaderboard_eligible` in `user_fight_scorecard_state` is a `GENERATED ALWAYS AS (scored_blind AND NOT forfeited AND NOT modified_after_reveal) STORED` column.
Reasoning: Eligibility logic stays consistent with source booleans at all times. No application-layer drift. No risk of a bug setting eligible=true when the conditions aren't met.
Alternatives considered: App-layer computed field — rejected because it would need to be recalculated and written on every state change, with risk of races or missed updates.

---

## [2026-03-28] — Pulse (Concept D) as the design system
Decision: The UI was fully redesigned to Concept D (Pulse): Barlow Condensed + Inter, red/blue fighter colors, charcoal (#0e0e12), Instagram Stories-style navigation, bottom nav with 4 tabs.
Reasoning: Concepts B and D each had full 14-page mockups built. Concept D won because: (1) mobile-first navigation paradigm matches 90% mobile/tablet userbase, (2) red/blue fighter color coding makes disagreements visually obvious, (3) bottom tab nav is standard on mobile and supports depth-based story progress bars.
Alternatives considered: Concept B — rejected after full mockup (too desktop-centric). Concepts E/F/G — eliminated after 3-page mockups (all were palette variations, not distinct paradigms).

---

## [2026-04-25] — GitHub Actions for live-event auto-scraping (`--live` mode)
Decision: Added `--live` flag to the master scraper (Phases 2-4 only), triggered by a GitHub Actions cron every 25 minutes. A `is_live_window()` guard queries `ufc_events.start_time` (UTC) and exits safely if the event hasn't started or has concluded.
Reasoning: Live-event stats scraping needs to run automatically without Bastian's machine being on. GitHub Actions is free for public repos (unlimited minutes). The existing Python scraper is reused as-is — no Deno/TypeScript rewrite needed. The guard mirrors the `poll-live-fights` Edge Function's 2-day UTC window logic exactly.
Alternatives considered: Supabase Edge Function rewrite (Deno/TypeScript) — rejected, high cost to rewrite HTML scraping logic. Windows Task Scheduler — rejected, requires machine to be on. No automation — rejected, defeats the purpose.

---

## [2026-04-28] — `--post-event` flag + 2-hourly GitHub Actions cron for post-event scraping
Decision: Added `--post-event` argparse flag (runs Phases 0/0.5/1/5/6, skips 2/3/4 which are handled by `--live`) plus a separate workflow `post-event-scraper.yml` running `0 */2 * * *`. Guarded by `is_post_event_window()` (event `start_time + 5h` to `start_time + 48h`, fails safe on NULL).
Reasoning: Live-mode scraping covers the event window but post-event metadata, judge scorecards, and stats fill-ins continue arriving for ~48h. A separate slower cadence avoids hammering UFCStats/mmadecisions while still closing data gaps without manual triggering. Two-hour interval is enough to catch mmadecisions publishes (which trickle in over Sunday–Monday).
Alternatives considered: Single combined cron with mode detection — rejected because the guards are time-window-different (live = `start_time` to `fight_ended_at`; post-event = `+5h` to `+48h`) and merging would muddy both. Manual trigger only — rejected, was the existing pain point.

---

## [2026-03-28] — Separate `get_scoring_insights()` RPC from `get_user_judging_profile()`
Decision: Phase 9 Scoring Insights use a dedicated `get_scoring_insights()` RPC, lazy-loaded on user action, not bundled into `get_user_judging_profile()`.
Reasoning: Insights are computationally heavier (fingerprint + pattern break + disconnect + consistency + drift — all joined to `round_fight_stats`). Keeping the base DNA load fast matters because it runs on every DNA view open. Lazy loading insights only when the user expands the section avoids unnecessary DB load for users who don't engage with it.
Alternatives considered: Single combined RPC — rejected because it would double the base DNA load time for all users regardless of whether they use insights.
