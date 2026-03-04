"""
build_ml_dataset.py — Phase 3c, Step 1

Cross-source data extraction for the UFC round-scoring ML model.

Problem: round_fight_stats uses UFCStats event/fighter names; judge_scores uses
mmadecisions event/fighter names. These NEVER match directly. This script bridges
the two sources via:
  1. Date-based event join (judge_scores.date ±1 day → ufc_events.event_date)
  2. Fuzzy fighter name matching (5-strategy, mirrors FightDetailView.js matchesFighter)

Output:
  ml_dataset.csv — one row per (fight, round, judge) with:
    - Raw stat columns for both fighters (f1 = fight_meta_details.fighter1_name)
    - Judge winner label (f1 / f2 / draw)
    - 10-8 flag
    - Rules-based model prediction for baseline comparison
    - Metadata: fight_url, event_date, weight_class, judge

Usage:
  python build_ml_dataset.py
  python build_ml_dataset.py --out path/to/output.csv
  python build_ml_dataset.py --verbose   # print sample failed name matches
"""

import sys
import os
import csv
import re
import unicodedata
import argparse
from collections import defaultdict
from pathlib import Path
from datetime import date, timedelta
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = Path(__file__).parent.parent  # ufc-web-app/
load_dotenv(ROOT / '.env')

from supabase import create_client

