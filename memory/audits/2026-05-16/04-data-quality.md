# Data Quality — 2026-05-16

---

## §1 End-to-end sample of 20 random completed fights

| Result | Count |
|---|---|
| Has `fight_meta_details` | 20/20 ✅ |
| Has `round_fight_stats` (≥6 rows for 3-rounders, ≥2 for finishes) | 20/20 ✅ |
| Decisions with `judge_scores` (±1 day window) | 5/10 — older fights (pre-2014) genuinely missing mmadecisions data |
| `fights.bout` vs `fight_meta_details.bout` reversed | 5/20 — handled by `fight_url` join, no symptom |
| `winner` populated | 20/20 ✅ in this sample |

Full bout-reversal census across all 8685 joined rows:
```
same_order  reversed  neither
   5633       3052       1
```

The one "neither" bout is fight 8754 (UFC 327: Patricio Freire vs Aaron Pico) — the fmd row stored it as "Patricio Pitbull vs Aaron Pico" (alias mismatch). The Phase 2 alias-aware fallback in `master file for data update.py` is the prevention for new cases. See §4 below for the rfs side-effect.

---

## §2 P1 — 3 completed decision fights have NULL `fights.winner`

```
id    event                                bout                                    method                method_details
8761  UFC 327: Prochazka vs Ulberg         Chris Padilla vs MarQuel Mederos        Decision - Majority   (blank)
8281  UFC 323: Dvalishvili vs Yan 2        Jan Blachowicz vs Bogdan Guskov         Decision - Majority   Junichiro Kamijo: 29., Chris Lee: 28., Ron McCarthy: 28.
8269  UFC Fight Night: Royval vs Kape      Kennedy Nzechukwu vs Marcus Buchecha    Decision - Unanimous  Mike Bell: 28., Ron McCarthy: 28., Tony Weeks: 28.
```

The other two NULL-winner fights are legitimate (`method = 'Could Not Continue'` — id 8344 Aspinall vs Gane, id 8418 Reese vs Dumas).

**Evidence query:**
```sql
SELECT f.id, f.event_name, f.bout, fmd.method, fmd.method_details
FROM fights f LEFT JOIN fight_meta_details fmd ON fmd.fight_url = f.fight_url
WHERE f.status='completed' AND (f.winner IS NULL OR f.winner='')
  AND fmd.method ILIKE 'Decision%';
```

**Impact:** `get_leaderboard()` excludes fights with NULL winner from its `correct_picks` count, so users who scored these 3 fights get fight_acc denominator without numerator credit. Frontend "Result banner" can't render a green/red dot.

**Root cause hypothesis:** Phase 3 (`sync_meta`) parses the per-fight detail page and writes `winner` to BOTH `fights` and `fight_meta_details`. The fmd row has correct `method_details` showing the judges' scorecards. Either:
- `winner` parsing failed silently when the fight URL was first ingested (HTML structure variant on certain fights), and the row never got rescraped.
- The scraper writes `winner` only when the row is created, never on update.

**Suggested fix (not deployed):**
- Backfill these 3 rows manually: `UPDATE fights SET winner = '<name>' WHERE id IN (8281, 8269, 8761);`
- Audit Phase 3 to handle the "majority decision blank method_details" case.

---

## §3 P1 — 270 recent `round_fight_stats` rows have NULL `fight_url`

Covered in detail in `02-schema.md §3`. Restated here as a data quality issue:

```
event_name                                      null_url_rows
UFC Fight Night: Sterling vs Zalal              76
UFC 328: Chimaev vs Strickland                  74
UFC Fight Night: Della Maddalena vs Prates      60
UFC Fight Night: Burns vs Malott                54
UFC 327: Prochazka vs Ulberg                     6
```

All post-April-migration events. Scraper Phase 4 insert isn't populating fight_url. Backfill SQL provided in 02-schema.md.

---

## §4 P1 — Duplicate `round_fight_stats` rows for fight 8754

