# Code review to-do — 2026-10-26

Source: [findings.md](findings.md). IDs like S5-5 = section 5, finding 5.
**Status markers:** `[ ]` not started · `[~]` in progress · `[x]` complete · `[!]` blocked · `[-]` premise wrong, no fix
**Rule:** verify each premise against the code (or live DB) before fixing. These findings are unverified.

---

## G1 — Security (fix first)
- [ ] **S5-5** `record-fight-status`: any authed user can mark any fight final, set arbitrary round fields, and pass an unvalidated `fight_id` into the URL. Fold in **S5-6**: round fields are overwritten on every call.
- [ ] **S6b-1** `get_leaderboard_user_detail`: `REVOKE ... FROM anon, PUBLIC` (follow the S-P2-9 pattern). Sweep the other RPCs for the same gap; overlaps with S-P2-20.
- [ ] **S1-1** `handleSignOut`: reset `judgingProfile` / `scoringInsights` / `scoredFights`, and refetch after scoring.

## G2 — Write paths / data integrity
- [ ] **S6a-1** `update_fight_ratings` trigger on cascade delete → FK violation? Test in a rolled-back txn first. Fold in **S6a-6** (recount OLD fight on UPDATE).
- [ ] **S4-3** live and post-event crons overlap → duplicate fmd/fights rows. Pair with **S-P2-21** (fmd PK + UNIQUE(fight_url)); also consider a shared concurrency group.
- [ ] **S6a-7** `fight_dna_metrics`: guard the `::integer` casts.

## G3 — Draw / NC semantics
- [ ] **S4-2** NC stored as `result='draw'` (live: Perez vs Sumudaerji). Backfill needed.
- [ ] **S4-4** write `winner=''` for draws/NC in `sync_meta` (live: Blachowicz vs Guskov, Padilla vs Mederos, Nzechukwu vs Buchecha). Backfill needed.
- [ ] **S4-1** freshness check: `is not None` instead of truthiness on winner.
- [ ] **S4-5** rescrape filter: include early-scraped stoppages, and exclude confirmed draws as the comment says.
- [ ] **S6b-9** leaderboard detail shows an unresolved `official_winner` as a wrong pick.

## G4 — Name matching (one shared bout-scoped matcher)
- [ ] **S3-5 / S4-8** the same-last-name fallback in `matchesFighter` / `_bout_matches`.
- [ ] **S2-2 / S6b-2** judge rows not scoped by `judge_scores.bout` (FightDetailView + 5 RPCs); Jr. suffix.
- [ ] **S1-3** `normPollName` → `normName` (NFD).
- [ ] **S6a-3 / S6a-4** `judge_scores_coverage` SQL normalisation + uniqueness assumptions. Fold in S6a-2 (overturned stoppages in scope) and S6a-5 (deploy checks after DDL).
- [ ] **S3-4** JudgeComparison fight lookup by bout string → use fight_url/date.
- [ ] **S2-9** `winnerSide` raw substring → `matchesFighter`.
- [ ] **S7-7** Python matcher drift.

## G5 — Time zones
- [ ] **S1-4 / S3-6** DATE strings parsed as UTC (~8 sites) → one local-date helper.
- [ ] **S1-5** live polling gated on local date == event_date.

## G6 — Live scoring + poller
- [ ] **S2-4** `isLocked={false}` hardcoded.
- [ ] **S2-5 / S2-6** ESPN poll dedupe ignores period; stale closure over round counts.
- [ ] **S5-1** `claimedCompIds` only from upcoming fights → stale row hijacks a completed comp.
- [ ] **S5-2** metadata never backfilled when the client stamped fight_ended_at first.
- [ ] **S5-3** main-event detection when card_position is null (+ scraper `stamp_event_ended_at`).
- [ ] **S5-8 / S5-9** PATCH every cycle; no chase cap on never-ended rows.
- [ ] **S1-2** `isPastEventWindow` treats every un-stamped upcoming fight as scratched.
- [ ] **S1-10** `getAllPredictions` misses the mainEventFight signal.

## G7 — Spoiler leaks
- [ ] **S2-1** header shows `meta.round` outside the gate; Title check should use `meta.is_title_fight`.
- [ ] **S2-3** the no-meta completed branch renders an unshielded panel.

## G8 — Silent failures
- [ ] **S4-6** `scrape_mmadecisions` exits 0 on write/index failure.
- [ ] **S5-4** poller: no `res.ok` checks → 200 on Supabase errors.
- [ ] **S5-7** health check counts a queued cron run as success (check `net._http_response`).
- [ ] **S6b-8** 6 of 8 RPC deploy scripts exit 0 on failure.
- [ ] **S4-7** Phase 5 ESPN fetch: add timeout + browser UA.
- [ ] **S3-7** leaderboard detail swallows errors and caches empty forever.
- [ ] **S7-4** `loadScoringModel` caches the failed promise.

## G9 — ML
- [ ] **S7-1** fix the ratio mirror → retrain → verify antisymmetry. (Changes `scoring_model.json`; Bastian sign-off.)
- [ ] **S7-2 / S7-3** `validate_scoring_model.py` joins (conventions #2/#8; bout key).
- [ ] **S7-9** export path vs `public/scoring_model.json`; holdout label.
- [ ] **S7-5** JS feature-order check against `data.features`.
- [ ] **S7-6** ordered pagination (build + validate).

## G10 — Smaller issues
- [ ] **S3-1 / S3-2 / S3-3** pass `id` + `status` when opening fights from Leaderboard / JudgeProfile / UserJudgeComparison.
- [ ] **S1-6 / S1-7** Community Favorites ordering; Fight Finder caps/ordering.
- [ ] **S1-8** vote dropped on For You with the filter panel open.
- [ ] **S1-9** escape search input in the `.or()` filter.
- [ ] **S2-7** historical Skip → `forfeited=true` contradicts the modal.
- [ ] **S2-8** userTotal sums unfought rounds.
- [ ] **S2-10** fingerprints drop kd_pct; TierBadge groups.
- [ ] **S3-8** guard sessionStorage / JSON.parse.
- [ ] **S3-9 / S3-10** null-RPC dead end; stale-response guards.
- [ ] **S4-9 / S4-10** live sync_fights not event-scoped; sync_meta N+1 + 1000 cap.
- [ ] **S6b-3** `v_stat_rounds` double count (tier gate).
- [ ] **S6b-4 / S6b-5** lone-dissenter on split rounds; outlier_rate draw inconsistency.
- [ ] **S6b-6** `statement_timeout` in the function SET clause is ineffective.
- [ ] **S6b-7** user 10-10 rounds counted as misses.
- [ ] Cleanup: S5-10, S6a-8, S6a-9, S6a-10, S6b-10, S7-8, S7-10.
