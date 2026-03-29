# OPEN-QUESTIONS.md
*Unresolved questions, unknowns, and deferred choices. Read when starting a new feature or when something is unclear.*

---

## Entry Format
```
## [Question]
Context:
Why it matters:
```

---

## Open Questions

---

## Does `rounds_fought` get written correctly when no browser is open during a live fight?
Context: `poll-live-fights` Edge Function + pg_cron was deployed to handle server-side ESPN polling. The client-side path was confirmed working but the server-side path (no user watching) was never explicitly verified with a real event.
Why it matters: If pg_cron isn't firing or the Edge Function is writing `period = 0` due to ESPN's STATUS_FINAL quirk, `rounds_fought` stays null/0, the scoring panel disappears, and users can't score the fight.

---

## Should "View judges without scoring" trigger a forfeit path or just skip leaderboard eligibility?
Context: Deferred from 6c. The scoring panel currently has no way to reveal judge scores without first completing your own scorecard. The intended UX was: a "View judges" option that sets `forfeited = true`, with an ineligibility warning modal shown before the user confirms.
Why it matters: Some users will want to look up results without scoring — blocking them entirely hurts UX. The forfeit path needs to cleanly set `leaderboard_eligible = false` without corrupting the `user_fight_scorecard_state` record.

---

## What is the right UX for the ineligibility warning modal?
Context: Related to the forfeit path above. The original spec called for a confirmation step (cancel / proceed) shown before forfeiting OR before editing post-reveal scores. It should not be just a dismissible notice — the user must actively choose.
Why it matters: If the modal is too easy to dismiss, users will accidentally forfeit and lose leaderboard eligibility without realizing it.

---

## What data shape does `round_fight_stats` have for landed vs attempted strikes per zone?
Context: `CombatDNAVisual` body map currently shows strike distribution but the landed vs attempted distinction was flagged as incomplete. The investigation was deferred after Phase 8.
Why it matters: The body map is more useful if it can toggle between landed and attempted. The feasibility depends on whether ufcstats provides per-zone attempted counts (it does for sig strikes overall but zone-level granularity is unclear).

---

## Should Phase 5 (Weight Class Analytics) be its own page or a tab within the existing fight browse view?
Context: Phase 5 is not started. It covers division overview, style trends over time, radar fingerprint per division, and controversial division analysis. No navigation or routing has been designed for it yet.
Why it matters: The answer affects where the entry point lives in the bottom nav (new tab vs sub-navigation inside an existing tab) and how deep the drill-down goes.

---

## Should the Leaderboard (Phase 6f) be a standalone page or a section of the Judging DNA view?
Context: Phase 6f is fully deferred. `leaderboard_eligible` is a GENERATED ALWAYS column in `user_fight_scorecard_state` and the DB infrastructure exists. No frontend has been built.
Why it matters: A standalone page needs a nav entry point. Embedding in Judging DNA keeps it contextual but may clutter the view. The answer also affects what columns to surface (overall accuracy, by class, streak, etc.).

---

## Is there a reliable way to automate the post-event scraper trigger?
Context: The master scraper and judge scraper are both fully manual. A pg_cron-style scheduler for the Python pipeline doesn't exist. Options considered but not acted on: GitHub Actions on a schedule, a Vercel cron job, or a simple Windows Task Scheduler entry.
Why it matters: Missing an event means the data is stale for days. The scrapers take 30–90 min (master) + 2–3 hrs (judge), so ideally they'd start automatically on event night.