```
event_name                       bout                              rows  rounds
UFC 327: Prochazka vs Ulberg     Patricio Freire vs Aaron Pico     6     1-3
UFC 327: Prochazka vs Ulberg     Patricio Pitbull vs Aaron Pico    6     1-3
```

**Both sets exist** for the same fight, under different bout text (alias). The unique constraint `(event_name, bout, round, fighter_name)` allows this because `bout` differs (and `fighter_name` is "Patricio Freire" in one set, "Patricio Pitbull" in the other).

**Symptom in production:**
- `fight_dna_metrics` aggregates by `(event_name, bout)` then joins to `fights.bout = "Patricio Freire vs Aaron Pico"` — only the "Freire" set is picked up. So the view returns correct (single) stats for fight 8754. Live UI is fine.
- However, any analytics query that aggregates `round_fight_stats` without filtering by `bout` (e.g., per-fighter aggregations) **double-counts this fight's strikes for Pico** and once each for Freire and Pitbull as if they're different fighters. The fighter-name-based scoring model features would also see Pitbull as a separate fighter from Freire.

**Suggested fix (not deployed):**
- Decide which name is canonical (most recent ufcstats spelling is "Patricio Pitbull").
- Delete the 6 rows under the other name: `DELETE FROM round_fight_stats WHERE event_name='UFC 327: Prochazka vs Ulberg' AND bout='Patricio Freire vs Aaron Pico';`
- This also clears the orphan_rfs count back to 0.

**Also:** Update `fights.bout` and `fight_meta_details.bout` for id 8754 to match the canonical name, so the bout-reversal census drops from "1 neither" to "0 neither".

---

## §5 Decision fights missing judge_scores

390 decision fights (out of ~3300 total decisions in DB) have no `judge_scores` row within ±1 day of the event date.

**Breakdown by year:**
```
1995-2005:  ~118 missing  (mmadecisions doesn't track this era reliably)
2006-2010:  ~175 missing  (intermittent coverage)
2011-2014:  ~95 missing   (older events on Asia/international cards)
2015+:      0 missing
```

Matches the documented state in `context/scrapers.md`:
> Data state (as of Phase 2 cleanup): 5,412 complete, 55 partial, 678 missing (pre-2010 or mmadecisions genuinely lacks data).

The 390 number reflects "no rows at all" (vs the "missing" 678 which includes partial coverage). All historical, not a new bug.

---

## §6 Orphan-row scans

| Probe | Result | Status |
|---|---|---|
| `round_fight_stats` rows with no matching `fights` row (either bout ordering) | 1 bout-combo (the fight 8754 "Pitbull" alias) | See §4 |
| `user_round_scores.fight_id` with no matching `fights.id` | 0 | ✅ FK CASCADE working |
| `user_votes.fight_id` with no matching `fights.id` | 0 | ✅ |
| `fight_meta_details` rows with no matching `fights.fight_url` | 0 | ✅ |
| `fights.fight_url` duplicates | 0 | ✅ UNIQUE constraint holds |
| `fight_meta_details.weight_class_clean` NULL | 0 | ✅ Phase 3 always populates |
| Completed fights with no `fight_meta_details` | 0 | ✅ |
| Completed fights with no `round_fight_stats` (reverse-aware) | 21 / 8686 = 0.24% | Known small bucket — likely DQ/NC or scraper edge cases |

---

## §7 Areas confirmed clean

- **Convention #1 (always join on `fight_url`)** — the bout-reversal census confirms: 3052 fights have reversed bouts between `fights.bout` and `fmd.bout`. All currently joined via `fight_url`. No symptom in the live app.
- **Convention #7 (bout format `Fighter1 vs Fighter2`, no period after "vs")** — sample of 20 random fights, all bouts conform to format.
- **`weight_class_clean` populated on every fmd row** — 0 NULL.
- **No `user_round_scores` for non-existent fights** — FK CASCADE working as designed.
