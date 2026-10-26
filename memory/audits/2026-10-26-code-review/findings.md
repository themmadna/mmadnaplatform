# Sectioned code review of `main` — 2026-10-26

`/code-review` run once per section, with path targets (no diff on `main`), at commit `6ea68e8`.
**Every finding below is UNVERIFIED.** Check the premise against the code (or live DB) before fixing.
Some reviewers queried the live DB to confirm theirs; those say "live".

Sections: S1 frontend core · S2 scoring UI · S3 other frontend · S4 scrapers · S5 live events + CI ·
S6a DB structure · S6b RPCs · S7 ML. Not reviewed: one-off `migrate_*` / `fix_*` scripts, `copys/`, mockups.

The fix order and to-do checklist are in [TODO.md](TODO.md).

---

## S1 Frontend core (App.js, dataService.js)
1. App.js:1491 handleSignOut doesn't reset judgingProfile/scoringInsights/scoredFights → cross-user leak + never refreshes
2. App.js:1964 isPastEventWindow treats all un-stamped 'upcoming' fights as scratched → blank card / all picks cancelled when poller fails
3. App.js:53 normPollName lacks NFD diacritic strip (use normName) → accented names never match ESPN
4. App.js:1559 isUpcoming parses YYYY-MM-DD as UTC → event-day off-by-one west of UTC
5. App.js:1011 live polling gated on event_date == local date → past local midnight / Europe no polling
6. dataService.js:474 .order foreignTable doesn't order parent → Community Favorites arbitrary
7. App.js:1203 Fight Finder: fight_dna_metrics unranged/unordered (1000 cap) + limit(400) unordered
8. App.js:1393 handleVote For You + showFilters uses recommendations list → vote dropped
9. App.js:1233 raw input in .or() filter → commas/parens break search
10. dataService.js:163 getAllPredictions isEventConcluded without mainEventFight → inconsistent with event view

## S2 Scoring UI
1. FightDetailView.js:621 header shows meta.round (ending round) outside spoiler gate; 'Title' check never matches (use meta.is_title_fight)
2. FightDetailView.js:126 buildRoundData doesn't group by judge_scores.bout; last-name fallback can pair rows across bouts
3. FightDetailView.js:686 no-meta completed branch: unshielded panel with scorableRounds leaks finish
4. FightDetailView.js:677 isLocked={false} hardcoded → live auto-reveal / judges_revealed_at never fire
5. FightDetailView.js:321 ESPN poll dedupes on status name only → missed END_OF_ROUND never unlocks round
6. FightDetailView.js:336 poll stale closure over scheduledRounds/scorableRounds → repeated Edge calls, wrong rounds_fought on 5-rd decision
7. RoundScoringPanel.js:199 historical "Skip" writes forfeited=true → later scorecard permanently ineligible, modal says otherwise
8. ScorecardComparison.js:119 userTotal sums rows beyond fought rounds (also RoundScoringPanel f1Total :262)
9. ScorecardComparison.js:156 winnerSide raw substring → wrong corner (use matchesFighter)
10. ScoringInsightsCard.js:106 gender/group fingerprints drop kd_pct; TierBadge :52 misreads groups_needed

## S3 Other frontend
1. JudgeProfileView.js:269 controversial fight opened with no id → scores keyed to undefined (guest: shared 'undefined' scorecard)
2. Leaderboard.js:139/163 expand-panel fights omit id + status → FightDetailView treats as not completed
3. UserJudgeComparison.js:276 disagreement click drops fight_id + status
4. JudgeComparison.js:265 lookup by bout string, no date → convention #1/#8; rematch opens wrong fight; or() injection
5. fighterNames.js:52 same-last-name fallback → Silva vs Silva pick graded wrong; sameMatchup misses swap
6. JudgeProfileView.js:275 (+139, JudgeComparison:276, UserJudgeComparison:286, JudgeDirectory:105,159) DATE strings parsed UTC → previous day
7. Leaderboard.js:56 getLeaderboardUserDetail swallows errors → error branch dead, empty cached forever
8. guestStorage.js:8 unguarded sessionStorage/JSON.parse in useState init → white screen
9. UserJudgeComparison.js:143 (+JudgeComparison:135) null RPC → blank page, no back
10. UserJudgeComparison.js:70 (+JudgeComparison:60, JudgeProfileView:87) no stale-response guard

## S4 Scrapers
1. check_data_freshness.py:73 truthiness on winner → draw/NC card always "incomplete" (known Allen vs Duncan FP; root cause)
2. master:272 result='draw' for NC/NC → NCs stored as draws (live: Perez vs Sumudaerji)
3. master:631 live + post-event crons overlap, different concurrency groups; select-then-insert with no unique → dup fmd/fights (ties to S-P2-21)
4. master:648 sync_meta only writes truthy winner → draws/NCs stay NULL (live: Blachowicz vs Guskov etc.) → pick_watcher never exits
5. master:678 rescrape only Decision% → early-scraped stoppages never repaired; draws re-fetched every run (comment says excluded)
6. scrape_mmadecisions.py:212 upsert errors swallowed, exit 0 on index fetch fail → green CI, silent stop
7. master:907 Phase 5 ESPN requests.get no timeout, no browser UA (live-events.md says required)
8. master:568 (+453) _bout_matches last-name rule → surname-sharing replacement keeps old bout name
9. master:505 --live sync_fights not event-scoped → 10 PoW fetches per cycle
10. master:627 sync_meta N+1 + 1000-row cap → older fights never backfilled

