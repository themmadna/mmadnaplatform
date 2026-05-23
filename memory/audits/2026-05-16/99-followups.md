# Followups — 2026-05-16

Backlog with proposed fixes. **No deploy scripts written.** Build them only after Bastian reviews and prioritizes.

---

## P0 — fix before next user-facing release

### 1. Drop backup tables (or at minimum revoke anon)
- **Tables:** `user_votes_backup`, `fight_ratings_backup`
- **Action:** `DROP TABLE user_votes_backup; DROP TABLE fight_ratings_backup;`
- **Verify first:** `SELECT COUNT(*) FROM user_votes; -- expect ≥ 240` (i.e., live data ≥ backup count).
- **Deploy script to add:** `supabase/cleanup_2026_05_16.py` or fold into a new `supabase/deploy_rls_policies.py` update.
- **Ref:** `01-security.md §1`

### 2. Drop the 4 stale `user_votes` policies
- **Action:**
  ```sql
  DROP POLICY "Votes are viewable by everyone" ON user_votes;
  DROP POLICY "Authenticated users can vote" ON user_votes;
  DROP POLICY "Users can update own vote" ON user_votes;
  DROP POLICY "Users can delete own vote" ON user_votes;
  ```
- **Test post-drop:** anon SELECT against `/rest/v1/user_votes` should return only the caller's own rows (0 for anon).
- **Update `supabase/deploy_rls_policies.py`** to include these DROPs at the top, so a redeploy is idempotent.
- **Ref:** `01-security.md §2`

### 3. Drop the deprecated `get_user_judging_profile(uuid)` overload
- **Action:** `DROP FUNCTION public.get_user_judging_profile(p_user_id uuid);`
- **Frontend impact:** zero — `dataService.getUserJudgingProfile()` calls the no-arg overload.
- **Add to `supabase/deploy_judging_profile.py`:** prepend the DROP so future redeploys don't re-create the deprecated one.
- **Ref:** `01-security.md §3`, `03-views-rpcs.md §1`

---

## P1 — fix before next scraper run

### 4. ~~Backfill `fights.winner` for 3 NULL-winner decision fights~~ — **RESOLVED 2026-05-23**
The audit premise was wrong. Bastian verified on ufcstats: all 3 fights (8281, 8269, 8761) are genuine **draws** — both fighters have "D" status. `fights.winner = NULL` is correct.

Actions taken instead:
- `supabase/fix_fmd_result_draws.py` — set `fmd.result = 'draw'` for 8269 + 8281 (8761 already had it)
- `ScorecardComparison.js` + `FightDetailView.js` — render "Draw — {method}" instead of just method text when winner is NULL on a decision
- `master file for data update.py` — added `rescrape_null_winner_decisions()` called from `sync_meta` so future stale rows get re-checked
- See `04-data-quality.md §2` for the resolution writeup
- New follow-ups split out: **#16** (method_details parser bug), **#17** (judge_scores fighter-inversion bug)

### 5. Populate `round_fight_stats.fight_url` on new inserts + backfill
- **Scraper change:** include `fight_url` in Phase 4 upsert column list in `master file for data update.py`.
- **One-time backfill SQL:**
  ```sql
  UPDATE round_fight_stats rfs
  SET fight_url = f.fight_url
  FROM fights f
  WHERE rfs.event_name = f.event_name
    AND (rfs.bout = f.bout
         OR rfs.bout = TRIM(SPLIT_PART(f.bout,' vs ',2)) || ' vs ' || TRIM(SPLIT_PART(f.bout,' vs ',1)))
    AND rfs.fight_url IS NULL;
  ```
  Affects ~270 rows across 5 recent events.
**Ref:** `02-schema.md §3`, `04-data-quality.md §3`

