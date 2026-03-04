"""
eda_report.py — Phase 3c, Step 2

Exploratory data analysis on ml_dataset.csv.

Answers:
  1. Class balance — how often does each fighter win? draw rate?
  2. 10-8 round frequency overall and by weight class
  3. Rules-based model accuracy vs naive "more sig strikes wins" baseline
  4. Which raw stats most correlate with the judge's decision (point-biserial r)
  5. Round winner distribution by round number (does round 1 vs 3 differ?)
  6. Judge agreement rate — how often do all 3 judges agree on a round winner?
  7. Post-2016 criteria shift — did it measurably change model accuracy?

Usage:
  python eda_report.py
  python eda_report.py --csv path/to/ml_dataset.csv
"""

import sys
import csv
import math
import argparse
from collections import defaultdict, Counter
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def safe_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None

def mean(vals):
    v = [x for x in vals if x is not None]
    return sum(v) / len(v) if v else None

def stdev(vals):
    v = [x for x in vals if x is not None]
    if len(v) < 2:
        return None
    m = sum(v) / len(v)
    return math.sqrt(sum((x - m) ** 2 for x in v) / (len(v) - 1))

def point_biserial_r(binary_labels, continuous_vals):
    """
    Point-biserial correlation between a binary outcome and a continuous variable.
    Measures how well a stat differentiates round winners from round losers.
    Returns r in [-1, 1]; |r| > 0.1 is meaningful for sports data.
    """
    pairs = [(b, c) for b, c in zip(binary_labels, continuous_vals)
             if b is not None and c is not None]
    if len(pairs) < 10:
        return None
    n = len(pairs)
    n1 = sum(1 for b, _ in pairs if b == 1)
    n0 = n - n1
    if n1 == 0 or n0 == 0:
        return None
    m1 = mean([c for b, c in pairs if b == 1])
    m0 = mean([c for b, c in pairs if b == 0])
    sd = stdev([c for _, c in pairs])
    if not sd or sd == 0:
        return None
    return (m1 - m0) / sd * math.sqrt(n1 * n0 / n ** 2)

def pct(n, total):
    return f"{n/total*100:.1f}%" if total else "n/a"

def bar(r, width=30):
    """ASCII bar scaled to ±1."""
    filled = int(abs(r) * width)
    if r >= 0:
        return ' ' * width + '│' + '█' * filled
    else:
        return ' ' * (width - filled) + '█' * filled + '│'

# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

STAT_COLS = [
    'kd', 'sig_landed', 'sig_attempted', 'sig_pct',
    'total_landed', 'total_attempted',
    'td_landed', 'td_attempted', 'td_pct',
    'sub_attempts', 'reversals', 'ctrl_sec',
    'head_landed', 'head_attempted',
    'body_landed', 'body_attempted',
    'leg_landed', 'leg_attempted',
    'dist_landed', 'dist_attempted',
    'clinch_landed', 'clinch_attempted',
    'ground_landed', 'ground_attempted',
]

