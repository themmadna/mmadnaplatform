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

## What data shape does `round_fight_stats` have for landed vs attempted strikes per zone?
Context: `CombatDNAVisual` body map currently shows strike distribution but the landed vs attempted distinction was flagged as incomplete. The investigation was deferred after Phase 8.
Why it matters: The body map is more useful if it can toggle between landed and attempted. The feasibility depends on whether ufcstats provides per-zone attempted counts (it does for sig strikes overall but zone-level granularity is unclear).

---

## Should Phase 5 (Weight Class Analytics) be its own page or a tab within the existing fight browse view?
Context: Phase 5 is not started. It covers division overview, style trends over time, radar fingerprint per division, and controversial division analysis. No navigation or routing has been designed for it yet.
Why it matters: The answer affects where the entry point lives in the bottom nav (new tab vs sub-navigation inside an existing tab) and how deep the drill-down goes.

