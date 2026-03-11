# Combat DNA Reference

Concept, metrics, formulas, and frontend key mapping.
Update this file if new DNA metrics are added or the view formula changes.

---

## Concept

DNA metrics describe a fight's character without hardcoded categories. They power fight identity fingerprints and personalised recommendations via a user's average DNA across rated fights (`dataService.getCombatDNA()`).

All metrics are pre-calculated in the `fight_dna_metrics` **view** (computed live — not a table). Frontend always reads from this view, not raw stats tables.

---

## Metric Reference

| DB column | Frontend key | Formula |
|---|---|---|
| `metric_pace` | `strikePace` | sig_strikes_attempted / fight_duration_min |
| `metric_violence` | `violenceIndex` | (total_KD + total_sub_att) / fight_duration_min |
| `metric_intensity` | `intensityScore` | (ground_att + clinch_att + sub_att×5 + reversals×5) / (ctrl_min + 2) |
| `metric_control` | `engagementStyle` | control_time_sec / total_fight_time_sec × 100 |
| `metric_finish` | `finishRate` | 100 if KO/TKO/Sub, else 0 |
| `metric_duration` | `avgFightTime` | total fight time in minutes |
| `raw_head_strikes` | `totalHeadStrikes` | sum(sig_strikes_head_attempted) |
| `raw_body_strikes` | `totalBodyStrikes` | sum(sig_strikes_body_attempted) |
| `raw_leg_strikes` | `totalLegStrikes` | sum(sig_strikes_leg_attempted) |

---

## Body Map Keys (CombatDNAVisual.js)

Uses average-per-fight keys (not totals):
- `avgHeadStrikes`
- `avgBodyStrikes`
- `avgLegStrikes`

---

## Radar Chart

- Background polygon from `ufc_baselines` view (league averages)
- Fighter/fight DNA overlaid on top
- `dataService.getCombatDNA()` — computes user's average DNA across all liked fights

---

## Recommendations

`getRecommendations(userId, combatDNA)` — both args required; maps to all 7 RPC params of `get_fight_recommendations`.

See [rpc-functions.md](rpc-functions.md) for full RPC signature.
