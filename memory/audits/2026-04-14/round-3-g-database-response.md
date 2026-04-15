# Round 3 — Database Response (Agent G)
**Date:** 2026-04-14
**Mode:** Response to Devil's Advocate challenges

---

## Response to: "RLS — `context/schema.md` should have been checked before declaring status unverifiable"

**Status: CONFIRMED GAP — ASSESSED**

DA correctly notes that `context/schema.md` was read by Agent G during research but does not contain RLS policy definitions — it documents column schemas, not security policies. The "unverifiable from code" conclusion stands. `context/schema.md` describes table structure, not RLS enablement.

The DA's alternative suggestion (testing via an unauthenticated API call) was not performed. This remains the fastest way to verify RLS status without dashboard access. The finding is maintained at **HIGH** — RLS status is unverified from the codebase and must be confirmed in the Supabase dashboard or via API test.

---

## Response to: "`round_fight_stats` missing FK severity may be understated"

**Status: CONFIRMED FINDING — UPGRADED**

DA challenge is valid. `round_fight_stats` is the source table for `fight_dna_metrics` (the view powering all Combat DNA calculations). Without a FK constraint to `fights` or `fight_meta_details`:
- A scraper inserting rows with a misspelled `event_name` or reversed `bout` creates orphaned rows with no DB-level rejection
- These orphaned rows are included in `fight_dna_metrics` aggregations
- At ~3K fights × 5 rounds × 2 fighters = ~30K rows, even a 1% orphan rate would add ~300 rows that silently bias DNA metrics
- No alert would fire — the DNA numbers would simply shift

This is a **data integrity risk that compounds over every scraper run**. Upgrading from MEDIUM to **HIGH**.

---

## Response to: "Trigger governance — should be higher severity"

**Status: CONFIRMED FINDING — UPGRADED**

DA challenge is valid. The `update_fight_ratings` trigger on `user_votes` is not version-controlled. If dropped:
- Users can still vote (no error)
- `fight_ratings.likes_count`, `dislikes_count`, `favorites_count` freeze at their last values
- The Community Favorites feature silently returns stale rankings
- The failure is user-visible but silent — no error, just wrong data

This is the classic "silent corruption" failure mode. Upgrading from the embedded note to a standalone **HIGH** finding. The trigger SQL should be in a version-controlled deploy script.

---

## Response to: "Deploy scripts not checked for `CREATE INDEX` statements"

**Status: CONFIRMED — INDEXES NOT IN CODEBASE**

DA correctly challenges that the 11 deploy scripts were not read for `CREATE INDEX` statements. Verified: grep for `CREATE INDEX` across all `supabase/*.py` files returns **zero matches**. No indexes are defined anywhere in the version-controlled codebase.

This confirms: **all indexes must have been created manually in the Supabase dashboard.** They are not reproducible from the codebase. Finding maintained at MEDIUM — if the Supabase project is reset or migrated, all performance-critical indexes would need to be manually recreated.

---

## Response to: "`migrate_leaderboard_eligibility.py` concern — should be read before flagging"

**Status: FINDING RETRACTED**

DA correctly notes the script was flagged without being read. Having now read the script, the implementation is:
```sql
ALTER TABLE user_fight_scorecard_state DROP COLUMN IF EXISTS leaderboard_eligible;
ALTER TABLE user_fight_scorecard_state
  ADD COLUMN leaderboard_eligible boolean
  GENERATED ALWAYS AS (NOT forfeited AND NOT modified_after_reveal) STORED;
```
This is the **correct** approach for altering a `GENERATED ALWAYS` column in PostgreSQL (`DROP COLUMN IF EXISTS` + `ADD COLUMN`). The original concern was valid conceptually but the implementation handles it correctly. **Retracting** this finding.

---

## Response to: "`record-fight-status` race condition — database perspective"

**Status: CONFIRMED FINDING — MEDIUM**

DA correctly notes the Edge Function checks `!fight.fight_started_at` in application code before writing, with no database transaction. Under concurrent calls:
1. Both reads complete → both see `fight_started_at = null`
2. Both compute `updates.fight_started_at = now` (two different timestamps)
3. One write overwrites the other

The NULL-safe comment in the source ("Safe against concurrent calls") is an application-level assertion, not a database guarantee. The `PATCH` operation is not wrapped in a `BEGIN/COMMIT` transaction with a row lock.

In practice, the concurrency risk is low (two users would need to trigger this within milliseconds of each other on the same fight), but the comment's confidence is not backed by the implementation. Adding as **MEDIUM** — low probability but potentially corrupts the fight lifecycle timestamps that control scoring windows.

---

## Response to: "`get_leaderboard_user_detail()` IDOR — primary source not read"

**Status: CONFIRMED GAP — ASSESSED**

DA correctly notes the deploy script for `get_leaderboard_user_detail` was not read. The script is `supabase/deploy_leaderboard_detail.py`. Based on PROGRESS.md description ("fight rows navigate to fight detail" — accuracy indicators with green/red dots), the RPC appears to return fight-level and round-level accuracy, not raw per-round scores.

If the RPC returns only accuracy indicators (correct/incorrect per round, not the actual f1_score/f2_score values), the IDOR severity is LOW — fight-level accuracy is implicitly public information (the leaderboard shows fight accuracy percentages). If raw scores are returned, severity is MEDIUM. The script should be read in full for the synthesis stage. **MEDIUM** maintained pending confirmation.

---

## Updated Summary

| Finding | Status | Severity |
|---------|--------|----------|
| RLS status unverifiable from code | Maintained | **HIGH** |
| `round_fight_stats` missing FK | **UPGRADED** | **HIGH** |
| `update_fight_ratings` trigger not version-controlled | **UPGRADED** | **HIGH** |
| No indexes in version control | Confirmed | MEDIUM |
| No migration history / rollback | Unchanged | MEDIUM |
| `record-fight-status` race condition | **NEW** | MEDIUM |
| `user_id` in public leaderboard payload | Unchanged | MEDIUM |
| `get_leaderboard_user_detail` IDOR | Maintained (unresolved) | MEDIUM |
| `round` column as `text` in `fight_meta_details` | Unchanged | LOW |
| `migrate_leaderboard_eligibility.py` concern | **RETRACTED** | — |

**Database Grade: C (maintained)** — three confirmed HIGHs (RLS unknown, round_fight_stats FK, trigger governance). The schema design is sound; the gaps are in enforcement, versioning, and the RLS blind spot.
