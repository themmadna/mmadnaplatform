# Completed Phases Archive

Condensed summaries of fully completed phases. Full detail in git history.
PROJECT_PLAN.md retains only active/upcoming phases.

---

## Phase 1 — Codebase Review & Hardening ✅

All bugs, performance issues, dead code, and UX gaps identified and fixed.

Deferred (still open):
- CombatScatterPlot mobile responsiveness
- `fetchYears` optimisation (query already light; true distinct requires a DB function)

---

## Phase 2 — Data Cleanup ✅

- `judge_scores` fully re-scraped with clean fighter names (link text, not URL slugs)
- Historical backfill complete (2007–2026): 5,412 complete, 55 partial, 678 missing
- Phase 6 added to master pipeline: `sync_judge_scores()` calls `scrape_mmadecisions.py --yes`
- `judge_scores_coverage` view built — SQL in `supabase/views/judge_scores_coverage.sql`

---

## Phase 3 — Predictive Scoring Feature ✅

- **3a+3b:** FightDetailView with round-by-round stats, judge scorecards, fuzzy cross-source name matching
- **3c:** ML scoring model (Logistic Regression, 82.50% holdout accuracy, 19 features)
  - `scoring_model/` contains training scripts, `ml_dataset.csv`, and `scoring_model.json`
  - Model integrated client-side in `FightDetailView.js` via `scoreRound(f1Stats, f2Stats)`
  - 10-8 threshold: confidence ≥ 0.99
  - Full details: [ml-model.md](ml-model.md)

---

## Phase 4.5 — Weight Class Normalization ✅

**Problem:** Raw `weight_class` values like "UFC Bantamweight Title Bout" fragmented analytics.

**Solution:** `fight_meta_details` now has three new columns:
- `weight_class_clean` — normalized division name (e.g. "Bantamweight")
- `is_title_fight` (boolean)
- `is_interim_title` (boolean)

**Rule:** Keep `Women's` prefix; strip `UFC`, `Interim`, `Title`, `Championship`, `Bout`.

**Usage:**
- `fights.weight_class` (raw) — shown on fight cards for context
- `fight_meta_details.weight_class_clean` — used in fight detail header and all analytics

Migration script: `supabase/migrate_weight_class.py`
Scraper: `parse_weight_class(raw)` helper in master scraper populates all three fields on new inserts.

---

## Phase 7 — Guest Mode ✅

Users can browse and interact fully without an account. All personal data in `sessionStorage` (auto-wiped on tab close). Zero DB writes for guests.

Key files:
- `src/guestStorage.js` — sessionStorage wrapper (votes, scores, scorecard state)
- `src/Login.js` — "Continue as Guest" button + warning
- Guest state threads through `App.js` → `FightDetailView` → `RoundScoringPanel` → `ScorecardComparison`

No migration on sign-up — guests warned upfront that local data doesn't transfer.
