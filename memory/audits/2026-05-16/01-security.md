# Security Findings — 2026-05-16

Three P0s, two P2s. Every finding cites the query that produces it.

---

## §1 P0 — Backup tables are anon-readable and anon-writable

**Tables:** `user_votes_backup` (130 rows, real user UUIDs), `fight_ratings_backup` (8500 rows, aggregate counts).

**RLS state:** `relrowsecurity = false` on both (from `pg_class`).

**Grants on `user_votes_backup` to `anon`:** `SELECT, INSERT, UPDATE, DELETE, REFERENCES, TRIGGER, TRUNCATE`.

**Evidence query:**
```sql
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='user_votes_backup'
  AND grantee IN ('anon','authenticated');
```

**Sample rows (via service key):**
```
id                                    user_id                               fight_id  vote_type  created_at
92e7f0af-65d3-4ab4-9bbe-3234c6096364  92ece4d5-d62d-48e3-988d-6d25c22152f2  4311      like       2026-01-13
7685d008-f79d-43dc-825f-c4cb36ecb74b  92ece4d5-d62d-48e3-988d-6d25c22152f2  5040      like       2026-01-13
5338853b-f858-4d91-8359-e40db424d250  955eb81c-00e3-4a88-b6bf-938fd4863a37  5223      dislike    2026-01-13
```

**Exploit:** PostgREST exposes these as `/rest/v1/user_votes_backup`. The anon key in the React bundle reads every row.

**Impact:** The tables are leftover snapshots from the April migration. Voting history is not deeply sensitive but is per-user-attributable. The DELETE/TRUNCATE grant to anon is a destructive surface.

**Remediation:** `DROP TABLE user_votes_backup; DROP TABLE fight_ratings_backup;` after a final confidence check that the live tables hold the canonical data. Do not "fix" by enabling RLS — these tables have no purpose.

---

## §2 P0 — Stale `"Votes are viewable by everyone"` policy overrides own-only on `user_votes`

`user_votes` has **8 policies**, 4 from `deploy_rls_policies.py` (the April fix) and 4 left over from before:

```
Policy                                    cmd       roles        qual                       check
Authenticated users can vote              INSERT    authenticated  -                        auth.uid() = user_id
Users can delete own vote                 DELETE    public         auth.uid() = user_id     -
Users can update own vote                 UPDATE    public         auth.uid() = user_id     -
Votes are viewable by everyone            SELECT    public         true                     -      <-- LEAK
user_votes_select_own                     SELECT    public         user_id = auth.uid()     -
user_votes_insert_own                     INSERT    public         -                        user_id = auth.uid()
user_votes_update_own                     UPDATE    public         user_id = auth.uid()     user_id = auth.uid()
user_votes_delete_own                     DELETE    public         user_id = auth.uid()     -
```

**Behavior:** Postgres OR-combines PERMISSIVE policies of the same command. `(qual = true) OR (user_id = auth.uid())` reduces to `true` — **every authenticated user can `SELECT *` from `user_votes`** and read every other user's voting history with user UUIDs.

**Evidence query:**
```sql
SELECT policyname, cmd, roles, qual, with_check
FROM pg_policies WHERE tablename='user_votes' ORDER BY policyname;
```

**Remediation:** Drop the 4 legacy policies (keep the four `user_votes_*_own`):
```sql
DROP POLICY "Votes are viewable by everyone" ON user_votes;
DROP POLICY "Authenticated users can vote" ON user_votes;
DROP POLICY "Users can update own vote" ON user_votes;
DROP POLICY "Users can delete own vote" ON user_votes;
```

After dropping, re-test: the SPA's "community favorites" / vote-tally features should still work because they read from `fight_ratings` (the aggregated view), not `user_votes` directly.

---

## §3 P0 — Deprecated `get_user_judging_profile(p_user_id uuid)` is SECURITY DEFINER, granted to anon, reads `user_round_scores` for arbitrary user_id

**Function:**
```sql
CREATE OR REPLACE FUNCTION public.get_user_judging_profile(p_user_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF p_user_id IS NULL THEN RETURN NULL; END IF;
  RETURN (
    WITH user_rounds AS (
      SELECT urs.fight_id, urs.round, urs.f1_score, urs.f2_score, f.fight_url, ue.event_date,
             fmd.fighter1_name, fmd.fighter2_name, fmd.weight_class, fmd.method
      FROM user_round_scores urs
      JOIN fights f ON f.id = urs.fight_id
      JOIN ufc_events ue ON ue.event_name = f.event_name
      LEFT JOIN fight_meta_details fmd ON fmd.fight_url = f.fight_url
      WHERE urs.user_id = p_user_id     -- <-- caller-supplied UUID, no auth check
    ),
    matched_judges AS (
      ... references judge_scores.fighter1_name, .f1_score, .judge_name -- columns don't exist
    )
  )
$function$
```

