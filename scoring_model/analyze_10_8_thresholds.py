"""
analyze_10_8_thresholds.py

Analyzes what separates real 10-8 rounds from 10-9 rounds using:
  - ml_dataset.csv  (already has is_10_8 flag per judge-round)
  - scoring_model.json  (LR model for confidence scoring)

Output:
  - KD differential distribution for 10-8 vs 10-9 rounds
  - ML confidence distribution for 10-8 vs 10-9 rounds
  - Precision/recall table at various confidence thresholds
  - Suggested combined rule

Usage:
  python analyze_10_8_thresholds.py
"""

import sys
import csv
import json
import math
from pathlib import Path
from collections import defaultdict, Counter

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

SCRIPT_DIR = Path(__file__).parent
CSV_PATH   = SCRIPT_DIR / 'ml_dataset.csv'
MODEL_PATH = SCRIPT_DIR / 'scoring_model.json'

# ---------------------------------------------------------------------------
# Load model
# ---------------------------------------------------------------------------

with open(MODEL_PATH) as f:
    model = json.load(f)

COEFFICIENTS = model['coefficients']
INTERCEPT    = model['intercept']
SCALER_MEAN  = model['scaler_mean']
SCALER_STD   = model['scaler_std']

def sigmoid(x):
    return 1 / (1 + math.exp(-x))

def compute_confidence(row):
    def g(col):
        v = row.get(col) or '0'
        try:    return float(v)
        except: return 0.0

    f1_kd    = g('f1_kd');           f2_kd    = g('f2_kd')
    f1_sig   = g('f1_sig_landed');   f2_sig   = g('f2_sig_landed')
    f1_spct  = g('f1_sig_pct');      f2_spct  = g('f2_sig_pct')
    f1_head  = g('f1_head_landed');  f2_head  = g('f2_head_landed')
    f1_body  = g('f1_body_landed');  f2_body  = g('f2_body_landed')
    f1_leg   = g('f1_leg_landed');   f2_leg   = g('f2_leg_landed')
    f1_dist  = g('f1_dist_landed');  f2_dist  = g('f2_dist_landed')
    f1_cli   = g('f1_clinch_landed');f2_cli   = g('f2_clinch_landed')
    f1_gnd   = g('f1_ground_landed');f2_gnd   = g('f2_ground_landed')
    f1_td    = g('f1_td_landed');    f2_td    = g('f2_td_landed')
    f1_tpct  = g('f1_td_pct');       f2_tpct  = g('f2_td_pct')
    f1_ctrl  = g('f1_ctrl_sec');     f2_ctrl  = g('f2_ctrl_sec')
    f1_sub   = g('f1_sub_attempts'); f2_sub   = g('f2_sub_attempts')

    post_2016 = 1.0 if (row.get('event_date') or '') >= '2016-01-01' else 0.0

    def ratio(a, b): return a / (a + b + 1)

    features = [
        f1_kd   - f2_kd,
        f1_sig  - f2_sig,
        f1_spct - f2_spct,
        f1_head - f2_head,
        f1_body - f2_body,
        f1_leg  - f2_leg,
        f1_dist - f2_dist,
        f1_cli  - f2_cli,
        f1_gnd  - f2_gnd,
        f1_td   - f2_td,
        f1_tpct - f2_tpct,
        f1_ctrl - f2_ctrl,
        f1_sub  - f2_sub,
        ratio(f1_sig,  f2_sig),
        ratio(f1_head, f2_head),
        ratio(f1_td,   f2_td),
        ratio(f1_ctrl, f2_ctrl),
        ratio(f1_gnd,  f2_gnd),
        post_2016,
    ]

    scaled = [(features[i] - SCALER_MEAN[i]) / SCALER_STD[i] for i in range(len(features))]
    logit  = sum(COEFFICIENTS[i] * scaled[i] for i in range(len(scaled))) + INTERCEPT
    p      = sigmoid(logit)
    return p, max(p, 1 - p)   # (p_f1_wins, confidence)

# ---------------------------------------------------------------------------
# Load CSV — deduplicate by (fight_url, round)
# A round is 10-8 if ANY judge scored it 10-8
# ---------------------------------------------------------------------------

print("[..] Loading ml_dataset.csv ...")

rounds = {}  # (fight_url, round) -> dict

