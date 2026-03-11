# ML Round Scoring Model Reference

Model facts, feature list, JS integration, and training pipeline.
Update this file if the model is retrained, features change, or the integration in FightDetailView changes.

---

## Model Summary

- **Winner:** Logistic Regression — 82.50% holdout accuracy
- **Baselines:** rules-based 81.36%, naive sig-strikes 77.45%
- **Training data:** `scoring_model/ml_dataset.csv` — 30,725 rows, 99.1% match rate (3,321/3,352 bouts)
- **Symmetric augmentation:** every row mirrored (negate diffs, flip label) — intercept ≈ 0, model is position-agnostic

---

## Features (19 total)

### Differential features (13) — `f1_stat - f2_stat`
In order: `kd`, `sig_landed`, `sig_pct`, `head_landed`, `body_landed`, `leg_landed`, `dist_landed`, `clinch_landed`, `ground_landed`, `td_landed`, `td_pct`, `ctrl_sec`, `sub_attempts`

### Ratio features (5) — `f1 / (f1 + f2 + 1)`
In order: `sig_landed`, `head_landed`, `td_landed`, `ctrl_sec`, `ground_landed`

### Era flag (1)
`post_2016` — coefficient converges to ≈0; the stats already encode the era shift

---

## Key Insight

`ctrl_sec_diff` is the #1 feature (coef +1.007). Control time is massively underweighted in the rules-based model (weight=0.015 there vs highest coefficient in ML). Judges weight sustained control heavily.

Knockdowns are overweighted in the rules model (weight=5.0); EDA r=0.196 — meaningful but lower than ctrl_sec, head_landed, dist_landed.

---

## Model File

`scoring_model/scoring_model.json` — contains: `features`, `coefficients`, `intercept`, `scaler_mean`, `scaler_std`

---

## JS Integration (`FightDetailView.js`)

Function: `scoreRound(f1Stats, f2Stats, eventYear)`

```js
// Scoring pipeline:
// 1. Build 19-feature vector
// 2. Standardise: (value - scaler_mean[i]) / scaler_std[i]
// 3. dot(coefficients, scaled) + intercept → sigmoid → P(f1 wins)
// 4. winner = P > 0.5 ? 'f1' : 'f2'
// 5. confidence = max(P, 1-P)  // range 0.5–1.0
```

Returns: `{ winner: 'f1'|'f2', confidence }`

### 10-8 threshold
`confidence >= 0.99` — empirically derived. 83.5% of real judge-scored 10-8 rounds had model confidence ≥ 0.975; median was 0.997. Threshold tightened to 0.99 to avoid false 10-8s on dominant-but-not-exceptional rounds.

**KD is a poor signal for 10-8 detection** — 82.9% of real 10-8 rounds had zero KD differential. ML confidence is the correct signal.

### DB column name gotchas
- `sig_strike_pct` (not `sig_strikes_pct`)
- `takedown_pct` (not `takedowns_pct`)
- Both stored as 0-100 percentages, not 0-1

---

## Training Scripts (`scoring_model/`)

| File | Purpose |
|---|---|
| `build_ml_dataset.py` | Cross-source extraction: date ±1 join + 5-strategy fuzzy name match + unicode NFKD normalization → `ml_dataset.csv` |
| `eda_report.py` | EDA — feature correlations, class balance, baseline comparison |
| `train_scoring_model.py` | Steps 3–7: feature engineering, augmentation, training, export |
| `compare_models.py` | NN/ensemble comparison (confirmed LR is best) |
| `ml_dataset.csv` | 30,725 rows — one row per (fight, round, judge). Deduplicate by `(fight_url, round)` when needed (3 rows per round, one per judge). Has `is_10_8` flag. |
| `scoring_model.json` | Exported LR model |

Scripts use `Path(__file__).parent.parent / '.env'` (one level up to `ufc-web-app/`).

---

## Per-Division & Per-Judge Analysis (completed, not deployed)

- General model evaluated per division on holdout — most improved +1-3%
- Struggles: Light Heavyweight -2.6%, Heavyweight -2.3%, UFC Bantamweight Title -5.3%
- Separate per-class training not needed — general model is competitive
- 72 judges with 50+ rounds evaluated; model avg 82.6%
- Most predictable: Patricia Morse Jarman 87.9%, David Lethaby 85.2%
- Least predictable: Jerin Valel 67.8%, Jeff Collins 74.2%, Anthony Maness 75.4%
