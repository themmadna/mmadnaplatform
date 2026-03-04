"""
compare_models.py — Phase 3c extension

Compares Neural Network (MLP) and Ensemble methods against the LR/RF/XGB baseline.

Models:
  Baselines   — Logistic Regression, Random Forest, XGBoost
  Neural nets — MLP (32,), (64,32), (128,64,32), (256,128,64) architectures
  Ensembles   — Soft Voting (LR+RF+XGB), Stacking (LR+RF+XGB → LR meta)

All models use identical 19 differential features + symmetric augmentation.

Usage:
  python compare_models.py
  python compare_models.py --no-xgb   # skip XGBoost if not installed
"""

import sys
import csv
import math
import time
import argparse
from pathlib import Path
from collections import defaultdict

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

try:
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from sklearn.ensemble import (RandomForestClassifier, VotingClassifier,
                                  StackingClassifier, GradientBoostingClassifier)
    from sklearn.neural_network import MLPClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.metrics import accuracy_score, log_loss, brier_score_loss
    from sklearn.calibration import CalibratedClassifierCV
except ImportError:
    print("[ERROR] pip install scikit-learn numpy")
    sys.exit(1)

try:
    from xgboost import XGBClassifier
    HAS_XGB = True
except ImportError:
    HAS_XGB = False

# ---------------------------------------------------------------------------
# Feature engineering constants (must stay in sync with train_scoring_model.py)
# ---------------------------------------------------------------------------

DIFF_COLS = [
    'kd', 'sig_landed', 'sig_pct', 'head_landed', 'body_landed', 'leg_landed',
    'dist_landed', 'clinch_landed', 'ground_landed',
    'td_landed', 'td_pct', 'ctrl_sec', 'sub_attempts',
]
RATIO_COLS = ['sig_landed', 'head_landed', 'td_landed', 'ctrl_sec', 'ground_landed']

TRAIN_FROM = 2013
TRAIN_UNTIL = 2023
HOLDOUT_FROM = 2024

# ---------------------------------------------------------------------------
# Data helpers
# ---------------------------------------------------------------------------

def safe_float(v, default=0.0):
    try:
        f = float(v)
        return f if math.isfinite(f) else default
    except (TypeError, ValueError):
        return default

def compute_features(row):
    diffs  = [safe_float(row.get(f'f1_{c}')) - safe_float(row.get(f'f2_{c}'))
              for c in DIFF_COLS]
    ratios = [safe_float(row.get(f'f1_{c}')) /
              (safe_float(row.get(f'f1_{c}')) + safe_float(row.get(f'f2_{c}')) + 1.0)
              for c in RATIO_COLS]
    post_2016 = 1.0 if (row.get('event_date', '') >= '2016-01-01') else 0.0
    winner = row.get('judge_winner', '')
    label  = 1 if winner == 'f1' else (0 if winner == 'f2' else None)
    return diffs + ratios + [post_2016], label

def load_split(csv_path):
    X_tr, y_tr, X_ho, y_ho = [], [], [], []
    with open(csv_path, encoding='utf-8') as f:
        for row in csv.DictReader(f):
            d = row.get('event_date', '')
            if not d:
                continue
            yr = int(d[:4])
            feats, label = compute_features(row)
            if label is None:
                continue
            if TRAIN_FROM <= yr <= TRAIN_UNTIL:
                X_tr.append(feats); y_tr.append(label)
            elif yr >= HOLDOUT_FROM:
                X_ho.append(feats); y_ho.append(label)
    return X_tr, y_tr, X_ho, y_ho

def augment(X, y):
    n_diff  = len(DIFF_COLS)
    n_ratio = len(RATIO_COLS)
    Xm = [[-f for f in r[:n_diff]] + [1 - v for v in r[n_diff:n_diff+n_ratio]] + [r[-1]]
          for r in X]
    return X + Xm, y + [1 - lbl for lbl in y]

# ---------------------------------------------------------------------------
# Metrics
# ---------------------------------------------------------------------------

