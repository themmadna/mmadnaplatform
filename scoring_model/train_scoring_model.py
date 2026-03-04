"""
train_scoring_model.py — Phase 3c, Steps 3-7

Trains a UFC round-scoring ML model on ml_dataset.csv.

Steps covered:
  3. Feature engineering  — stat differentials (f1-f2) + ratio features + post_2016 flag
  4. Symmetric augmentation — mirrors every row to eliminate f1-position bias
  5. Model training       — Logistic Regression, Random Forest, XGBoost (optional)
  6. Evaluation           — holdout accuracy, year-by-year rolling CV
  7. Per-weight-class     — where does the general model struggle?
  8. Per-judge            — which judges are most/least predictable? (50+ round threshold)
  9. Model export         — scoring_model.json (LR coefficients for client-side JS scoring)

Design principle: the model sees ONLY stat differentials between the two fighters in a
given round. It never sees fighter identity, record, ranking, or position. A model that
uses position (f1 vs f2) would learn "champions win more" — we want "better stats win".

Symmetric augmentation: for every (row), a mirror row is added with all diffs negated
and the label flipped. This forces the training set to be exactly 50/50 and drives the
model intercept to zero, eliminating any residual positional bias.

Requirements:
  pip install scikit-learn numpy
  pip install xgboost   (optional — skipped if not installed)

Usage:
  python train_scoring_model.py
  python train_scoring_model.py --csv ml_dataset.csv --train-until 2023 --no-xgb
"""

import sys
import os
import csv
import json
import math
import argparse
from collections import defaultdict
from pathlib import Path
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# ---------------------------------------------------------------------------
# Library check
# ---------------------------------------------------------------------------
try:
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import accuracy_score
except ImportError:
    print("[ERROR] scikit-learn and numpy are required.")
    print("  Install: pip install scikit-learn numpy")
    sys.exit(1)

try:
    from xgboost import XGBClassifier
    HAS_XGB = True
except ImportError:
    HAS_XGB = False

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

TRAIN_FROM_YEAR = 2013   # inclusive — drops sparse/stale pre-2013 data
TRAIN_UNTIL_YEAR = 2023  # inclusive — 2024-2025 used as holdout
HOLDOUT_FROM_YEAR = 2024

# Differential features: we compute (f1_stat - f2_stat) for each
# Dropped: reversals (r=0.006 in EDA — zero signal)
# Dropped: total_landed/attempted (correlated with sig_landed, adds noise to LR)
# Dropped: sig_attempted (captured by sig_pct)
DIFF_COLS = [
    'kd',
    'sig_landed',
    'sig_pct',
    'head_landed',
    'body_landed',
    'leg_landed',
    'dist_landed',
    'clinch_landed',
    'ground_landed',
    'td_landed',
    'td_pct',
    'ctrl_sec',
    'sub_attempts',
]

# Ratio features: f1_stat / (f1_stat + f2_stat + 1) — bounded [0, 1]
# Captures relative dominance independent of fight pace
RATIO_COLS = ['sig_landed', 'head_landed', 'td_landed', 'ctrl_sec', 'ground_landed']