**Grants (from `information_schema.role_routine_grants`):**
```
specific_name                          grantee         privilege
get_user_judging_profile_92162  (uuid)  anon            EXECUTE
get_user_judging_profile_92162  (uuid)  authenticated   EXECUTE
get_user_judging_profile_92162  (uuid)  PUBLIC          EXECUTE
get_user_judging_profile_92163  ()      anon            EXECUTE
```

**Live-exfil status:** Today the function errors out before returning because it references renamed columns (`judge_scores.fighter1_name` was renamed to `fighter`, `f1_score` to `score`, etc.). However:
- The CTE `user_rounds` reads `user_round_scores WHERE user_id = p_user_id` under SECURITY DEFINER privs first — bypassing RLS — and the error doesn't fire until later.
- A future "cleanup" pass that updates the column references (without auditing the auth model) re-enables full IDOR.

**Documented intent (`context/rpc-functions.md`):**
> Overload (deprecated) — Older version, takes explicit user ID. Uses an outdated join strategy. Prefer the no-arg version from the frontend.

The frontend has migrated to the no-arg overload. This overload exists only as a dead artifact.

**Remediation:** `DROP FUNCTION public.get_user_judging_profile(p_user_id uuid);` — the no-arg `get_user_judging_profile()` remains untouched.

---

## §4 P2 — No `SECURITY DEFINER` function has `search_path` locked

The 6 SECURITY DEFINER functions in `public`:
- `get_community_scorecard(bigint)`
- `get_leaderboard()`
- `get_leaderboard_user_detail(uuid)`
- `get_scoring_insights()`
- `get_user_judge_comparison(text)`
- `get_user_judging_profile()` (no-arg)
- `get_user_judging_profile(uuid)` (deprecated — P0 #3 above)
- `update_fight_ratings()` (trigger function)

Only `get_judge_profile` has a `proconfig` set, and that's `statement_timeout=8s`. None set `search_path`.

**Risk:** PostgreSQL best practice is `SET search_path = public, pg_temp` on SECURITY DEFINER functions to prevent function hijacking via attacker-created objects in `pg_temp`. On Supabase the anon/authenticated roles can't create tables in public, so the attack vector is narrow, but the hardening is one line per function.

**Evidence:**
```sql
SELECT p.proname, p.prosecdef, p.proconfig
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prosecdef = true;
```

**Remediation:** Add `SET search_path = public, pg_temp` after `LANGUAGE plpgsql SECURITY DEFINER` in each function. Update `supabase/deploy_*.py` scripts so this isn't lost on redeploy.

---

## §5 P2 — Grant drift on user-scoped RPCs (anon EXECUTE granted, docs say authenticated-only)

`context/rpc-functions.md` documents `get_user_judging_profile()`, `get_user_judge_comparison()`, and several others as `GRANT to authenticated only`. Live grants show **anon EXECUTE granted** on all of them:

| Function | Documented | Live |
|---|---|---|
| `get_user_judging_profile()` | authenticated | anon, authenticated, PUBLIC, service_role |
| `get_user_judge_comparison(text)` | authenticated only | anon, authenticated, PUBLIC, service_role |
| `get_scoring_insights()` | authenticated | anon, authenticated, PUBLIC, service_role |
| `get_liked_fight_stats()` | authenticated | anon, authenticated, PUBLIC, service_role |

**Practical impact:** All four use `auth.uid()` which is `NULL` for anon calls, so they return empty payloads (`{}` or `[]`). Not a leak today.

**Risk:** Surface area is wider than the docs claim. A bug that treats `NULL` as "match all users" (similar to the `record-fight-status` April finding) becomes anon-exploitable instead of authenticated-only. Also: an anon caller can repeatedly invoke these to mine timing signals about user data.

**Remediation:** `REVOKE EXECUTE ON FUNCTION ... FROM anon, PUBLIC;` and add the REVOKE to the corresponding `deploy_*.py` script so it survives redeploys.

---

## §6 P2 — `fight_ratings` has 2 redundant public-read SELECT policies

```
Policy                              cmd     roles   qual
Enable read access for all users    SELECT  public  true
Public Read Ratings                 SELECT  public  true
```

`fight_ratings` holds aggregated like/dislike/favorite counts — intentionally public. Two `qual=true` policies is just leftover cruft. Drop one for cleanliness; not a security issue.

---

## §7 Areas confirmed clean

- **No SQL injection surface added.** All RPCs are PL/pgSQL with parameterized inputs.
- **Edge functions reviewed:**
  - `poll-live-fights` — internal cron caller only; no user auth needed.
  - `record-fight-status` — JWT validation in place (April P0 fix holds).
- **Service key not present in committed source** — grep confirms.
- **All 4 user-data tables (`user_round_scores`, `user_fight_scorecard_state`, `user_votes`, `profiles`) have RLS enabled with `user_id = auth.uid()` policies for all CRUD operations** (April P0-2 fix holds).
- **`get_leaderboard_user_detail(uuid)`** has `anon` REVOKED (April P2 #17 fix holds — grants show only `authenticated, PUBLIC, service_role` EXECUTE).
- **No `dangerouslySetInnerHTML` use** — re-grep confirms.
- **Storage: 0 buckets, nothing public.**