with open(CSV_PATH, newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for row in reader:
        key          = (row['fight_url'], row['round'])
        is_10_8_row  = row.get('is_10_8', '0') == '1'
        judge_winner = row.get('judge_winner', '')

        if key not in rounds:
            rounds[key] = {
                'row':          row,
                'is_10_8':      False,
                'judge_winner': judge_winner,
            }
        if is_10_8_row:
            rounds[key]['is_10_8'] = True

print(f"[OK] {len(rounds):,} unique fight-rounds")

# ---------------------------------------------------------------------------
# Compute KD differential + ML confidence for each round
# ---------------------------------------------------------------------------

records_10_8 = []
records_10_9 = []

for key, info in rounds.items():
    row          = info['row']
    judge_winner = info['judge_winner']

    if judge_winner not in ('f1', 'f2'):
        continue  # skip draws

    p_f1, confidence = compute_confidence(row)

    f1_kd = float(row.get('f1_kd') or 0)
    f2_kd = float(row.get('f2_kd') or 0)

    # KD differential from the judge winner's perspective
    kd_diff = (f1_kd - f2_kd) if judge_winner == 'f1' else (f2_kd - f1_kd)

    rec = {'kd_diff': int(kd_diff), 'confidence': confidence}

    if info['is_10_8']:
        records_10_8.append(rec)
    else:
        records_10_9.append(rec)

n_88 = len(records_10_8)
n_99 = len(records_10_9)

print(f"  10-8 rounds : {n_88:,}")
print(f"  10-9 rounds : {n_99:,}")
print()

# ---------------------------------------------------------------------------
# KD differential distribution
# ---------------------------------------------------------------------------

def kd_distribution(records, label):
    counts = Counter(r['kd_diff'] for r in records)
    total  = len(records)
    print(f"  KD differential (winner KDs - loser KDs) — {label}  n={total:,}")
    print(f"  {'KD diff':>8}  {'Count':>7}  {'%':>6}")
    print(f"  {'--------':>8}  {'-------':>7}  {'------':>6}")
    for kd in sorted(counts):
        pct = counts[kd] / total * 100
        print(f"  {kd:>8}  {counts[kd]:>7}  {pct:>5.1f}%")
    print()

kd_distribution(records_10_8, '10-8 rounds')
kd_distribution(records_10_9, '10-9 rounds')

# ---------------------------------------------------------------------------
# ML confidence distribution (buckets of 0.05)
# ---------------------------------------------------------------------------

def conf_distribution(records, label):
    buckets = defaultdict(int)
    total   = len(records)
    for r in records:
        b = round(r['confidence'] * 20) / 20   # nearest 0.05
        buckets[b] += 1
    print(f"  ML confidence distribution — {label}  n={total:,}")
    print(f"  {'Confidence':>10}  {'Count':>7}  {'%':>6}")
    print(f"  {'----------':>10}  {'-------':>7}  {'------':>6}")
    for b in sorted(buckets):
        pct = buckets[b] / total * 100
        bar = '#' * int(pct / 2)
        print(f"  {b:>10.2f}  {buckets[b]:>7}  {pct:>5.1f}%  {bar}")
    print()

conf_distribution(records_10_8, '10-8 rounds')
conf_distribution(records_10_9, '10-9 rounds')

# ---------------------------------------------------------------------------
# Confidence percentiles
# ---------------------------------------------------------------------------

def percentile_summary(records, label):
    vals = sorted(r['confidence'] for r in records)
    n    = len(vals)
    def p(pct): return vals[int(pct / 100 * n)]
    print(f"  Confidence percentiles — {label}")
    print(f"  p25={p(25):.3f}  p50={p(50):.3f}  p75={p(75):.3f}  p90={p(90):.3f}  p95={p(95):.3f}")
    print()

percentile_summary(records_10_8, '10-8 rounds')
percentile_summary(records_10_9, '10-9 rounds')

# ---------------------------------------------------------------------------
# Precision / recall at various confidence thresholds (confidence-only rule)
# ---------------------------------------------------------------------------

all_records = [(r, True) for r in records_10_8] + [(r, False) for r in records_10_9]
total_pos   = n_88

print("  Confidence-only threshold analysis")
print(f"  {'Threshold':>10}  {'Predicted':>9}  {'TP':>6}  {'Precision':>9}  {'Recall':>7}")
print(f"  {'----------':>10}  {'---------':>9}  {'------':>6}  {'---------':>9}  {'-------':>7}")

for thresh in [0.60, 0.65, 0.70, 0.75, 0.80, 0.85, 0.90, 0.95]:
    predicted  = [r for r, is_8 in all_records if r['confidence'] >= thresh]
    true_pos   = sum(1 for r, is_8 in all_records if r['confidence'] >= thresh and is_8)
    precision  = true_pos / len(predicted) * 100 if predicted else 0
    recall     = true_pos / total_pos * 100 if total_pos else 0
    print(f"  {thresh:>10.2f}  {len(predicted):>9,}  {true_pos:>6,}  {precision:>8.1f}%  {recall:>6.1f}%")

print()

# ---------------------------------------------------------------------------
# Combined rule: KD diff >= X AND confidence >= Y
# ---------------------------------------------------------------------------

print("  Combined rule analysis  (winner KD diff >= threshold AND confidence >= threshold)")
print(f"  {'KD>=':>5}  {'Conf>=':>7}  {'Predicted':>9}  {'TP':>6}  {'Precision':>9}  {'Recall':>7}")
print(f"  {'-----':>5}  {'-------':>7}  {'---------':>9}  {'------':>6}  {'---------':>9}  {'-------':>7}")

for kd_thresh in [1, 2]:
    for conf_thresh in [0.65, 0.70, 0.75, 0.80, 0.85]:
        predicted = [
            (r, is_8) for r, is_8 in all_records
            if r['kd_diff'] >= kd_thresh and r['confidence'] >= conf_thresh
        ]
        true_pos  = sum(1 for r, is_8 in predicted if is_8)
        precision = true_pos / len(predicted) * 100 if predicted else 0
        recall    = true_pos / total_pos * 100 if total_pos else 0
        print(f"  {kd_thresh:>5}  {conf_thresh:>7.2f}  {len(predicted):>9,}  {true_pos:>6,}  {precision:>8.1f}%  {recall:>6.1f}%")
    print()