# All feature names (in order) — used for JSON export and JS integration
FEATURE_NAMES = (
    [f'{c}_diff' for c in DIFF_COLS]
    + [f'{c}_ratio' for c in RATIO_COLS]
    + ['post_2016']
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def safe_float(v, default=0.0):
    try:
        f = float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default

def sigmoid(x):
    return 1.0 / (1.0 + math.exp(-max(-500, min(500, x))))

def section(title):
    print()
    print("=" * 70)
    print(f"  {title}")
    print("=" * 70)

def pct(n, total):
    return f"{n/total*100:.1f}%" if total else "n/a"

# ---------------------------------------------------------------------------
# Step 3: Feature engineering
# ---------------------------------------------------------------------------

def compute_features(row):
    """
    Given a CSV row, compute the full feature vector.
    Returns (features: list[float], label: int|None, meta: dict)
    where label=1 means f1 won, label=0 means f2 won, None means draw/unknown.
    """
    # Stat differentials
    diffs = []
    for col in DIFF_COLS:
        f1 = safe_float(row.get(f'f1_{col}'))
        f2 = safe_float(row.get(f'f2_{col}'))
        diffs.append(f1 - f2)

    # Ratio features
    ratios = []
    for col in RATIO_COLS:
        f1 = safe_float(row.get(f'f1_{col}'))
        f2 = safe_float(row.get(f'f2_{col}'))
        ratios.append(f1 / (f1 + f2 + 1.0))

    # Era flag
    event_date = row.get('event_date', '')
    post_2016 = 1.0 if event_date >= '2016-01-01' else 0.0

    features = diffs + ratios + [post_2016]

    # Label
    winner = row.get('judge_winner', '')
    label = 1 if winner == 'f1' else (0 if winner == 'f2' else None)

    meta = {
        'event_date': event_date,
        'weight_class': row.get('weight_class', 'Unknown') or 'Unknown',
        'judge': row.get('judge', 'Unknown') or 'Unknown',
        'fight_url': row.get('fight_url', ''),
        'round': row.get('round', ''),
        'rules_agrees': row.get('rules_agrees', ''),
    }

    return features, label, meta

# ---------------------------------------------------------------------------
# Step 4: Symmetric augmentation
# ---------------------------------------------------------------------------

def augment(X, y):
    """
    For every row, add a mirrored row:
      - all diff features negated (ratio features: 1 - ratio)
      - post_2016 stays the same
      - label flipped (0 → 1, 1 → 0)

    This forces the training set to be exactly 50/50 and eliminates any
    positional bias (f1-is-champion effect) from the model intercept.
    """
    n_diff = len(DIFF_COLS)
    n_ratio = len(RATIO_COLS)

    X_mirror = []
    y_mirror = []
    for feat, label in zip(X, y):
        mirrored = (
            [-f for f in feat[:n_diff]]           # negate diffs
            + [1.0 - r for r in feat[n_diff:n_diff + n_ratio]]  # flip ratios
            + [feat[-1]]                           # post_2016 unchanged
        )
        X_mirror.append(mirrored)
        y_mirror.append(1 - label)

    X_aug = X + X_mirror
    y_aug = y + y_mirror
    return X_aug, y_aug

# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_data(csv_path):
    print(f"Loading {csv_path} ...")
    rows = []
    with open(csv_path, encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    print(f"Loaded {len(rows):,} rows.\n")
    return rows

def build_dataset(rows, year_from, year_until):
    """Filter rows by year range and compute features. Returns X, y, metas."""
    X, y, metas = [], [], []
    for row in rows:
        d = row.get('event_date', '')
        if not d:
            continue
        year = int(d[:4])
        if year < year_from or year > year_until:
            continue
        feats, label, meta = compute_features(row)
        if label is None:
            continue  # skip draws
        X.append(feats)
        y.append(label)
        metas.append(meta)
    return X, y, metas

# ---------------------------------------------------------------------------
# Evaluation helpers
# ---------------------------------------------------------------------------

def evaluate(model, scaler, X_raw, y_true):
    X_scaled = scaler.transform(np.array(X_raw))
    y_pred = model.predict(X_scaled)
    return accuracy_score(y_true, y_pred)

def evaluate_rules(metas, labels):
    """Rules-based model accuracy using the pre-computed rules_agrees column."""
    agree = sum(1 for m, l in zip(metas, labels) if m['rules_agrees'] == '1')
    return agree / len(labels) if labels else 0.0

# ---------------------------------------------------------------------------
# Training pipeline
# ---------------------------------------------------------------------------

def train_models(X_train_aug, y_train_aug, X_train_scaled, y_train_raw, use_xgb):
    models = {}

    print("  Training Logistic Regression ...")
    lr = LogisticRegression(C=1.0, max_iter=2000, solver='lbfgs', random_state=42)
    lr.fit(X_train_aug, y_train_aug)
    models['Logistic Regression'] = lr

    print("  Training Random Forest ...")
    rf = RandomForestClassifier(n_estimators=300, max_depth=None, min_samples_leaf=5,
                                 n_jobs=-1, random_state=42)
    rf.fit(X_train_aug, y_train_aug)
    models['Random Forest'] = rf

    if use_xgb and HAS_XGB:
        print("  Training XGBoost ...")
        xgb = XGBClassifier(n_estimators=300, max_depth=6, learning_rate=0.05,
                             subsample=0.8, colsample_bytree=0.8,
                             use_label_encoder=False, eval_metric='logloss',
                             random_state=42, verbosity=0)
        xgb.fit(X_train_aug, y_train_aug)
        models['XGBoost'] = xgb
    elif use_xgb and not HAS_XGB:
        print("  [SKIP] XGBoost not installed. Run: pip install xgboost")

    return models

# ---------------------------------------------------------------------------
# Year-by-year rolling cross-validation
# ---------------------------------------------------------------------------

def rolling_cv(rows, scaler, models, use_xgb):
    section("ROLLING YEAR-BY-YEAR CROSS-VALIDATION (train: all prior years, test: that year)")

    test_years = [2019, 2020, 2021, 2022, 2023, 2024, 2025]

    header = f"  {'Year':<6} {'n':>6} {'Rules':>8}"
    for name in models:
        header += f"  {name[:12]:>14}"
    print(header)
    print("  " + "-" * (len(header) - 2))

    for test_year in test_years:
        train_rows = [r for r in rows
                      if r.get('event_date','') and
                      TRAIN_FROM_YEAR <= int(r['event_date'][:4]) < test_year]
        test_rows  = [r for r in rows
                      if r.get('event_date','') and
                      int(r['event_date'][:4]) == test_year]

        if len(train_rows) < 100 or len(test_rows) < 50:
            continue

        X_tr, y_tr, _ = build_dataset(train_rows, TRAIN_FROM_YEAR, test_year - 1)
        X_te, y_te, m_te = build_dataset(test_rows, test_year, test_year)
        if not X_tr or not X_te:
            continue

        X_tr_aug, y_tr_aug = augment(X_tr, y_tr)
        sc = StandardScaler()
        X_tr_s = sc.fit_transform(np.array(X_tr_aug))
        X_te_s = sc.transform(np.array(X_te))

        # Train fresh models for this fold
        lr_fold = LogisticRegression(C=1.0, max_iter=2000, solver='lbfgs', random_state=42)
        lr_fold.fit(X_tr_s, y_tr_aug)

        rules_acc = evaluate_rules(m_te, y_te)
        lr_acc = accuracy_score(y_te, lr_fold.predict(X_te_s))

        line = f"  {test_year:<6} {len(X_te):>6,} {rules_acc*100:>7.1f}%  {lr_acc*100:>13.1f}%"
        print(line)

# ---------------------------------------------------------------------------
# Per-weight-class analysis
# ---------------------------------------------------------------------------

def per_weight_class(X_holdout, y_holdout, metas_holdout, model, scaler):
    section("PER-WEIGHT-CLASS ACCURACY (general model on holdout 2024-2025)")

    # Group by weight class
    wc_data = defaultdict(lambda: {'X': [], 'y': [], 'rules': 0})
    for x, y, m in zip(X_holdout, y_holdout, metas_holdout):
        wc = m['weight_class']
        wc_data[wc]['X'].append(x)
        wc_data[wc]['y'].append(y)
        if m['rules_agrees'] == '1':
            wc_data[wc]['rules'] += 1

    results = []
    for wc, d in wc_data.items():
        n = len(d['y'])
        if n < 30:
            continue
        acc = evaluate(model, scaler, d['X'], d['y'])
        rules_acc = d['rules'] / n
        results.append((wc, n, rules_acc, acc))

    results.sort(key=lambda x: x[3], reverse=True)

    print(f"  {'Weight Class':<40} {'n':>5} {'Rules':>7} {'Model':>7} {'Gain':>6}")
    print(f"  {'-'*40} {'-'*5} {'-'*7} {'-'*7} {'-'*6}")
    for wc, n, rules, model_acc in results:
        gain = model_acc - rules
        gain_str = f"{gain*100:+.1f}%"
        print(f"  {wc:<40} {n:>5,} {rules*100:>6.1f}% {model_acc*100:>6.1f}% {gain_str:>6}")

# ---------------------------------------------------------------------------
# Per-judge analysis
# ---------------------------------------------------------------------------

def per_judge(rows_all, model, scaler):
    section("PER-JUDGE ACCURACY (general model, min 50 rounds, all years)")

    judge_data = defaultdict(lambda: {'X': [], 'y': [], 'rules': 0})
    for row in rows_all:
        feats, label, meta = compute_features(row)
        if label is None:
            continue
        j = meta['judge']
        judge_data[j]['X'].append(feats)
        judge_data[j]['y'].append(label)
        if meta['rules_agrees'] == '1':
            judge_data[j]['rules'] += 1

    results = []
    for judge, d in judge_data.items():
        n = len(d['y'])
        if n < 50:
            continue
        acc = evaluate(model, scaler, d['X'], d['y'])
        rules_acc = d['rules'] / n
        results.append((judge, n, rules_acc, acc))

    results.sort(key=lambda x: x[3], reverse=True)

    print(f"  {'Judge':<35} {'n':>5} {'Rules':>7} {'Model':>7}  {'Predictability'}")
    print(f"  {'-'*35} {'-'*5} {'-'*7} {'-'*7}  {'-'*20}")

    # Show top 15 and bottom 10
    def show(subset, label):
        if label:
            print(f"\n  -- {label} --")
        for judge, n, rules, model_acc in subset:
            tag = 'most predictable' if model_acc >= 0.87 else (
                  'least predictable' if model_acc < 0.80 else '')
            print(f"  {judge:<35} {n:>5,} {rules*100:>6.1f}% {model_acc*100:>6.1f}%  {tag}")

    show(results[:15], f"Top 15 most predictable (n={len(results)} judges ≥50 rounds)")
    show(results[-10:], "Bottom 10 least predictable")

    print(f"\n  Overall model avg across judges: "
          f"{sum(r[3] for r in results)/len(results)*100:.1f}%")

# ---------------------------------------------------------------------------
# Feature importance (LR coefficients)
# ---------------------------------------------------------------------------

def feature_importance(model, scaler):
    section("FEATURE IMPORTANCE (Logistic Regression coefficients, scaled)")
    coefs = model.coef_[0]

    # Scale back to interpretable units: coef * std (effect per 1-std change in diff)
    ranked = sorted(zip(FEATURE_NAMES, coefs), key=lambda x: abs(x[1]), reverse=True)

    print(f"  {'Feature':<30} {'Coef':>9}  Interpretation")
    print(f"  {'-'*30} {'-'*9}  {'-'*40}")
    for name, coef in ranked:
        direction = '→ f1 wins' if coef > 0 else '→ f2 wins'
        bar_len = int(abs(coef) * 8)
        bar = '█' * min(bar_len, 20)
        print(f"  {name:<30} {coef:>+9.4f}  {bar}  {direction}")

    print(f"\n  Intercept: {model.intercept_[0]:+.6f}  "
          f"(≈0 confirms augmentation removed positional bias)")

# ---------------------------------------------------------------------------
# Model export
# ---------------------------------------------------------------------------

def export_model(model, scaler, holdout_acc, rules_acc, naive_acc, n_train, out_path):
    section("MODEL EXPORT")

    payload = {
        "model_type": "logistic_regression",
        "version": "1.0",
        "trained_at": datetime.now().strftime('%Y-%m-%d'),
        "training_years": f"{TRAIN_FROM_YEAR}-{TRAIN_UNTIL_YEAR}",
        "n_training_rows_pre_augmentation": n_train,
        "holdout_years": f"{HOLDOUT_FROM_YEAR}-2025",
        "holdout_accuracy": round(holdout_acc, 6),
        "rules_baseline_accuracy": round(rules_acc, 6),
        "naive_sig_strikes_accuracy": round(naive_acc, 6),
        "features": FEATURE_NAMES,
        "coefficients": [round(float(c), 8) for c in model.coef_[0]],
        "intercept": round(float(model.intercept_[0]), 8),
        "scaler_mean": [round(float(m), 8) for m in scaler.mean_],
        "scaler_std":  [round(float(s), 8) for s in scaler.scale_],
        "notes": {
            "diff_cols_order": DIFF_COLS,
            "ratio_cols_order": RATIO_COLS,
            "symmetric_augmentation": True,
            "draws_excluded_from_training": True,
            "usage": (
                "For each round: compute diffs (f1_stat - f2_stat) and ratios "
                "(f1_stat / (f1_stat + f2_stat + 1)) in the order above, then "
                "post_2016 (1 if event >= 2016-01-01). Standardise with "
                "scaler_mean/scaler_std. Score = dot(coefficients, scaled_features) "
                "+ intercept. P(f1 wins) = sigmoid(score)."
            )
        }
    }

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2)

    print(f"  Exported: {out_path}")
    print(f"  Features:          {len(FEATURE_NAMES)}")
    print(f"  Holdout accuracy:  {holdout_acc*100:.2f}%")
    print(f"  Rules baseline:    {rules_acc*100:.2f}%")
    print(f"  Improvement:       {(holdout_acc - rules_acc)*100:+.2f}pp")

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(csv_path, use_xgb, train_until):
    global TRAIN_UNTIL_YEAR, HOLDOUT_FROM_YEAR
    TRAIN_UNTIL_YEAR = train_until
    HOLDOUT_FROM_YEAR = train_until + 1

    rows_all = load_data(csv_path)

    # -----------------------------------------------------------------------
    # Step 3: Build features
    # -----------------------------------------------------------------------
    section(f"STEP 3: FEATURE ENGINEERING  (train: {TRAIN_FROM_YEAR}-{TRAIN_UNTIL_YEAR}  |  holdout: {HOLDOUT_FROM_YEAR}-2025)")

    X_train, y_train, m_train = build_dataset(rows_all, TRAIN_FROM_YEAR, TRAIN_UNTIL_YEAR)
    X_hold,  y_hold,  m_hold  = build_dataset(rows_all, HOLDOUT_FROM_YEAR, 9999)

    print(f"  Training rows (pre-augmentation):  {len(X_train):,}")
    print(f"  Holdout rows:                      {len(X_hold):,}")
    print(f"  Features per row:                  {len(FEATURE_NAMES)}")
    print(f"  Feature names: {', '.join(FEATURE_NAMES)}")
    print(f"  Draws excluded from both sets (label=None).")

    # -----------------------------------------------------------------------
    # Step 4: Symmetric augmentation
    # -----------------------------------------------------------------------
    section("STEP 4: SYMMETRIC AUGMENTATION")

    X_train_aug, y_train_aug = augment(X_train, y_train)
    f1_rate_before = sum(y_train) / len(y_train) * 100
    f1_rate_after  = sum(y_train_aug) / len(y_train_aug) * 100

    print(f"  Pre-augmentation:  {len(X_train):,} rows  |  f1 win rate: {f1_rate_before:.1f}%")
    print(f"  Post-augmentation: {len(X_train_aug):,} rows  |  f1 win rate: {f1_rate_after:.1f}%")
    print(f"  Holdout NOT augmented (evaluate on real distribution).")

    # Scale (fit on augmented train, apply to holdout)
    scaler = StandardScaler()
    X_train_scaled = scaler.fit_transform(np.array(X_train_aug))
    X_hold_scaled  = scaler.transform(np.array(X_hold))

    # -----------------------------------------------------------------------
    # Step 5: Train models
    # -----------------------------------------------------------------------
    section("STEP 5: MODEL TRAINING")

    models = train_models(X_train_scaled, y_train_aug, X_train_scaled, y_train, use_xgb)

    # -----------------------------------------------------------------------
    # Holdout evaluation — all models
    # -----------------------------------------------------------------------
    section(f"HOLDOUT EVALUATION ({HOLDOUT_FROM_YEAR}-2025, n={len(X_hold):,} rounds)")

    rules_acc_hold = evaluate_rules(m_hold, y_hold)

    # Naive baseline on holdout
    naive_correct = naive_total = 0
    for row in rows_all:
        d = row.get('event_date', '')
        if not d or int(d[:4]) < HOLDOUT_FROM_YEAR:
            continue
        if row.get('judge_winner') not in ('f1', 'f2'):
            continue
        f1_sig = safe_float(row.get('f1_sig_landed'))
        f2_sig = safe_float(row.get('f2_sig_landed'))
        if f1_sig == f2_sig:
            continue
        naive_winner = 'f1' if f1_sig > f2_sig else 'f2'
        naive_total += 1
        if naive_winner == row['judge_winner']:
            naive_correct += 1
    naive_acc = naive_correct / naive_total if naive_total else 0.0

    print(f"  {'Model':<25} {'Accuracy':>10}")
    print(f"  {'-'*25} {'-'*10}")
    print(f"  {'Naive (sig strikes)':<25} {naive_acc*100:>9.2f}%")
    print(f"  {'Rules-based':<25} {rules_acc_hold*100:>9.2f}%")

    best_model = None
    best_acc = 0.0
    best_name = ''
    for name, mdl in models.items():
        acc = evaluate(mdl, scaler, X_hold, y_hold)
        marker = ''
        if acc > best_acc:
            best_acc = acc
            best_model = mdl
            best_name = name
        print(f"  {name:<25} {acc*100:>9.2f}%  {marker}")

    print(f"\n  Best model: {best_name}  ({best_acc*100:.2f}%)")
    improvement = best_acc - rules_acc_hold
    print(f"  Improvement over rules-based: {improvement*100:+.2f}pp")

    # -----------------------------------------------------------------------
    # Step 6: Rolling year-by-year CV
    # -----------------------------------------------------------------------
    rolling_cv(rows_all, scaler, models, use_xgb)

    # -----------------------------------------------------------------------
    # Step 7a: Feature importance (LR)
    # -----------------------------------------------------------------------
    lr_model = models.get('Logistic Regression')
    if lr_model:
        feature_importance(lr_model, scaler)

    # RF feature importances
    rf_model = models.get('Random Forest')
    if rf_model:
        section("RANDOM FOREST FEATURE IMPORTANCES")
        importances = list(zip(FEATURE_NAMES, rf_model.feature_importances_))
        importances.sort(key=lambda x: x[1], reverse=True)
        print(f"  {'Feature':<30} {'Importance':>11}")
        print(f"  {'-'*30} {'-'*11}")
        for name, imp in importances:
            bar = '█' * int(imp * 200)
            print(f"  {name:<30} {imp:>10.4f}  {bar}")

    # -----------------------------------------------------------------------
    # Step 7b: Per-weight-class analysis
    # -----------------------------------------------------------------------
    best_for_wc = lr_model if lr_model else list(models.values())[0]
    per_weight_class(X_hold, y_hold, m_hold, best_for_wc, scaler)

    # -----------------------------------------------------------------------
    # Step 7c: Per-judge analysis
    # -----------------------------------------------------------------------
    per_judge(rows_all, best_for_wc, scaler)

    # -----------------------------------------------------------------------
    # Model export
    # -----------------------------------------------------------------------
    if lr_model:
        out_path = Path(csv_path).parent / 'scoring_model.json'
        export_model(lr_model, scaler, best_acc if best_name == 'Logistic Regression' else
                     evaluate(lr_model, scaler, X_hold, y_hold),
                     rules_acc_hold, naive_acc, len(X_train), out_path)
    else:
        print("\n[WARN] No logistic regression model available for export.")

    section("DONE")
    print(f"  scoring_model.json is ready for Step 8 (app integration).")
    print(f"  Use the coefficients + scaler to score rounds client-side in JS.")
    print()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Train UFC round scoring ML model.')
    parser.add_argument('--csv', default='ml_dataset.csv', help='Input CSV')
    parser.add_argument('--train-until', type=int, default=TRAIN_UNTIL_YEAR,
                        help=f'Last year of training data (default: {TRAIN_UNTIL_YEAR})')
    parser.add_argument('--no-xgb', action='store_true', help='Skip XGBoost even if installed')
    args = parser.parse_args()

    run(
        csv_path=Path(__file__).parent / args.csv,
        use_xgb=not args.no_xgb,
        train_until=args.train_until,
    )