def load_csv(path):
    rows = []
    with open(path, encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            rows.append(row)
    return rows

# ---------------------------------------------------------------------------
# Analysis functions
# ---------------------------------------------------------------------------

def section(title):
    print()
    print("=" * 70)
    print(f"  {title}")
    print("=" * 70)

def class_balance(rows):
    section("1. CLASS BALANCE")
    winners = Counter(r['judge_winner'] for r in rows if r['judge_winner'])
    total = sum(winners.values())
    print(f"  Total labelled rows: {total:,}")
    print()
    for label in ('f1', 'f2', 'draw'):
        n = winners.get(label, 0)
        print(f"  {label:>4}:  {n:>6,}  ({pct(n, total)})")

    # Also split by post/pre 2016
    print()
    print("  By era:")
    for era, label in [('pre-2016', False), ('post-2016', True)]:
        era_rows = [r for r in rows if r['judge_winner'] and
                    (r.get('event_date', '') >= '2016-01-01') == label]
        if not era_rows:
            continue
        era_total = len(era_rows)
        f1_n = sum(1 for r in era_rows if r['judge_winner'] == 'f1')
        f2_n = sum(1 for r in era_rows if r['judge_winner'] == 'f2')
        draw_n = sum(1 for r in era_rows if r['judge_winner'] == 'draw')
        print(f"  {era} (n={era_total:,}):  "
              f"f1={pct(f1_n,era_total)}  f2={pct(f2_n,era_total)}  draw={pct(draw_n,era_total)}")

def ten_eight_analysis(rows):
    section("2. 10-8 ROUND FREQUENCY")
    labelled = [r for r in rows if r['judge_winner'] and r['judge_winner'] != 'draw']
    total = len(labelled)
    ten_eights = sum(1 for r in labelled if r.get('is_10_8') == '1')
    print(f"  10-8 rounds: {ten_eights:,} / {total:,}  ({pct(ten_eights, total)})")
    print()

    # By weight class
    wc_counts = defaultdict(lambda: [0, 0])  # [10-8 count, total]
    for r in labelled:
        wc = r.get('weight_class') or 'Unknown'
        wc_counts[wc][1] += 1
        if r.get('is_10_8') == '1':
            wc_counts[wc][0] += 1

    wc_rates = [(wc, c[0], c[1], c[0]/c[1]*100) for wc, c in wc_counts.items() if c[1] >= 50]
    wc_rates.sort(key=lambda x: x[3], reverse=True)
    print(f"  {'Weight Class':<35} {'10-8':>6} {'Total':>7} {'Rate':>6}")
    print(f"  {'-'*35} {'-'*6} {'-'*7} {'-'*6}")
    for wc, t8, tot, rate in wc_rates:
        print(f"  {wc:<35} {t8:>6,} {tot:>7,} {rate:>5.1f}%")

def baseline_comparison(rows):
    section("3. BASELINE MODEL COMPARISON")
    # Only non-draw rounds where we have a clear judge winner
    evaluable = [r for r in rows if r['judge_winner'] in ('f1', 'f2')]
    total = len(evaluable)
    print(f"  Evaluable rounds (excluding draws): {total:,}")
    print()

    # Rules-based model
    rules_agree = sum(1 for r in evaluable if r.get('rules_agrees') == '1')
    print(f"  Rules-based model:               {rules_agree:,}/{total:,}  ({pct(rules_agree, total)})")

    # Naive baseline: whoever landed more sig strikes wins
    naive_correct = 0
    naive_total = 0
    for r in evaluable:
        f1_sig = safe_float(r.get('f1_sig_landed')) or 0
        f2_sig = safe_float(r.get('f2_sig_landed')) or 0
        if f1_sig == f2_sig:
            continue  # skip ties in naive baseline
        naive_winner = 'f1' if f1_sig > f2_sig else 'f2'
        naive_total += 1
        if naive_winner == r['judge_winner']:
            naive_correct += 1
    print(f"  Naive (more sig strikes wins):   {naive_correct:,}/{naive_total:,}  ({pct(naive_correct, naive_total)})")

    # Naive total strikes
    naive2_correct = 0
    naive2_total = 0
    for r in evaluable:
        f1_tot = safe_float(r.get('f1_total_landed')) or 0
        f2_tot = safe_float(r.get('f2_total_landed')) or 0
        if f1_tot == f2_tot:
            continue
        n2w = 'f1' if f1_tot > f2_tot else 'f2'
        naive2_total += 1
        if n2w == r['judge_winner']:
            naive2_correct += 1
    print(f"  Naive (more total strikes wins): {naive2_correct:,}/{naive2_total:,}  ({pct(naive2_correct, naive2_total)})")

    # Breakdown by era
    print()
    print("  Rules-based by era:")
    for era_label, cutoff, direction in [
        ('pre-2016',  '2016-01-01', False),
        ('post-2016', '2016-01-01', True),
    ]:
        era = [r for r in evaluable
               if (r.get('event_date','') >= cutoff) == direction]
        if not era: continue
        era_agree = sum(1 for r in era if r.get('rules_agrees') == '1')
        print(f"    {era_label} (n={len(era):,}): {pct(era_agree, len(era))}")

def feature_correlations(rows):
    section("4. FEATURE CORRELATIONS WITH ROUND OUTCOME")
    print("  Point-biserial r: differential stat (f1-f2) vs judge winner (1=f1, 0=f2)")
    print("  Excludes draw rounds. |r| > 0.10 = meaningful signal.")
    print()

    # Only non-draw rounds
    evaluable = [r for r in rows if r['judge_winner'] in ('f1', 'f2')]
    labels = [1 if r['judge_winner'] == 'f1' else 0 for r in evaluable]

    results = []
    for col in STAT_COLS:
        f1_col = f'f1_{col}'
        f2_col = f'f2_{col}'
        diffs = []
        for r in evaluable:
            f1 = safe_float(r.get(f1_col))
            f2 = safe_float(r.get(f2_col))
            if f1 is not None and f2 is not None:
                diffs.append(f1 - f2)
            else:
                diffs.append(None)
        r_val = point_biserial_r(labels, diffs)
        if r_val is not None:
            results.append((col, r_val))

    results.sort(key=lambda x: abs(x[1]), reverse=True)

    print(f"  {'Feature (diff)':<28}  {'r':>7}  {'Direction'}")
    print(f"  {'-'*28}  {'-'*7}  {'-'*40}")
    for col, r_val in results:
        direction = 'f1 wins when positive ↑' if r_val > 0 else 'f2 wins when positive ↑'
        strength = '***' if abs(r_val) > 0.3 else ('**' if abs(r_val) > 0.2 else ('*' if abs(r_val) > 0.1 else '  '))
        print(f"  {col:<28}  {r_val:>+.4f}  {strength}  {bar(r_val, 20)}")

    print()
    print("  Significance: *** >0.30  ** >0.20  * >0.10")

def round_number_analysis(rows):
    section("5. ROUND WINNER DISTRIBUTION BY ROUND NUMBER")
    evaluable = [r for r in rows if r['judge_winner'] in ('f1', 'f2')]

    by_round = defaultdict(lambda: Counter())
    for r in evaluable:
        rnum = r.get('round', '?')
        by_round[rnum][r['judge_winner']] += 1

    print(f"  {'Round':<8} {'f1 wins':>8} {'f2 wins':>8} {'Total':>8} {'f1%':>7} {'Draw%':>7}")
    print(f"  {'-'*8} {'-'*8} {'-'*8} {'-'*8} {'-'*7} {'-'*7}")

    # Also include draws in totals
    by_round_full = defaultdict(lambda: Counter())
    for r in rows:
        if r['judge_winner']:
            by_round_full[r.get('round', '?')][r['judge_winner']] += 1

    for rnum in sorted(by_round.keys(), key=lambda x: int(x) if str(x).isdigit() else 99):
        c = by_round[rnum]
        cf = by_round_full[rnum]
        f1n, f2n = c['f1'], c['f2']
        draws = cf.get('draw', 0)
        tot_with_draws = f1n + f2n + draws
        tot = f1n + f2n
        print(f"  {rnum:<8} {f1n:>8,} {f2n:>8,} {tot_with_draws:>8,} {pct(f1n, tot):>7} {pct(draws, tot_with_draws):>7}")

def judge_agreement(rows):
    section("6. INTER-JUDGE AGREEMENT")
    # Group by (fight_url, round) -> list of judge_winner values
    fight_round_judges = defaultdict(list)
    for r in rows:
        if r['judge_winner']:
            key = (r.get('fight_url', ''), r.get('round', ''))
            fight_round_judges[key].append(r['judge_winner'])

    total_rounds = 0
    unanimous_rounds = 0
    split_2_1 = 0
    all_disagree = 0  # three different verdicts (rare but possible)

    for key, verdicts in fight_round_judges.items():
        if len(verdicts) < 2:
            continue
        total_rounds += 1
        unique = set(verdicts)
        if len(unique) == 1:
            unanimous_rounds += 1
        elif len(verdicts) == 3 and len(unique) == 2:
            split_2_1 += 1
        elif len(verdicts) == 3 and len(unique) == 3:
            all_disagree += 1

    print(f"  Rounds with 2+ judge scores: {total_rounds:,}")
    print()
    print(f"  Unanimous (all judges agree):   {unanimous_rounds:,}  ({pct(unanimous_rounds, total_rounds)})")
    print(f"  Split 2-1:                      {split_2_1:,}  ({pct(split_2_1, total_rounds)})")
    print(f"  All 3 disagree:                 {all_disagree:,}  ({pct(all_disagree, total_rounds)})")
    print()
    print("  Note: ML model predicts per-judge, not majority. Split rounds are")
    print("  the hardest cases — exactly where the model adds most value.")

def era_shift(rows):
    section("7. POST-2016 CRITERIA SHIFT — STAT DISTRIBUTION CHANGE")
    print("  Do judges weigh stats differently post-2016?")
    print("  Comparing avg stats in rounds where f1 wins vs f2 wins, pre/post 2016.")
    print()

    focus_stats = ['sig_landed', 'kd', 'td_landed', 'ctrl_sec', 'sub_attempts', 'ground_landed']

    for era_label, cutoff, direction in [
        ('Pre-2016',  '2016-01-01', False),
        ('Post-2016', '2016-01-01', True),
    ]:
        era_rows = [r for r in rows
                    if r['judge_winner'] in ('f1', 'f2') and
                    (r.get('event_date','') >= cutoff) == direction]
        if not era_rows:
            continue

        f1_wins = [r for r in era_rows if r['judge_winner'] == 'f1']
        f2_wins = [r for r in era_rows if r['judge_winner'] == 'f2']

        print(f"  {era_label}  (n={len(era_rows):,}  f1_wins={len(f1_wins):,}  f2_wins={len(f2_wins):,})")
        print(f"  {'Stat':<18} {'Avg winner':>12} {'Avg loser':>12} {'Diff':>10}")
        print(f"  {'-'*18} {'-'*12} {'-'*12} {'-'*10}")

        for col in focus_stats:
            winner_vals = [safe_float(r.get(f'f1_{col}')) for r in f1_wins] + \
                          [safe_float(r.get(f'f2_{col}')) for r in f2_wins]
            loser_vals  = [safe_float(r.get(f'f2_{col}')) for r in f1_wins] + \
                          [safe_float(r.get(f'f1_{col}')) for r in f2_wins]
            avg_w = mean(winner_vals)
            avg_l = mean(loser_vals)
            if avg_w is None or avg_l is None:
                continue
            diff = avg_w - avg_l
            print(f"  {col:<18} {avg_w:>12.2f} {avg_l:>12.2f} {diff:>+10.2f}")
        print()

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(csv_path):
    print(f"Loading {csv_path} ...")
    rows = load_csv(csv_path)
    print(f"Loaded {len(rows):,} rows.\n")

    class_balance(rows)
    ten_eight_analysis(rows)
    baseline_comparison(rows)
    feature_correlations(rows)
    round_number_analysis(rows)
    judge_agreement(rows)
    era_shift(rows)

    print()
    print("=" * 70)
    print("  EDA COMPLETE")
    print("=" * 70)
    print()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='EDA on UFC round scoring ML dataset.')
    parser.add_argument('--csv', default='ml_dataset.csv', help='Input CSV path')
    args = parser.parse_args()
    run(Path(__file__).parent / args.csv)
