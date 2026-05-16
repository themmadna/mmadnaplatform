# Views & RPCs — 2026-05-16

---

## §1 RPC inventory (live signatures)

13 distinct functions in `public`, signatures match `context/rpc-functions.md` **except**:

| Function | Doc says | Live state |
|---|---|---|
| `get_user_judging_profile(uuid)` | "deprecated, prefer no-arg" | **Still deployed, granted to anon, SECURITY DEFINER, references renamed columns → errors at runtime.** P0 — see 01-security §3. |
| `get_user_judging_profile()` | GRANT authenticated | Granted to anon, authenticated, PUBLIC, service_role. P2 grant drift — see 01-security §5. |
| `get_user_judge_comparison(text)` | "GRANT to authenticated only" | Granted to anon, authenticated, PUBLIC, service_role. P2 grant drift. |
| `get_scoring_insights()` | authenticated | Granted to anon, authenticated, PUBLIC, service_role. P2 grant drift. |
| `get_liked_fight_stats()` | authenticated | Granted to anon, authenticated, PUBLIC, service_role. P2 grant drift. |
| `get_leaderboard_user_detail(uuid)` | "anon REVOKED" | ✅ Anon revoked (April fix holds). |
| `update_fight_ratings()` | trigger | Granted EXECUTE to anon, authenticated, PUBLIC, service_role. P2 — trigger functions don't need EXECUTE grants on top of trigger-firing. Cleanup, no exploit. |

**SECURITY DEFINER set on:**
`get_community_scorecard`, `get_leaderboard`, `get_leaderboard_user_detail`, `get_scoring_insights`, `get_user_judge_comparison`, `get_user_judging_profile` (both overloads), `update_fight_ratings`.

**No `search_path` lock on any DEFINER function.** See 01-security §4.

---

## §2 Convention #2 (judge_scores ±1 day date join) — clean

Every RPC that touches `judge_scores` uses the `BETWEEN date - INTERVAL '1 day' AND date + INTERVAL '1 day'` pattern:

```
get_judge_profile                       ✓ date window
get_leaderboard                         ✓ date window
get_leaderboard_user_detail             ✓ date window
get_scoring_insights                    ✓ date window
get_user_judge_comparison               ✓ date window
get_user_judging_profile (both)         ✓ date window
get_judge_directory                     N/A — pure judge_scores aggregation, no fights join
get_judge_comparison                    N/A — pure judge_scores aggregation
```

No RPC uses `judge_scores.event_name = fights.event_name` anywhere. ✅

---

## §3 Convention #9 (bout-reversal between fmd.bout and rfs.bout) — partial

Reverse-aware RPCs (both bout orderings explicitly handled):
```
get_judge_profile               ✓
get_scoring_insights            ✓
get_user_judging_profile()      ✓
```

**Not reverse-aware (but in practice safe):**

### `fight_dna_metrics` view

The view aggregates `round_fight_stats` by `(event_name, bout)` and joins to `fights` on the same pair:
```sql
LEFT JOIN (
  SELECT event_name, bout, SUM(...) FROM round_fight_stats GROUP BY event_name, bout
) s ON f.event_name = s.event_name AND f.bout = s.bout
LEFT JOIN fight_meta_details m ON f.fight_url = m.fight_url
```

The join `f.bout = s.bout` is **not reverse-aware**. The threat: if `rfs.bout` is sometimes reversed vs `fights.bout`, stats silently drop.

**Live check (run as part of the audit):**
```
Bout-pair comparison across the join chain:
- fights.bout vs fight_meta_details.bout: 5633 same / 3052 reversed / 1 neither
- fights.bout vs rfs.bout (reverse-aware probe): 0 fights have v.metric_pace=0
  with rfs data only available via the reversed-bout key
```

So in practice rfs.bout and fights.bout are aligned today (both come from the same ufcstats completed-fights scrape). The view's blind spot exists but isn't producing data loss right now.

**P2 tech debt:** Refactor `fight_dna_metrics` to join `rfs` to `fights` via `fight_url` once §3 in `02-schema.md` (NULL fight_url in recent rfs rows) is resolved. This eliminates the textual-bout dependency entirely.

### `fight_scraping_status` view

Joins via fight_url — not affected by bout reversal. ✓