def evaluate(model, X_np, y):
    y_pred = model.predict(X_np)
    acc = accuracy_score(y, y_pred)
    try:
        proba = model.predict_proba(X_np)
        ll  = log_loss(y, proba)
        bs  = brier_score_loss(y, proba[:, 1])
    except Exception:
        ll, bs = float('nan'), float('nan')
    return acc, ll, bs

def section(t):
    print(); print("=" * 72); print(f"  {t}"); print("=" * 72)

# ---------------------------------------------------------------------------
# Model definitions
# ---------------------------------------------------------------------------

def build_models(use_xgb):
    lr  = LogisticRegression(C=1.0, max_iter=2000, solver='lbfgs', random_state=42)
    rf  = RandomForestClassifier(n_estimators=300, min_samples_leaf=5,
                                  n_jobs=-1, random_state=42)

    models = {
        'LR (baseline)': lr,
        'Random Forest': rf,
    }

    if use_xgb and HAS_XGB:
        xgb = XGBClassifier(n_estimators=300, max_depth=6, learning_rate=0.05,
                             subsample=0.8, colsample_bytree=0.8,
                             use_label_encoder=False, eval_metric='logloss',
                             random_state=42, verbosity=0)
        models['XGBoost'] = xgb

    # --- Neural networks: four architectures ---
    mlp_configs = {
        'MLP (32,)':          (32,),
        'MLP (64, 32)':       (64, 32),
        'MLP (128, 64, 32)':  (128, 64, 32),
        'MLP (256, 128, 64)': (256, 128, 64),
    }
    for name, layers in mlp_configs.items():
        models[name] = MLPClassifier(
            hidden_layer_sizes=layers,
            activation='relu',
            solver='adam',
            alpha=1e-4,           # L2 regularisation
            batch_size=256,
            learning_rate='adaptive',
            max_iter=500,
            early_stopping=True,
            validation_fraction=0.1,
            n_iter_no_change=20,
            random_state=42,
        )

    # --- Ensemble: Soft Voting ---
    base_lr  = LogisticRegression(C=1.0, max_iter=2000, solver='lbfgs', random_state=42)
    base_rf  = RandomForestClassifier(n_estimators=300, min_samples_leaf=5,
                                       n_jobs=-1, random_state=42)
    if use_xgb and HAS_XGB:
        base_xgb = XGBClassifier(n_estimators=300, max_depth=6, learning_rate=0.05,
                                  subsample=0.8, colsample_bytree=0.8,
                                  use_label_encoder=False, eval_metric='logloss',
                                  random_state=42, verbosity=0)
        voting_estimators = [('lr', base_lr), ('rf', base_rf), ('xgb', base_xgb)]
    else:
        voting_estimators = [('lr', base_lr), ('rf', base_rf)]

    models['Voting (soft, LR+RF+XGB)'] = VotingClassifier(
        estimators=voting_estimators, voting='soft', n_jobs=-1
    )

    # --- Ensemble: Stacking ---
    # Base learners → LR meta-learner (passthrough=False keeps it clean)
    meta_lr = LogisticRegression(C=0.5, max_iter=1000, solver='lbfgs', random_state=42)
    stk_base_lr  = LogisticRegression(C=1.0, max_iter=2000, solver='lbfgs', random_state=42)
    stk_base_rf  = RandomForestClassifier(n_estimators=200, min_samples_leaf=5,
                                           n_jobs=-1, random_state=42)
    if use_xgb and HAS_XGB:
        stk_base_xgb = XGBClassifier(n_estimators=200, max_depth=6, learning_rate=0.05,
                                      subsample=0.8, colsample_bytree=0.8,
                                      use_label_encoder=False, eval_metric='logloss',
                                      random_state=42, verbosity=0)
        stack_estimators = [('lr', stk_base_lr), ('rf', stk_base_rf), ('xgb', stk_base_xgb)]
    else:
        stack_estimators = [('lr', stk_base_lr), ('rf', stk_base_rf)]

    models['Stacking (LR+RF+XGB → LR)'] = StackingClassifier(
        estimators=stack_estimators,
        final_estimator=meta_lr,
        cv=5,
        n_jobs=-1,
    )

    return models

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(csv_path, use_xgb):
    print(f"Loading {csv_path} ...")
    X_tr, y_tr, X_ho, y_ho = load_split(csv_path)
    print(f"Train: {len(X_tr):,} rows  |  Holdout: {len(X_ho):,} rows")

    section("AUGMENTATION")
    X_tr_aug, y_tr_aug = augment(X_tr, y_tr)
    print(f"  Pre-aug:  {len(X_tr):,}  (f1 rate: {sum(y_tr)/len(y_tr)*100:.1f}%)")
    print(f"  Post-aug: {len(X_tr_aug):,}  (f1 rate: {sum(y_tr_aug)/len(y_tr_aug)*100:.1f}%)")

    scaler = StandardScaler()
    X_tr_s = scaler.fit_transform(np.array(X_tr_aug))
    X_ho_s = scaler.transform(np.array(X_ho))
    y_tr_np = np.array(y_tr_aug)
    y_ho_np = np.array(y_ho)

    models = build_models(use_xgb)

    section("TRAINING & EVALUATION  (holdout: 2024-2025)")
    print(f"  {'Model':<35} {'Accuracy':>10} {'LogLoss':>9} {'Brier':>8} {'Time':>8}")
    print(f"  {'-'*35} {'-'*10} {'-'*9} {'-'*8} {'-'*8}")

    results = {}
    for name, model in models.items():
        t0 = time.time()
        try:
            model.fit(X_tr_s, y_tr_np)
            acc, ll, bs = evaluate(model, X_ho_s, y_ho_np)
            elapsed = time.time() - t0
            results[name] = (acc, ll, bs)
            print(f"  {name:<35} {acc*100:>9.2f}% {ll:>9.4f} {bs:>8.4f} {elapsed:>7.1f}s")
        except Exception as e:
            print(f"  {name:<35} ERROR: {e}")

    section("RANKED BY HOLDOUT ACCURACY")
    ranked = sorted(results.items(), key=lambda x: x[1][0], reverse=True)
    print(f"  {'Rank':<5} {'Model':<35} {'Accuracy':>10}  {'vs LR baseline':>15}")
    print(f"  {'-'*5} {'-'*35} {'-'*10}  {'-'*15}")
    lr_acc = results.get('LR (baseline)', (0,))[0]
    for i, (name, (acc, ll, bs)) in enumerate(ranked, 1):
        delta = acc - lr_acc
        delta_str = f"{delta*100:+.2f}pp"
        marker = " ← BEST" if i == 1 else (" ← baseline" if name == 'LR (baseline)' else "")
        print(f"  {i:<5} {name:<35} {acc*100:>9.2f}%  {delta_str:>15}{marker}")

    section("KEY INSIGHT: LOG LOSS COMPARISON")
    print("  Log loss measures calibration of probabilities, not just binary accuracy.")
    print("  Lower = better. Well-calibrated model is more useful for confidence display.")
    print()
    ll_ranked = sorted(results.items(), key=lambda x: x[1][1])
    for name, (acc, ll, bs) in ll_ranked:
        if not math.isnan(ll):
            print(f"  {name:<35}  log_loss={ll:.4f}  brier={bs:.4f}")

    print()
    best_name, (best_acc, _, _) = ranked[0]
    print(f"  Winner: {best_name}  ({best_acc*100:.2f}%)")
    if best_name != 'LR (baseline)':
        gain = (best_acc - lr_acc) * 100
        print(f"  Gain over LR: +{gain:.2f}pp")
        if gain < 0.5:
            print("  Note: <0.5pp gain is within noise. LR remains the practical choice")
            print("  for client-side deployment given its size and interpretability.")
    print()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Compare ML models for UFC round scoring.')
    parser.add_argument('--csv', default='ml_dataset.csv')
    parser.add_argument('--no-xgb', action='store_true')
    args = parser.parse_args()
    run(Path(__file__).parent / args.csv, use_xgb=not args.no_xgb)
