"""
validate_scoring_model.py

Measures how well the rules-based scoring model agrees with real UFC judges.

Runs against all fights that have both round_fight_stats and judge_scores in the DB.

Output:
  - Overall round-level agreement rate
  - Agreement rate per judge (which judges align most with the model?)
  - Agreement rate per weight class (where does the model struggle?)

Usage:
  python validate_scoring_model.py
  python validate_scoring_model.py --top 10       # show top/bottom 10 judges by agreement
  python validate_scoring_model.py --weight-class # show weight class breakdown only
"""

import sys
import argparse
from collections import defaultdict
from pathlib import Path
from dotenv import load_dotenv
import os

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

load_dotenv(Path(__file__).parent / '.env')

from supabase import create_client

SUPABASE_URL = os.environ.get('REACT_APP_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[ERROR] Missing REACT_APP_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# --- SCORING MODEL (mirrors FightDetailView.js logic) ---

WEIGHTS = {
    'sig_strikes_landed': 1.0,
    'kd':                 5.0,
    'takedowns_landed':   2.5,
    'control_time_sec':   0.015,
    'sub_attempts':       1.5,
}

def compute_round_score(stats):
    if not stats:
        return 0.0
    return (
        (stats.get('sig_strikes_landed') or 0) * WEIGHTS['sig_strikes_landed'] +
        (stats.get('kd') or 0) * WEIGHTS['kd'] +
        (stats.get('takedowns_landed') or 0) * WEIGHTS['takedowns_landed'] +
        (stats.get('control_time_sec') or 0) * WEIGHTS['control_time_sec'] +
        (stats.get('sub_attempts') or 0) * WEIGHTS['sub_attempts']
    )

def score_round(f1_stats, f2_stats):
    """Returns predicted winner: 'f1', 'f2', or 'draw'."""
    s1 = compute_round_score(f1_stats)
    s2 = compute_round_score(f2_stats)
    if s1 > s2:
        return 'f1'
    elif s2 > s1:
        return 'f2'
    return 'draw'

# --- DATA FETCH ---

def fetch_all_round_stats():
    print("[..] Fetching round_fight_stats...")
    rows = []
    page_size = 1000
    offset = 0
    while True:
        res = supabase.from_('round_fight_stats').select(
            'event_name, bout, fighter_name, round, kd, sig_strikes_landed, '
            'sig_strikes_attempted, takedowns_landed, takedowns_attempted, '
            'sub_attempts, control_time_sec'
        ).range(offset, offset + page_size - 1).execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    print(f"[OK] {len(rows):,} round_fight_stats rows loaded")
    return rows

def fetch_all_judge_scores():
    print("[..] Fetching judge_scores...")
    rows = []
    page_size = 1000
    offset = 0
    while True:
        res = supabase.from_('judge_scores').select(
            'event_name, bout, fighter, judge, round, score'
        ).range(offset, offset + page_size - 1).execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    print(f"[OK] {len(rows):,} judge_scores rows loaded")
    return rows

def fetch_fight_meta():
    """Returns a dict keyed by (event_name, fighter1_name, fighter2_name) -> weight_class."""
    print("[..] Fetching fight_meta_details for weight class lookup...")
    rows = []
    page_size = 1000
    offset = 0
    while True:
        res = supabase.from_('fight_meta_details').select(
            'event_name, fighter1_name, fighter2_name, weight_class'
        ).range(offset, offset + page_size - 1).execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    # Index by (event_name, frozenset of fighter names) -> weight_class
    meta = {}
    for r in rows:
        key = (r['event_name'], frozenset([r['fighter1_name'], r['fighter2_name']]))
        meta[key] = r.get('weight_class') or 'Unknown'
    print(f"[OK] {len(rows):,} fight_meta_details rows loaded")
    return meta

# --- ANALYSIS ---

def run_analysis(args):
    round_stats_rows = fetch_all_round_stats()
    judge_scores_rows = fetch_all_judge_scores()
    meta_map = fetch_fight_meta()

    # Index round_stats by (event_name, fighter_name, round)
    stats_index = {}
    for r in round_stats_rows:
        key = (r['event_name'], r['fighter_name'], r['round'])
        stats_index[key] = r

    # Group judge_scores by (event_name, judge, round) -> {fighter: score}
    # First build a map of which fights each judge scored, to get fighter pairs
    # Group by (event_name, round, judge) -> list of {fighter, score}
    judge_round_index = defaultdict(list)
    for r in judge_scores_rows:
        key = (r['event_name'], r['round'], r['judge'])
        judge_round_index[key].append(r)

    # Counters
    total_rounds = 0
    agree_rounds = 0

    judge_agree  = defaultdict(int)
    judge_total  = defaultdict(int)

    wc_agree  = defaultdict(int)
    wc_total  = defaultdict(int)

    skipped_no_stats = 0
    skipped_incomplete = 0

    # Iterate over each judge's round scores
    seen_keys = set()
    for (event_name, round_num, judge_name), entries in judge_round_index.items():
        if len(entries) < 2:
            skipped_incomplete += 1
            continue

        # Find the two fighters for this round
        fighters = [e['fighter'] for e in entries]
        if len(fighters) != 2:
            skipped_incomplete += 1
            continue

        f1_name, f2_name = fighters[0], fighters[1]
        f1_score = next((e['score'] for e in entries if e['fighter'] == f1_name), None)
        f2_score = next((e['score'] for e in entries if e['fighter'] == f2_name), None)
        if f1_score is None or f2_score is None:
            skipped_incomplete += 1
            continue

        # Judge's winner
        if f1_score > f2_score:
            judge_winner = 'f1'
        elif f2_score > f1_score:
            judge_winner = 'f2'
        else:
            judge_winner = 'draw'

        # Model's winner
        f1_stats = stats_index.get((event_name, f1_name, round_num))
        f2_stats = stats_index.get((event_name, f2_name, round_num))

        if not f1_stats and not f2_stats:
            skipped_no_stats += 1
            continue

        model_winner = score_round(f1_stats, f2_stats)

        # Weight class lookup
        wc_key = (event_name, frozenset([f1_name, f2_name]))
        weight_class = meta_map.get(wc_key, 'Unknown')

        # Record agreement
        agrees = (model_winner == judge_winner)

        total_rounds += 1
        if agrees:
            agree_rounds += 1

        judge_agree[judge_name] += int(agrees)
        judge_total[judge_name] += 1

        wc_agree[weight_class] += int(agrees)
        wc_total[weight_class] += 1

    # --- REPORT ---
    print()
    print("=" * 60)
    print("  SCORING MODEL VALIDATION REPORT")
    print("=" * 60)
    print(f"  Rounds evaluated:       {total_rounds:,}")
    print(f"  Skipped (no stats):     {skipped_no_stats:,}")
    print(f"  Skipped (incomplete):   {skipped_incomplete:,}")
    print()

    if total_rounds == 0:
        print("[WARN] No rounds to evaluate. Check that round_fight_stats and judge_scores overlap.")
        return

    overall_pct = agree_rounds / total_rounds * 100
    print(f"  OVERALL AGREEMENT:  {agree_rounds:,} / {total_rounds:,}  ({overall_pct:.1f}%)")
    print()

    # --- PER-JUDGE ---
    if not args.weight_class_only:
        judge_rates = [
            (name, judge_agree[name], judge_total[name], judge_agree[name] / judge_total[name] * 100)
            for name in judge_total
            if judge_total[name] >= 10  # filter judges with very few rounds
        ]
        judge_rates.sort(key=lambda x: x[3], reverse=True)

        top_n = args.top if args.top else len(judge_rates)
        bottom_n = args.top if args.top else 0

        print(f"  PER-JUDGE AGREEMENT (min 10 rounds, n={len(judge_rates)} judges)")
        print(f"  {'Judge':<35} {'Agree':>6} {'Total':>6} {'Rate':>6}")
        print(f"  {'-'*35} {'-'*6} {'-'*6} {'-'*6}")

        display = judge_rates[:top_n]
        if bottom_n and len(judge_rates) > bottom_n:
            print(f"  -- Top {top_n} --")
            for name, ag, tot, pct in judge_rates[:top_n]:
                print(f"  {name:<35} {ag:>6} {tot:>6} {pct:>5.1f}%")
            print(f"  -- Bottom {bottom_n} --")
            for name, ag, tot, pct in judge_rates[-bottom_n:]:
                print(f"  {name:<35} {ag:>6} {tot:>6} {pct:>5.1f}%")
        else:
            for name, ag, tot, pct in display:
                print(f"  {name:<35} {ag:>6} {tot:>6} {pct:>5.1f}%")
        print()

    # --- PER-WEIGHT-CLASS ---
    wc_rates = [
        (wc, wc_agree[wc], wc_total[wc], wc_agree[wc] / wc_total[wc] * 100)
        for wc in wc_total
    ]
    wc_rates.sort(key=lambda x: x[3], reverse=True)

    print(f"  PER-WEIGHT-CLASS AGREEMENT")
    print(f"  {'Weight Class':<35} {'Agree':>6} {'Total':>6} {'Rate':>6}")
    print(f"  {'-'*35} {'-'*6} {'-'*6} {'-'*6}")
    for wc, ag, tot, pct in wc_rates:
        print(f"  {wc:<35} {ag:>6} {tot:>6} {pct:>5.1f}%")
    print()
    print("=" * 60)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Validate UFC scoring model against judge_scores.')
    parser.add_argument('--top', type=int, default=0,
                        help='Show only top/bottom N judges by agreement rate (default: show all)')
    parser.add_argument('--weight-class-only', action='store_true',
                        help='Skip per-judge breakdown, show only weight class summary')
    args = parser.parse_args()
    run_analysis(args)
