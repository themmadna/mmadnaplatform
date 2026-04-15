# Database / Supabase Audit — UFC Web App
**Date:** 2026-04-14
**Auditor:** Database Agent (Round 1-G, conducted by orchestrator)
**Project root:** `c:\Users\sabzu\Documents\VS Ufc\ufc-web-app`

---

## Migration Strategy Assessment

**No traditional migration files exist.** Schema changes are applied via one-off `deploy_*.py` and `migrate_*.py` Python scripts that POST SQL directly to the Supabase Management API. 

- **MEDIUM — No migration history or rollback capability.** The deploy scripts contain `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` and `CREATE OR REPLACE FUNCTION` — these are additive and idempotent. However, there are no down-migrations. If a schema change needs reverting, it must be done manually in the Supabase dashboard. The history of what schema is currently applied lives only in git commit history across 10+ separate script files.
- **LOW — `supabase/migrate_leaderboard_eligibility.py` modifies a GENERATED ALWAYS column definition.** Altering generated column expressions in PostgreSQL requires `DROP COLUMN` + `ADD COLUMN`. This script's content should be verified to handle this correctly.

---

## Schema Design

### Normalization
- **PASS — No significant denormalization issues.** The schema is well-normalized for a read-heavy analytics application. `fight_ratings` aggregates are maintained by trigger rather than computed on query — a sound tradeoff at this scale.
- **LOW — `fight_ratings` backup tables (`fight_ratings_backup`, `user_votes_backup`) mentioned in schema.md but undocumented.** Why they exist and whether they're safe to drop is not documented anywhere in the codebase. Low risk but should be documented.

### Naming Conventions
- **PASS — Consistent `snake_case` throughout.** All tables, columns, views, and RPC functions follow snake_case. No mixed-case identifiers found.

### Data Types
- **MEDIUM — `fights.rounds_fought` is an integer column described as a "convenience int mirror of `fight_meta_details.round` (text)."** The source column is `text` (e.g. "3") and the mirror is `integer`. If these ever diverge, the integer is authoritative for live event tracking but the text is the scraped ground truth. The `round` column being `text` in `fight_meta_details` is a mild data type smell — integer would be more appropriate for a count.
- **LOW — `fights.start_time` is `text`, not `time` or `timestamptz`.** Storing times as text prevents time arithmetic directly in SQL.
- **PASS — UUIDs, bigints, booleans, dates, and timestamptz are used appropriately throughout.**

### Missing Foreign Key Constraints (Enforced at DB Level)
- **MEDIUM — `round_fight_stats` has no FK to `fights` or `fight_meta_details`.** It joins on `(event_name, bout)` — a text-pair join key, not a FK constraint. An orphaned round_fight_stats row (referencing a deleted or renamed fight) would not be caught by the database.
- **MEDIUM — `judge_scores` has no FK to `fights`.** The `date ±1 day` join is a workaround for cross-source name mismatch, but it means there is no referential integrity between judge scores and fights at the database level. Judge scores can exist for fights that don't exist in the system.
- **PASS — `user_votes.user_id` → `auth.users` (FK), `user_votes.fight_id` → `fights.id` (FK).**
- **PASS — `profiles.user_id` → `auth.users ON DELETE CASCADE` (FK).**
- **PASS — `user_round_scores.fight_id` → `fights.id` (FK).**
- **PASS — `user_fight_scorecard_state.fight_id` → `fights.id` (FK).**

---

## Row Level Security (RLS)

- **HIGH — No RLS policy definitions found anywhere in the version-controlled codebase.** Grep across all `.py`, `.sql`, and `.ts` files for `ROW LEVEL SECURITY`, `ENABLE RLS`, `CREATE POLICY` returned zero matches.

This means one of two scenarios:
1. **RLS is configured directly in the Supabase dashboard** and not version-controlled. This is a governance gap — the security policy lives outside the codebase and can be changed (or reverted) without a code review or git history.
2. **RLS is not enabled on any table.** If true, any authenticated user with the anon key can read any other user's `user_round_scores`, `user_fight_scorecard_state`, `user_votes`, and `profiles` data by querying the API directly.

**Tables that MUST have RLS enabled with user-scoped policies:**
| Table | Required Policy |
|-------|----------------|
| `user_round_scores` | `user_id = auth.uid()` on SELECT, INSERT, UPDATE, DELETE |
| `user_fight_scorecard_state` | `user_id = auth.uid()` on SELECT, INSERT, UPDATE, DELETE |
| `user_votes` | `user_id = auth.uid()` on INSERT, UPDATE, DELETE; SELECT can be broader |
| `profiles` | `user_id = auth.uid()` on all operations |

**Tables that should be read-only for all authenticated/anon users (no user writes):**
`fights`, `fight_meta_details`, `round_fight_stats`, `judge_scores`, `ufc_events`, `fight_ratings` — these are populated only by the scraper (service key). Anon/authenticated should be SELECT-only via RLS.