SUPABASE_URL = os.environ.get('REACT_APP_SUPABASE_URL')
SUPABASE_KEY = os.environ.get('SUPABASE_SERVICE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[ERROR] Missing REACT_APP_SUPABASE_URL or SUPABASE_SERVICE_KEY in .env")
    sys.exit(1)

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ---------------------------------------------------------------------------
# Stat column mapping: DB column → short CSV name
# ---------------------------------------------------------------------------

STAT_MAP = {
    'kd':                              'kd',
    'sig_strikes_landed':              'sig_landed',
    'sig_strikes_attempted':           'sig_attempted',
    'sig_strike_pct':                  'sig_pct',
    'total_strikes_landed':            'total_landed',
    'total_strikes_attempted':         'total_attempted',
    'takedowns_landed':                'td_landed',
    'takedowns_attempted':             'td_attempted',
    'takedown_pct':                    'td_pct',
    'sub_attempts':                    'sub_attempts',
    'reversals':                       'reversals',
    'control_time_sec':                'ctrl_sec',
    'sig_strikes_head_landed':         'head_landed',
    'sig_strikes_head_attempted':      'head_attempted',
    'sig_strikes_body_landed':         'body_landed',
    'sig_strikes_body_attempted':      'body_attempted',
    'sig_strikes_leg_landed':          'leg_landed',
    'sig_strikes_leg_attempted':       'leg_attempted',
    'sig_strikes_distance_landed':     'dist_landed',
    'sig_strikes_distance_attempted':  'dist_attempted',
    'sig_strikes_clinch_landed':       'clinch_landed',
    'sig_strikes_clinch_attempted':    'clinch_attempted',
    'sig_strikes_ground_landed':       'ground_landed',
    'sig_strikes_ground_attempted':    'ground_attempted',
}

STAT_SHORT = list(STAT_MAP.values())

FIELDNAMES = (
    ['fight_url', 'event_name', 'event_date', 'weight_class', 'round', 'judge', 'f1_name', 'f2_name']
    + [f'f1_{s}' for s in STAT_SHORT]
    + [f'f2_{s}' for s in STAT_SHORT]
    + ['judge_f1_score', 'judge_f2_score', 'judge_winner', 'is_10_8', 'rules_winner', 'rules_agrees']
)

# ---------------------------------------------------------------------------
# Rules-based model (mirrors FightDetailView.js — baseline comparison column)
# ---------------------------------------------------------------------------

RULES_WEIGHTS = {
    'sig_strikes_landed': 1.0,
    'kd':                 5.0,
    'takedowns_landed':   2.5,
    'control_time_sec':   0.015,
    'sub_attempts':       1.5,
}

def _rules_score(stats):
    if not stats:
        return 0.0
    return sum((stats.get(col) or 0) * w for col, w in RULES_WEIGHTS.items())

def rules_winner(f1_stats, f2_stats):
    s1 = _rules_score(f1_stats)
    s2 = _rules_score(f2_stats)
    if s1 > s2: return 'f1'
    if s2 > s1: return 'f2'
    return 'draw'

# ---------------------------------------------------------------------------
# Name matching — exact port of FightDetailView.js matchesFighter (5 strategies)
# ---------------------------------------------------------------------------

def norm_name(name):
    # NFKD decomposition converts accented chars to base + combining mark,
    # then the regex strips the combining marks — so ñ→n, ä→a, ã→a, ō→o, etc.
    s = unicodedata.normalize('NFKD', (name or '').lower())
    s = re.sub(r'[^a-z0-9\s]', '', s)
    return re.sub(r'\s+', ' ', s).strip()

def matches_fighter(a, b):
    na, nb = norm_name(a), norm_name(b)
    if not na or not nb:
        return False
    # 1. Exact
    if na == nb:
        return True
    # 2. Space-collapse ("Rong Zhu" vs "Rongzhu")
    ac, bc = na.replace(' ', ''), nb.replace(' ', '')
    if ac == bc:
        return True
    # 3. Character-sort anagram, len >= 5 ("Zha Yi" vs "Yizha")
    if len(ac) >= 5 and len(ac) == len(bc) and sorted(ac) == sorted(bc):
        return True
    # 4. Same last name, length > 3
    aw, bw = na.split(), nb.split()
    if aw[-1] == bw[-1] and len(aw[-1]) > 3:
        return True
    # 5. All words of shorter name appear in longer (handles Jr., middle names)
    shorter, longer = (aw, bw) if len(aw) <= len(bw) else (bw, aw)
    return all(w in longer for w in shorter if len(w) > 1)

# ---------------------------------------------------------------------------
# Data fetching with pagination
# ---------------------------------------------------------------------------

def fetch_all(table, columns):
    rows, page_size, offset = [], 1000, 0
    while True:
        res = supabase.from_(table).select(columns).range(offset, offset + page_size - 1).execute()
        batch = res.data or []
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows

def load_all_data():
    print("[1/4] Fetching ufc_events ...")
    events = fetch_all('ufc_events', 'event_name, event_date')
    print(f"      {len(events):,} rows")

    print("[2/4] Fetching fight_meta_details ...")
    meta = fetch_all('fight_meta_details', 'fight_url, event_name, fighter1_name, fighter2_name, weight_class')
    print(f"      {len(meta):,} rows")

    print("[3/4] Fetching round_fight_stats ...")
    stat_cols_str = 'event_name, fighter_name, round, ' + ', '.join(STAT_MAP.keys())
    stats = fetch_all('round_fight_stats', stat_cols_str)
    print(f"      {len(stats):,} rows")

    print("[4/4] Fetching judge_scores ...")
    scores = fetch_all('judge_scores', 'date, bout, fighter, judge, round, score')
    print(f"      {len(scores):,} rows")

    return events, meta, stats, scores

# ---------------------------------------------------------------------------
# Index building
# ---------------------------------------------------------------------------

def build_indexes(events, meta, stats, scores):
    # date string -> list of UFCStats event_name (±1 day lookups)
    events_by_date = defaultdict(list)
    event_date_map = {}  # event_name -> event_date string (for CSV output)
    for e in events:
        d = e.get('event_date')
        if d:
            events_by_date[d].append(e['event_name'])
            event_date_map[e['event_name']] = d

    # UFCStats event_name -> list of fight_meta_details rows
    meta_by_event = defaultdict(list)
    for m in meta:
        meta_by_event[m['event_name']].append(m)

    # (event_name, fighter_name, round_num) -> stats row
    stats_index = {}
    for s in stats:
        key = (s['event_name'], s['fighter_name'], s['round'])
        stats_index[key] = s

    # (mmadecisions date_str, bout_str) -> list of judge_score rows
    judge_groups = defaultdict(list)
    for js in scores:
        judge_groups[(js['date'], js['bout'])].append(js)

    return events_by_date, meta_by_event, stats_index, judge_groups, event_date_map

# ---------------------------------------------------------------------------
# Fight matching
# ---------------------------------------------------------------------------

def find_matching_fight(js_fighters, candidate_meta):
    """
    Match 2 mmadecisions fighter names to a fight_meta_details row.
    Returns (meta_row, f1_js_name, f2_js_name) where:
      f1_js_name is the mmadecisions name that maps to meta.fighter1_name
      f2_js_name is the mmadecisions name that maps to meta.fighter2_name
    """
    if len(js_fighters) != 2:
        return None, None, None
    js_a, js_b = js_fighters[0], js_fighters[1]
    for m in candidate_meta:
        m1, m2 = m['fighter1_name'], m['fighter2_name']
        if matches_fighter(js_a, m1) and matches_fighter(js_b, m2):
            return m, js_a, js_b
        if matches_fighter(js_a, m2) and matches_fighter(js_b, m1):
            return m, js_b, js_a  # swap so f1_js -> m1, f2_js -> m2
    return None, None, None

# ---------------------------------------------------------------------------
# CSV row builder
# ---------------------------------------------------------------------------

def stat_val(stats, db_col):
    if stats is None:
        return ''
    v = stats.get(db_col)
    return '' if v is None else v

def build_row(meta_row, round_num, judge_name, f1_stats, f2_stats,
              judge_f1_score, judge_f2_score, event_date):
    row = {
        'fight_url':   meta_row.get('fight_url', ''),
        'event_name':  meta_row.get('event_name', ''),
        'event_date':  event_date,
        'weight_class': meta_row.get('weight_class', ''),
        'round':       round_num,
        'judge':       judge_name,
        'f1_name':     meta_row['fighter1_name'],
        'f2_name':     meta_row['fighter2_name'],
    }
    for db_col, short in STAT_MAP.items():
        row[f'f1_{short}'] = stat_val(f1_stats, db_col)
        row[f'f2_{short}'] = stat_val(f2_stats, db_col)

    row['judge_f1_score'] = judge_f1_score if judge_f1_score is not None else ''
    row['judge_f2_score'] = judge_f2_score if judge_f2_score is not None else ''

    if judge_f1_score is not None and judge_f2_score is not None:
        diff = judge_f1_score - judge_f2_score
        row['judge_winner'] = 'f1' if diff > 0 else ('f2' if diff < 0 else 'draw')
        row['is_10_8']      = 1 if abs(diff) >= 2 else 0
    else:
        row['judge_winner'] = ''
        row['is_10_8']      = ''

    rw = rules_winner(f1_stats, f2_stats)
    row['rules_winner']  = rw
    row['rules_agrees']  = 1 if row['judge_winner'] and rw == row['judge_winner'] else 0

    return row

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def run(out_path, verbose=False):
    events, meta, stats_rows, score_rows = load_all_data()

    print("\n[..] Building indexes ...")
    events_by_date, meta_by_event, stats_index, judge_groups, event_date_map = \
        build_indexes(events, meta, stats_rows, score_rows)

    n_bouts            = len(judge_groups)
    n_no_event         = 0
    n_no_fight         = 0
    n_fight_matched    = 0
    n_rounds_both      = 0
    n_rounds_one_miss  = 0
    n_rounds_both_miss = 0
    n_rows             = 0
    name_miss_examples = []

    print(f"[..] Processing {n_bouts:,} (date, bout) groups ...\n")

    with open(out_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=FIELDNAMES)
        writer.writeheader()

        for (js_date, js_bout), group_rows in judge_groups.items():

            # 1. Resolve UFCStats event via date ±1
            try:
                js_date_obj = date.fromisoformat(str(js_date))
            except Exception:
                n_no_event += 1
                continue

            candidate_event_names = []
            for delta in (-1, 0, 1):
                d = (js_date_obj + timedelta(days=delta)).isoformat()
                candidate_event_names.extend(events_by_date.get(d, []))

            if not candidate_event_names:
                n_no_event += 1
                continue

            # 2. Get distinct fighters from this judge group (should be exactly 2)
            js_fighters = list({r['fighter'] for r in group_rows})
            if len(js_fighters) != 2:
                n_no_fight += 1
                continue

            # 3. Match to a specific fight via fuzzy name matching
            candidate_meta = []
            for ev_name in candidate_event_names:
                candidate_meta.extend(meta_by_event.get(ev_name, []))

            meta_row, f1_js_name, f2_js_name = find_matching_fight(js_fighters, candidate_meta)

            if meta_row is None:
                n_no_fight += 1
                if verbose and len(name_miss_examples) < 20:
                    name_miss_examples.append(
                        f"  {js_date} | {js_bout} | js_fighters={js_fighters}"
                    )
                continue

            n_fight_matched += 1
            event_date = event_date_map.get(meta_row['event_name'], '')

            # 4. Build (round, judge) -> {f1_score, f2_score} from the judge group
            round_judge_scores = defaultdict(lambda: {'f1': None, 'f2': None})
            for r in group_rows:
                perspective = 'f1' if r['fighter'] == f1_js_name else 'f2'
                round_judge_scores[(r['round'], r['judge'])][perspective] = r['score']

            # 5. Look up round stats and emit rows
            for (round_num, judge_name), scores_map in round_judge_scores.items():
                f1_score = scores_map['f1']
                f2_score = scores_map['f2']
                if f1_score is None or f2_score is None:
                    continue  # incomplete judge entry for this round

                f1_stats = stats_index.get((meta_row['event_name'], meta_row['fighter1_name'], round_num))
                f2_stats = stats_index.get((meta_row['event_name'], meta_row['fighter2_name'], round_num))

                if f1_stats and f2_stats:
                    n_rounds_both += 1
                elif f1_stats or f2_stats:
                    # One fighter's stats missing — fill missing with empty dict so diff = stat
                    # This is reasonable: missing usually means 0 activity in DB
                    n_rounds_one_miss += 1
                    if f1_stats is None: f1_stats = {}
                    if f2_stats is None: f2_stats = {}
                else:
                    # No stats at all — can't form features, skip
                    n_rounds_both_miss += 1
                    continue

                writer.writerow(build_row(
                    meta_row, round_num, judge_name,
                    f1_stats, f2_stats, f1_score, f2_score, event_date
                ))
                n_rows += 1

    # ---------------------------------------------------------------------------
    # Quality report
    # ---------------------------------------------------------------------------
    total_rounds = n_rounds_both + n_rounds_one_miss + n_rounds_both_miss
    print("=" * 68)
    print("  DATA EXTRACTION REPORT")
    print("=" * 68)
    print(f"  Unique (date, bout) groups in judge_scores: {n_bouts:,}")
    print(f"  No UFCStats event found (date ±1):          {n_no_event:,}  "
          f"({n_no_event/max(n_bouts,1)*100:.1f}%)")
    print(f"  Event found, fighter match failed:          {n_no_fight:,}  "
          f"({n_no_fight/max(n_bouts,1)*100:.1f}%)")
    print(f"  Matched to a specific fight:                {n_fight_matched:,}  "
          f"({n_fight_matched/max(n_bouts,1)*100:.1f}%)")
    print()
    if total_rounds > 0:
        print(f"  Round-level stats coverage (matched rounds only):")
        print(f"    Both fighters have stats:               {n_rounds_both:,}  "
              f"({n_rounds_both/total_rounds*100:.1f}%)")
        print(f"    One fighter missing (filled empty):     {n_rounds_one_miss:,}  "
              f"({n_rounds_one_miss/total_rounds*100:.1f}%)")
        print(f"    Both missing (skipped):                 {n_rounds_both_miss:,}  "
              f"({n_rounds_both_miss/total_rounds*100:.1f}%)")
    print()
    print(f"  CSV rows written:  {n_rows:,}")
    print(f"  Output:            {out_path}")
    print("=" * 68)

    if verbose and name_miss_examples:
        print("\n  Sample name-match failures (first 20):")
        for ex in name_miss_examples:
            print(ex)

    if n_fight_matched == 0:
        print("\n[WARN] Zero fights matched. Verify that event_date ranges overlap between sources.")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Build ML dataset for UFC round scoring model.')
    parser.add_argument('--out', default='ml_dataset.csv',
                        help='Output CSV path (default: ml_dataset.csv in script directory)')
    parser.add_argument('--verbose', action='store_true',
                        help='Print sample fighter name-match failures')
    args = parser.parse_args()
    run(Path(__file__).parent / args.out, verbose=args.verbose)

