# Supabase Audit — 2026-05-16

Read-only investigation against the live Supabase project. No migrations applied,
no grants modified, no keys rotated. Raw query dumps in
`supabase/.temp/audit_dump.json` / `audit_probe[2-4].json` (gitignored).

Audit covered RLS, function security, table & view grants, FK coverage, indexes,
triggers, pg_cron, pg_net, data quality (orphan rows, missing winners, missing
judge scores, bout-reversal handling), and operational state. Cross-checked
against the 9 numbered conventions in `CLAUDE.md` and the April 2026 audit's
P0/P1 fixes.

---

## Verdict: CONDITIONAL — fix two P0s before next user-facing work

The April audit fixes are all still in place (RLS enabled on every user-data
table, `record-fight-status` JWT validated, indexes/triggers/FKs deployed). But
**two stale grants survived the April migration** and currently leak user-vote
data to any caller with the anon key. Both are one-statement fixes. A third
P0-adjacent issue is a deprecated SECURITY DEFINER overload still granted to
anon that references columns that no longer exist.

---

## Counts

| Severity | Count | Notes |
|---|---|---|
| **P0** | 3 | Two leak user vote history to anon; one is a SECURITY DEFINER overload exposed to anon |
| **P1** | 4 | Scraper bugs producing NULL winners / NULL fight_url / duplicate rfs rows |
| **P2** | 7 | Tech debt — stale duplicate policies, no search_path lock on SECURITY DEFINER, grant drift from docs |

---

## Top 5 Risks

1. **`user_votes_backup` table is anon-readable, RLS off, contains real user_id+vote rows.**
   `SELECT * FROM user_votes_backup` via anon key dumps every pre-migration vote with the user UUID intact.
   `anon` also has DELETE/UPDATE/TRUNCATE on this table — destructive write risk.
   Fix: `DROP TABLE user_votes_backup, fight_ratings_backup` (130 + 8500 rows of historical data, superseded).
   *See 01-security.md §1.*

2. **`user_votes` has a stale `"Votes are viewable by everyone"` SELECT policy with `qual=true`.**
   PostgreSQL OR-combines RLS policies for the same command, so the new
   `user_votes_select_own` policy is overridden by the permissive one. Any
   authenticated user can read every other user's votes.
   Fix: `DROP POLICY "Votes are viewable by everyone" ON user_votes;` (plus drop the 3 other stale duplicates).
   *See 01-security.md §2.*

3. **Deprecated `get_user_judging_profile(p_user_id uuid)` overload is SECURITY DEFINER, granted to anon, references columns that don't exist.**
   The body reads `user_round_scores WHERE user_id = p_user_id` (under DEFINER privs, bypassing RLS)
   before erroring on `judge_scores.judge_name`/`f1_score`/`fighter1_name` which were renamed.
   Currently broken so no live exfil, but a one-line fix to that body re-enables full IDOR.
   Fix: `DROP FUNCTION get_user_judging_profile(uuid);` — the no-arg overload is the live one.
   *See 01-security.md §3 + 03-views-rpcs.md §1.*

4. **3 completed decision fights have `fights.winner = NULL`** despite valid `method` and `method_details` in `fight_meta_details` (ids 8281, 8269, 8761).
   Affects every user who scored those fights — `get_leaderboard()` excludes
   them (`fights.winner` must be non-null), so the leaderboard silently drops
   correct-pick credit. Scraper Phase 3 should have populated winner from
   `fmd.method_details`.
   *See 04-data-quality.md §2.*

5. **270 recent `round_fight_stats` rows have `fight_url = NULL`** despite the
   FK being added in the April migration. Phase 4 of `master file for data
   update.py` isn't populating `fight_url` on new inserts. FK currently allows
   NULL so this isn't blocking, but it disables every join that uses
   `rfs.fight_url` and threatens any future migration that tightens the FK.
   *See 02-schema.md §3 + 04-data-quality.md §3.*

---

## Areas confirmed clean

- **April audit P0 fixes hold.** RLS enabled on all 4 user-data tables; `record-fight-status` validates JWT; `.gitignore` clean.
- **April P1 fixes hold.** `requirements.txt`, `.env.example`, `pre-push` hook, `deploy_triggers.py`, `deploy_indexes.py`, `migrate_round_stats_fk.py` all in place.
- **Convention #2 (judge_scores ±1 day date join)** — every RPC that joins to `judge_scores` uses the date-window pattern. Zero violations.
- **Convention #9 (bout reversal)** — `get_judge_profile`, `get_scoring_insights`, `get_user_judging_profile()` are reverse-aware. The `fight_dna_metrics` view isn't, but in practice rfs.bout consistently matches fights.bout (3052 of 8685 fights reverse between fights.bout and fmd.bout, but 0 between fights.bout and rfs.bout) so no live blind spot. Still a code-smell — see 03-views-rpcs.md §3.
- **No SQL injection or XSS surface added since April.** All RPC calls are parameterized; no `dangerouslySetInnerHTML` use.
- **pg_cron + pg_net healthy.** 89,902 successful poll-live-fights runs over 62 days, 0 failures, all HTTP responses 200.
- **Indexes covered.** All 6 from `deploy_indexes.py` present, plus PKs and unique constraints.
- **No orphan user_round_scores or user_votes rows** (FK ON DELETE CASCADE working).
- **No `fight_url` duplicates** in `fights` (the UNIQUE constraint from the April FK migration holds).
- **Storage: 0 buckets.** Nothing to expose.

---

## Re-run instructions

Re-run the three Python audit scripts after any schema/RPC/RLS change:
```
python supabase/.temp/audit_2026_05_16.py
python supabase/.temp/audit_probe2.py
python supabase/.temp/audit_probe3.py
python supabase/.temp/audit_probe4.py
```
Move the audit script under `supabase/audit_supabase.py` if it becomes a
recurring health check (currently dated and one-off — kept under `.temp/`).