### 6. Resolve fight 8754 duplicate rfs rows (Patricio Pitbull alias)
- Decide canonical name (ufcstats currently uses "Patricio Pitbull").
- `DELETE FROM round_fight_stats WHERE event_name='UFC 327: Prochazka vs Ulberg' AND bout='Patricio Freire vs Aaron Pico';`
- `UPDATE fights SET bout='Patricio Pitbull vs Aaron Pico', winner=COALESCE(winner,'Aaron Pico') WHERE id=8754;`  -- verify winner first
- `UPDATE fight_meta_details SET ... ` (only if fmd's name is the other variant)
- This also collapses the "1 neither" census count to 0.
**Ref:** `04-data-quality.md §4`

### 7. Switch `user_votes.fight_id → fights.id` to ON DELETE CASCADE
- **Action:**
  ```sql
  ALTER TABLE user_votes DROP CONSTRAINT user_votes_fight_id_fkey;
  ALTER TABLE user_votes ADD CONSTRAINT user_votes_fight_id_fkey
    FOREIGN KEY (fight_id) REFERENCES fights(id) ON DELETE CASCADE;
  ```
- Matches the pattern used on the 3 sibling user-data tables. Otherwise a future fight deletion (via the auto-delete guard misfiring, or manual cleanup) blocks on this constraint.
**Ref:** `02-schema.md §1`

---

## P2 — tech debt backlog

### 8. Lock `search_path` on all SECURITY DEFINER functions
Add `SET search_path = public, pg_temp` after `SECURITY DEFINER` in each function:
- `get_community_scorecard`
- `get_leaderboard`
- `get_leaderboard_user_detail`
- `get_scoring_insights`
- `get_user_judge_comparison`
- `get_user_judging_profile()` (no-arg)
- `update_fight_ratings` (trigger function)

Update each `supabase/deploy_*.py` so the lock survives redeploys.
**Ref:** `01-security.md §4`

### 9. Revoke anon EXECUTE on user-scoped RPCs
Bring grants in line with `context/rpc-functions.md` documentation:
```sql
REVOKE EXECUTE ON FUNCTION public.get_user_judging_profile() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_user_judge_comparison(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_scoring_insights() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_liked_fight_stats() FROM anon, PUBLIC;
```
And in each `deploy_*.py` script, add the REVOKE after CREATE so it survives.
**Ref:** `01-security.md §5`

### 10. Drop redundant `fight_ratings` SELECT policy
```sql
DROP POLICY "Public Read Ratings" ON fight_ratings;
-- keep "Enable read access for all users"
```
**Ref:** `01-security.md §6`

### 11. Refactor `fight_dna_metrics` view to join via `fight_url`
After P1 #5 is done (rfs.fight_url populated):
```sql
CREATE OR REPLACE VIEW fight_dna_metrics AS
SELECT f.id AS fight_id, f.status, ...
FROM fights f
LEFT JOIN (
  SELECT fight_url, SUM(...) FROM round_fight_stats WHERE fight_url IS NOT NULL GROUP BY fight_url
) s ON s.fight_url = f.fight_url
LEFT JOIN fight_meta_details m ON m.fight_url = f.fight_url;
```
Eliminates the (event_name, bout) join entirely and removes the convention #9 trap from the view definition.
**Ref:** `03-views-rpcs.md §3`

### 12. Add FK `fight_meta_details.fight_url → fights.fight_url ON DELETE CASCADE`
Confirmed 0 fmd rows are orphaned. Adding the FK formalizes what's already true and protects future inserts.
**Ref:** `02-schema.md §1`

### 13. Add `idx_round_fight_stats_fight_url` and `idx_user_votes_fight_id`
- The first enables the view refactor in #11 to perform.
- The second speeds the `update_fight_ratings` trigger.
Add both to `supabase/deploy_indexes.py`.
**Ref:** `02-schema.md §4`

### 14. Revoke EXECUTE on `update_fight_ratings()` from PUBLIC/anon
Trigger functions don't need explicit EXECUTE — only the trigger machinery invokes them. Tightening reduces surface.
```sql
REVOKE EXECUTE ON FUNCTION update_fight_ratings() FROM PUBLIC, anon, authenticated;
-- service_role and the trigger continue to work
```
**Ref:** `03-views-rpcs.md §1`

---

## Discovered 2026-05-23 during S-P1-4 investigation

### 16. `fmd.method_details` parser drops the loser's score
ufcstats renders judge scorecard text as `Junichiro Kamijo 28 - 29.` but the DB stores `Junichiro Kamijo: 29.` — the first number (loser's side) is lost and a colon is injected between name and score. Affects all draws and likely many wins too. Blocks the frontend "Judges total" comparison in ScorecardComparison for any fight scraped by the current parser.

- **Investigate:** the parser at [master file for data update.py:191-194](master file for data update.py#L191-L194). The likely culprit is how `i.b-fight-details__text-item` / `i.b-fight-details__text-item_first` are zipped against labels, combined with the `v.text.replace(l.text, "")` strip. Need to fetch the actual HTML structure (blocked locally by ufcstats' Cloudflare JS challenge) to design the fix.
- **Backfill:** after parser fix, re-scrape all fmd rows where method_details matches `r'^[A-Z][a-z]+ [A-Z][a-z]+: \d+\.'` (single-number-per-judge pattern) — and `IS NULL OR = ''` for fights where the details weren't captured at all.

### 17. `judge_scores` has Solimar Miranda's fighters inverted on fight 8761
DB stores Miranda's R1/R2/R3 as `Padilla 10/9/10, Mederos 9/10/8` (totals 29-27 Padilla); ufcstats shows `27 - 29` (i.e., the 29 went to Mederos, 27 to Padilla). Only this one judge on this one fight — Cleary and Rodriguez are correct.

- **Investigate:** `scrape_mmadecisions.py` — under what condition would one judge's fighter columns get swapped? Possibly a layout variant on the mmadecisions scorecard page.
- **Scope:** scan for similar inversions across the table. Compare each judge's total to the fight's "Decision - {X}" method label and flag inconsistencies.
- **Fix:** patch scraper, then re-scrape affected scorecards.

---

## Audit re-run

The scripts that produced these findings are in `supabase/.temp/` (gitignored):
- `audit_2026_05_16.py` — primary inventory
- `audit_probe2.py` — view coverage + cron + judge-score coverage
- `audit_probe3.py` — backup tables + deprecated overload body
- `audit_probe4.py` — final probes (duplicate rfs, NULL fight_url, etc.)

Output JSON in `supabase/.temp/audit_dump.json`, `audit_probe[2-4].json`.

Re-run all four after any RLS, grant, RPC, or schema change.