### `judge_scores_coverage` view

Pure mmadecisions aggregation, joins to fmd on event date and counts matching judge rows. Bout reversal doesn't apply because it doesn't join to `round_fight_stats`. ✓

---

## §4 RPC behavior sanity checks

### `get_leaderboard()`
- `fmd.method ILIKE 'Decision%'` filter ✅ as documented.
- `leaderboard_eligible = TRUE` filter ✅.
- Min 3 fights threshold ✅.
- Returns user_id UUIDs — see April P2 #17 (resolved: detail RPC anon revoked).
- **Caveat:** Three completed decision fights have `fights.winner = NULL` (see 04-data-quality §2). The RPC's `fights.winner IS NOT NULL` filter silently excludes them, so users who scored those fights get no credit. Not an RPC bug — a data bug — but worth knowing.

### `get_user_judging_profile()` (no-arg, live)
- Uses `auth.uid()` directly ✓.
- Reverse-aware bout join ✓.
- Reads `auth.users` indirectly via `auth.uid()` — pure SECURITY DEFINER usage.

### `get_scoring_insights()`
- Tier gating logic (15/40/80 rounds) matches docs.
- Reuses same CTE structure as `get_user_judging_profile()` per docs — confirmed by inspecting body.

### `get_judge_profile(p_judge text)`
- Has `statement_timeout=8s` configured — the only function with a `proconfig`. Sensible guard given this RPC scans `judge_scores` aggregations across 63K rows.

### `get_community_scorecard(p_fight_id bigint)`
- SECURITY DEFINER. Returns per-round averages — public-safe (no per-user identifiers).
- Granted to anon — appropriate.

### `update_fight_ratings()` trigger
- Trigger fires on `user_votes` AFTER INSERT/UPDATE/DELETE.
- Body recomputes `(likes_count, dislikes_count, favorites_count)` for the affected `fight_id` and upserts into `fight_ratings`. Matches `supabase/deploy_triggers.py` ✓.
- Trigger name `sync_fight_ratings` ✓ enabled (`tgenabled = 'O'` = origin/replica).

### Deprecated `get_user_judging_profile(uuid)`
- Body references columns that no longer exist:
  - `judge_scores.judge_name` — column is `judge`
  - `judge_scores.f1_score` / `f2_score` — column is `score` (one row per fighter)
  - `judge_scores.fighter1_name` / `fighter2_name` — column is `fighter`
- Will throw `column "judge_name" does not exist` at runtime.
- **The `user_rounds` CTE that reads `user_round_scores` runs first under SECURITY DEFINER privs**, bypassing RLS, before the error fires. P0 — see 01-security §3.

---

## §5 RPCs that swallow errors / return safe defaults

`get_leaderboard` and `get_leaderboard_user_detail` use plpgsql with explicit error-handling that returns empty JSON on `WHEN OTHERS` (per April #18). Confirmed in `deploy_leaderboard.py` and `deploy_leaderboard_detail.py`. No "silent degrade" pattern found in other RPCs.

---

## §6 Views inventory

| View | Purpose | Source tables | Live row count via service key |
|---|---|---|---|
| `fight_dna_metrics` | Per-fight DNA aggregates for chart UI | `fights`, `round_fight_stats`, `fight_meta_details` | ~8700 (one per fight) |
| `fight_scraping_status` | Diagnostic — expected vs actual rfs row count per fight | `ufc_events`, `fights`, `fight_meta_details`, `round_fight_stats` | ~8700 |
| `judge_scores_coverage` | Diagnostic — judge score completeness per decision fight | `fight_meta_details`, `ufc_events`, `judge_scores` | ~3000 (decisions only) |
| `ufc_baselines` | League averages used as radar polygon | `fight_dna_metrics` | 1 |

All four are referenced in code:
- `fight_dna_metrics` — read by `dataService.js` for combat DNA chart
- `fight_scraping_status` — diagnostic, read by `audit_leaderboard.py` and `check_scoring_coverage.py`
- `judge_scores_coverage` — diagnostic, read by `check_scoring_coverage.py`
- `ufc_baselines` — read by `dataService.getCombatDNA()` for the chart background

**Public-read grants** confirmed on all four (intentional — they're public data aggregations).
