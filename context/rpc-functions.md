# RPC Functions Reference

All Supabase RPC function signatures, parameters, return shapes, and implementation notes.
Update this file whenever an RPC is added, modified, or redeployed.

Deploy script for judging profile: `supabase/deploy_judging_profile.py`

---

## `get_community_scorecard(p_fight_id bigint)`

Returns per-round average scores across all users for a given fight.

```
Returns: TABLE(round integer, f1_avg numeric, f2_avg numeric, user_count integer)
```

---

## `get_fight_recommendations`

### Overload 1 — explicit DNA weights
```
get_fight_recommendations(
  p_user_id uuid,
  p_pace numeric,
  p_violence numeric,
  p_control numeric,
  p_finish numeric,
  p_duration numeric,
  p_intensity numeric
)
Returns: TABLE(id, event_name, bout, event_date, fight_url, dist, match_reason)
```
Returns up to 20 fight recommendations by Euclidean distance from provided DNA weights. Excludes fights the user has already voted on.

### Overload 2 — auto DNA from liked fights
```
get_fight_recommendations(p_user_id uuid)
```
Computes DNA automatically from the user's liked fights, then runs the same distance query.

Frontend: `getRecommendations(userId, combatDNA)` — both args required, maps to all 7 RPC params.

---

## `get_liked_fight_stats()`

Returns all `round_fight_stats` rows for fights the current user (`auth.uid()`) has liked.

```
Returns: SETOF round_fight_stats
```

---

## `get_user_judging_profile()`

Returns a JSON object with the current user's (`auth.uid()`) judging accuracy and tendencies.

**Join strategy:** `user_round_scores` → `judge_scores` via ±1 day date window + last-name fighter matching. Uses `auth.uid()` directly (SECURITY DEFINER, no param). `judge_scores` schema: one row per **fighter** per judge per round. RPC pivots with `MAX(CASE ...)` to produce judge_f1_score/judge_f2_score per (fight, round, judge). Only keeps complete pairs (both NOT NULL).

```
Returns: json {
  fights_scored,
  rounds_scored,
  rounds_matched,
  accuracy,           -- % rounds matching majority judge decision
  outlier_rate,       -- % rounds where 0 judges agreed (lone dissenter)
  ten_eight_rate,     -- % rounds user scored 10-8
  ten_eight_quality,  -- of user 10-8 rounds, % where judges also scored it dominant
  agreement_breakdown: {
    all3, two_of_three, one_of_three, lone_dissenter,
    total,
    all3_pct, two_of_three_pct, one_of_three_pct, lone_dissenter_pct
  },
  accuracy_by_class: [{ weight_class_clean, accuracy, rounds, avg_loser_score, striking_pct, grappling_pct }],
  judges: [{ name, agreement_pct, rounds }],  -- closest judge matches (≥5 shared rounds)

  -- Bias metrics (null when no round_fight_stats available for the user's fights)
  striking_vs_grappling_bias: { striking_pct, grappling_pct, rounds },
    -- striking_pct: % rounds where user's winner had more sig_strikes_landed
    -- grappling_pct: % rounds where user's winner had more (takedowns_landed + control_time_sec)
  aggressor_bias,     -- % rounds where user's winner threw more but landed at lower accuracy
  takedown_quality_bias: { passive_control_pct, control_rounds },
    -- passive: ctrl_sec > 30, sub_attempts = 0, ground_strikes <= 3
  knockdown_bias: { kd_bias_pct, kd_rounds }
    -- on KD rounds, % of time user awarded the fighter who scored the knockdown
}
```

**Implementation notes:**
- `agreement_breakdown` denominator = all rounds with judge data (includes split-decision rounds where majority_winner IS NULL)
- `accuracy` denominator = only rounds with a clear majority — these differ intentionally
- `accuracy_by_class` must use a subquery to pre-aggregate before `json_agg` — cannot nest `AVG`/`COUNT` inside `json_agg(ORDER BY COUNT(*))` (PostgreSQL error 42803)
- `accuracy_by_class` now includes `striking_pct` and `grappling_pct` via LEFT JOIN to `class_bias` CTE
- `judges_agreeing` computed as a window function in the `majority` CTE alongside `f1_wins`/`f2_wins` — same partition, no extra CTE needed
- Don't use `EXISTS` referencing a CTE name inside another CTE's WHERE clause — use a JOIN instead
- `round_fight_stats` join: `user_rounds` carries `fmd_event_name` + `fmd_bout` (from fight_meta_details); joined via event_name+round + **both bout orderings** (`rfs.bout = fmd.bout OR rfs.bout = reversed(fmd.bout)`) — fmd.bout and rfs.bout are often reversed even though both come from ufcstats
- Fighter assignment in `fight_stats_pivoted` uses last-name match (same as judge_scores pivot)
- `round_winner_stats` only includes rounds with complete stats (f1_ssl IS NOT NULL) and no draws (user_f1 != user_f2)
- `aggressor_bias`: guards against division by zero with NULLIF; requires both winner_ssa and loser_ssa NOT NULL

### Overload (deprecated)
```
get_user_judging_profile(p_user_id uuid)
```
Older version, takes explicit user ID. Uses an outdated join strategy. **Prefer the no-arg version from the frontend.**

Frontend: `dataService.getUserJudgingProfile()` calls `supabase.rpc('get_user_judging_profile')` — NO params.

---

## `update_fight_ratings()` (trigger function)

Trigger on `user_votes` (INSERT/UPDATE/DELETE). Recounts likes/dislikes/favorites for the affected fight and upserts into `fight_ratings`.