**Action required:** Verify RLS status in the Supabase dashboard immediately. This is the highest-priority finding in the entire audit if RLS is not enabled.

---

## Indexes

- **MEDIUM — No index definitions are visible in the codebase.** Indexes must be verified in the Supabase dashboard. For the query patterns used, the following indexes are critical:
  - `judge_scores(date)` — used in every judge scores query with ±1 day range scan
  - `round_fight_stats(event_name, bout)` — used in fight detail fetches
  - `user_round_scores(user_id, fight_id)` — used in scoring data fetches
  - `user_fight_scorecard_state(user_id, fight_id)` — used in scorecard state fetches
  - `user_votes(user_id, fight_id)` — used in vote fetches
  - `fight_meta_details(fight_url)` — the canonical join key
  - `fights(fight_url)` — used in fight detail lookups

At ~3K fights and low user count, missing indexes are not yet producing visible latency. As data grows, `judge_scores` date-range scans and `round_fight_stats` event_name+bout scans are the most likely to degrade.

---

## RPC Functions

- **PASS — SECURITY DEFINER used appropriately.** User-scoped RPCs (`get_user_judging_profile`, `get_scoring_insights`, `get_user_judge_comparison`) use SECURITY DEFINER and `auth.uid()` to scope results to the calling user. This is the correct pattern for Supabase.
- **PASS — GRANT to `authenticated` only on user-scoped RPCs.** Public-facing functions (`get_leaderboard`, `get_judge_directory`, `get_judge_profile`, `get_judge_comparison`) are GRANT to anon where appropriate.
- **MEDIUM — `get_leaderboard()` returns `user_id` UUIDs to anon callers.** The leaderboard is public, but returning user_id (even opaque UUIDs) to unauthenticated callers exposes user identifiers. Consider replacing with a hashed or display-only identifier in the public payload.
- **PASS — Input parameters use typed RPC parameters, not string interpolation.** No SQL injection risk in RPCs.
- **LOW — No RPC for `getLeaderboardUserDetail()` IDOR check.** The `get_leaderboard_user_detail(p_user_id uuid)` RPC is called with any user's UUID (visible on the public leaderboard). If this RPC returns per-round scoring detail beyond what's already public, this is an IDOR. Must verify the RPC's SELECT scope.

---

## Edge Functions

- **PASS — `poll-live-fights` uses `SUPABASE_SERVICE_ROLE_KEY` from `Deno.env` (server-side).** The service key is never exposed to the client.
- **LOW — `poll-live-fights` is invokable without JWT** (comment in code: "No JWT required"). This is by design — it's called by pg_cron, not users. However, the function is publicly accessible at its URL. Any caller can invoke it and trigger an ESPN poll. This is low risk (it only reads ESPN and writes fight status) but could be abused to inflate ESPN poll count or trigger unnecessary DB writes.

---

## Triggers

- **PASS — `update_fight_ratings` trigger on `user_votes`** maintains aggregated counts in `fight_ratings`. This is the correct pattern — avoids COUNT(*) on every vote display. The trigger logic is not version-controlled (not in any deploy script), so it was presumably created in the Supabase dashboard.
- **MEDIUM — `update_fight_ratings` trigger is not version-controlled.** Same governance gap as RLS policies — if the trigger is accidentally dropped, aggregated vote counts stop updating silently.

---

## Summary

| Area | Tables Audited | RLS Coverage | Key Findings |
|------|---------------|-------------|--------------|
| Schema design | 10 tables + 4 views | Unknown | Missing FKs on round_fight_stats, judge_scores |
| RLS | 10 tables | **Unknown (0% verified in code)** | No RLS policies in version control |
| Indexes | Unknown | N/A | Critical indexes unverified |
| RPC functions | 9 functions | GRANT appropriate | user_id exposed in public leaderboard |
| Edge Functions | 2 functions | Service key correct | No JWT on poll-live-fights |
| Triggers | 1 | N/A | Not version-controlled |

**Tables audited:** 10 (ufc_events, fights, fight_meta_details, round_fight_stats, judge_scores, profiles, user_votes, fight_ratings, user_round_scores, user_fight_scorecard_state)
**RLS coverage (verified in code):** 0 / 10 tables — **UNKNOWN from codebase alone**
**Critical actions required before this grade can improve:** Verify RLS status in Supabase dashboard. If not enabled, enable immediately on all user-data tables.

**Overall Database Health Grade: C**

The schema design is clean and well-considered. Join patterns, generated columns, and FK constraints (where they exist) are appropriate. The grade is held down by: (1) complete absence of RLS policy definitions in version control, (2) missing FKs on the two largest stat tables, (3) no visible index definitions. The project's most dangerous database risk is scenario 2 of the RLS finding — if RLS is genuinely not enabled, user data is accessible to any authenticated caller with the anon key.