## S5 Live events + CI
1. poll-live-fights:175 claimedCompIds only from upcoming → stale cancelled row hijacks completed fight's comp → duplicate
2. poll-live-fights:268 metadata only stamped if !fight_ended_at → client stamp first = rounds_fought/ended_by_decision never set
3. poll-live-fights:344 main event = lowest non-null card_position → unmatched main → co-main ends event early (scraper stamp_event_ended_at same)
4. poll-live-fights:119 no res.ok checks → PostgREST errors return 200 skipped; updatesById set before PATCH succeeds
5. record-fight-status:35 any authed user can mark any fight final + arbitrary rounds; fight_id unvalidated in URL
6. record-fight-status:81 rounds fields overwritten every call → later fallback clobbers correct value
7. test_poll_live_fights.py:250 health check counts cron 'succeeded' (just queued) → misses 502/500
8. poll-live-fights:264 scheduled_rounds rewritten every cycle → PATCH every minute, sequential
9. poll-live-fights:144 chase cap only for ended fights → scratched upcoming rows poll ESPN for 2 days
10. poll-live-fights:200 double matching (cleanup)

## S6a DB structure (RLS/triggers/indexes/views)
1. deploy_triggers.py:68 update_fight_ratings re-inserts on cascade delete → FK violation aborts fights DELETE (auto-delete of voted bout)
2. judge_scores_coverage.sql:47 'overturned%' includes overturned stoppages → permanent 'missing' noise in 703 baseline
3. judge_scores_coverage.sql:41 SQL normalisation deletes accents, no whitespace collapse → false missing/partial
4. judge_scores_coverage.sql:92 uniqueness assumptions break on tournament cards / shared surnames → 'excess'
5. deploy_judge_scores_coverage.py:52 checks after DDL commit, Yan check depends on corner order
6. deploy_triggers.py:62 UPDATE of fight_id doesn't recount OLD fight
7. deploy_fight_dna_metrics.py:161 unguarded ::integer casts → one bad fmd row breaks fight_dna_metrics app-wide
8. deploy_fight_dna_metrics.py:268 parity sweep uses bout text join + frozen expected set → false FAIL after DDL applied
9. deploy_indexes.py:50 redundant idx_round_fight_stats_event_bout (dup of UNIQUE), stale comment
10. deploy_*.py duplicated run_sql boilerplate, inconsistent timeouts (cleanup → supabase/_mgmt.py)

## S6b RPCs
1. deploy_leaderboard_detail.py:253 REVOKE from anon but not PUBLIC → anon can read any user's detail (SECURITY DEFINER)
2. deploy_judging_profile.py:92 (+scoring_insights:116, leaderboard:142, leaderboard_detail:147, user_judge_comparison:82) judge rows matched by date+last name, ignore js.bout → cross-bout mixing; Jr. suffix breaks
3. deploy_scoring_insights.py:46 v_stat_rounds counts rfs rows (2/round) → tier gate at ~8 rounds; doubled progress
4. deploy_judge_directory.py:89 (+judge_profile:121) lone-dissenter on split rounds flags everyone
5. deploy_judge_directory.py:107 outlier_rate includes draws vs profile excludes → two different numbers
6. deploy_judge_profile.py:37 SET statement_timeout in function doesn't bound current call
7. deploy_judging_profile.py:152 (+leaderboard:191) user 10-10 rounds counted as misses
8. 6 of 8 deploy scripts exit 0 on failure
9. deploy_leaderboard_detail.py:118 unresolved official_winner shown as wrong pick, aggregate excludes
10. deploy_scoring_insights.py:38 dead vars + tier logic triplicated (cleanup)

## S7 ML model
1. train_scoring_model.py:193 ratio mirror `1-r` is wrong (should be f2/(f1+f2+1)) → model not antisymmetric; 0-0 round → f2 at ~77%
2. validate_scoring_model.py:196 rfs lookup by judge_scores.event_name + mmadecisions name → violates conventions #2/#8, near-empty report
3. validate_scoring_model.py:151 judge groups keyed (event, round, judge), no bout → multi-bout judges dropped as 'incomplete'
4. FightDetailView.js:28 loadScoringModel no r.ok, caches failed promise → model off for session, every round 10-10
5. FightDetailView.js:84 JS feature order hard-coded, never checked against data.features → NaN or silent mis-predictions after retrain
6. build_ml_dataset.py:156 (+validate :80,99,117) .range() pagination with no .order() → dup/missing rows
7. build_ml_dataset.py:127 Python matches_fighter missing first-name-prefix fallback (drift from fighterNames.js)
8. train_scoring_model.py:368 per-judge accuracy is in-sample; :405 ZeroDivisionError guard missing
9. train_scoring_model.py:610 exports to scoring_model/ but app reads public/ (manual copy); holdout label hard-coded '-2025'
10. train_scoring_model.py:194 post_2016 dead after augmentation; unused sigmoid/args; misaligned CV table (cleanup)
