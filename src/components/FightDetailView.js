import { useState, useEffect } from 'react';
import { ChevronLeft, Brain } from 'lucide-react';
import { dataService } from '../dataService';
import { supabase } from '../supabaseClient';
import RoundScoringPanel from './RoundScoringPanel';
import ScorecardComparison from './ScorecardComparison';
import * as guestStorage from '../guestStorage';

// --- SCORING MODEL (Logistic Regression, 82.50% holdout accuracy) ---
// Feature order and scaler values from scoring_model/scoring_model.json

const MODEL_COEFFICIENTS = [
  0.5984894,   // kd_diff
  0.49823478,  // sig_landed_diff
  -0.04311526, // sig_pct_diff
  0.60252248,  // head_landed_diff
  0.06992616,  // body_landed_diff
  -0.01308783, // leg_landed_diff
  0.3025662,   // dist_landed_diff
  0.18665426,  // clinch_landed_diff
  0.50149266,  // ground_landed_diff
  0.44193818,  // td_landed_diff
  0.13082277,  // td_pct_diff
  1.00686459,  // ctrl_sec_diff  ← #1 feature
  0.44003705,  // sub_attempts_diff
  0.50136414,  // sig_landed_ratio
  0.0610226,   // head_landed_ratio
  -0.28223356, // td_landed_ratio
  -0.04561826, // ctrl_sec_ratio
  0.0333875,   // ground_landed_ratio
  -0.0,        // post_2016
];
const MODEL_INTERCEPT = -0.0;
const SCALER_MEAN = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.5, 0.5, 0.5, 0.5, 0.77731692];
const SCALER_STD  = [0.29094502, 12.68527486, 21.57676883, 10.05561868, 4.61613633, 4.68220269, 9.50068422, 3.8118023, 5.45206403, 1.2199469, 53.55316046, 116.89020126, 0.50086893, 0.1769014, 0.21193544, 0.41433619, 0.40837406, 0.43765438, 0.41604726];

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

function scoreRound(f1Stats, f2Stats, eventYear) {
  // No stats available — skip model
  if (!f1Stats && !f2Stats) return { f1Score: 10, f2Score: 10, winner: 'draw', confidence: null };

  const g = (s, k) => s?.[k] || 0;

  // 13 differential features (f1_stat - f2_stat)
  const diffs = [
    g(f1Stats, 'kd')                         - g(f2Stats, 'kd'),
    g(f1Stats, 'sig_strikes_landed')          - g(f2Stats, 'sig_strikes_landed'),
    g(f1Stats, 'sig_strike_pct')              - g(f2Stats, 'sig_strike_pct'),
    g(f1Stats, 'sig_strikes_head_landed')     - g(f2Stats, 'sig_strikes_head_landed'),
    g(f1Stats, 'sig_strikes_body_landed')     - g(f2Stats, 'sig_strikes_body_landed'),
    g(f1Stats, 'sig_strikes_leg_landed')      - g(f2Stats, 'sig_strikes_leg_landed'),
    g(f1Stats, 'sig_strikes_distance_landed') - g(f2Stats, 'sig_strikes_distance_landed'),
    g(f1Stats, 'sig_strikes_clinch_landed')   - g(f2Stats, 'sig_strikes_clinch_landed'),
    g(f1Stats, 'sig_strikes_ground_landed')   - g(f2Stats, 'sig_strikes_ground_landed'),
    g(f1Stats, 'takedowns_landed')            - g(f2Stats, 'takedowns_landed'),
    g(f1Stats, 'takedown_pct')                - g(f2Stats, 'takedown_pct'),
    g(f1Stats, 'control_time_sec')            - g(f2Stats, 'control_time_sec'),
    g(f1Stats, 'sub_attempts')                - g(f2Stats, 'sub_attempts'),
  ];

  // 5 ratio features: f1 / (f1 + f2 + 1)
  const ratioKeys = [
    'sig_strikes_landed',
    'sig_strikes_head_landed',
    'takedowns_landed',
    'control_time_sec',
    'sig_strikes_ground_landed',
  ];
  const ratios = ratioKeys.map(k => {
    const a = g(f1Stats, k), b = g(f2Stats, k);
    return a / (a + b + 1);
  });

  const post2016 = (eventYear || 0) >= 2016 ? 1 : 0;
  const features = [...diffs, ...ratios, post2016];

  const score = features.reduce((sum, f, i) => {
    const scaled = (f - SCALER_MEAN[i]) / SCALER_STD[i];
    return sum + MODEL_COEFFICIENTS[i] * scaled;
  }, MODEL_INTERCEPT);

  const p = sigmoid(score); // P(f1 wins round)
  const winner = p >= 0.5 ? 'f1' : 'f2';
  const confidence = Math.max(p, 1 - p);

  // 10-8 detection: model confidence >= 0.99 (empirically derived from judge_scores data —
  // 83% of real 10-8 rounds had zero KD advantage, so KD alone is not the signal)
  const is10_8 = confidence >= 0.99;
  const f1Score = winner === 'f1' ? 10 : (is10_8 ? 8 : 9);
  const f2Score = winner === 'f2' ? 10 : (is10_8 ? 8 : 9);

  return { f1Score, f2Score, winner, confidence };
}

// --- DATA JOIN ---

// Normalize fighter names for fuzzy matching across data sources
// Strips punctuation and lowercases so "Lone'er" matches "Loner", etc.
function normName(name) {
  return (name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

function matchesFighter(jsName, metaName) {
  const a = normName(jsName);
  const b = normName(metaName);
  if (!a || !b) return false;
  if (a === b) return true;

  // Handles "Rong Zhu" vs "Rongzhu" — same letters, different spacing
  const aCol = a.replace(/\s/g, '');
  const bCol = b.replace(/\s/g, '');
  if (aCol === bCol) return true;

  // Handles "Zha Yi" vs "Yizha", "Sulangrangbo" vs "Rangbo Sulang" —
  // same characters in different segment order (cross-source Chinese name transliterations)
  if (aCol.length >= 5 && aCol.length === bCol.length) {
    if ([...aCol].sort().join('') === [...bCol].sort().join('')) return true;
  }

  const aWords = a.split(' ');
  const bWords = b.split(' ');

  // Fallback 1: first-name prefix with same last name (handles "Josh Van" vs "Joshua Van",
  // "Alex Perez" vs "Alexander Perez", etc.)
  if (aWords.length >= 2 && bWords.length >= 2) {
    const aLast = aWords.slice(1).join(' ');
    const bLast = bWords.slice(1).join(' ');
    if (aLast === bLast && (aWords[0].startsWith(bWords[0]) || bWords[0].startsWith(aWords[0]))) return true;
  }

  // Fallback 2: same last name (handles nickname/middle-name differences)
  const aLast = aWords[aWords.length - 1];
  const bLast = bWords[bWords.length - 1];
  if (aLast === bLast && aLast.length > 3) return true;

  // Fallback 3: all words of the shorter name appear in the longer (handles Jr., suffixes, middle names)
  const shorter = aWords.length <= bWords.length ? aWords : bWords;
  const longer  = aWords.length <= bWords.length ? bWords : aWords;
  return shorter.filter(w => w.length > 1).every(w => longer.includes(w));
}

// Match an ESPN competition to a bout string using the existing matchesFighter logic
function boutMatchesComp(bout, comp) {
  const parts = (bout || '').split(/ vs /i);
  if (parts.length < 2) return false;
  const compNames = (comp.competitors || []).map(c => c.athlete?.displayName || '');
  return compNames.some(n => matchesFighter(n, parts[0])) && compNames.some(n => matchesFighter(n, parts[1]));
}

function buildRoundData(meta, roundStats, judgeScores, eventYear) {
  const roundsFought = parseInt((meta.round || '').split(' ')[0]) || 0;
  if (roundsFought === 0) return [];

  return Array.from({ length: roundsFought }, (_, i) => {
    const r = i + 1;
    const f1Stats = roundStats.find(s => s.fighter_name === meta.fighter1_name && s.round === r) || null;
    const f2Stats = roundStats.find(s => s.fighter_name === meta.fighter2_name && s.round === r) || null;
    const model = scoreRound(f1Stats, f2Stats, eventYear);

    // Filter judge rows for this round that belong to this fight's fighters
    const roundJudgeRows = judgeScores.filter(js =>
      js.round === r &&
      (matchesFighter(js.fighter, meta.fighter1_name) || matchesFighter(js.fighter, meta.fighter2_name))
    );
    const judgeNames = [...new Set(roundJudgeRows.map(js => js.judge))];
    const judges = judgeNames.map(judgeName => {
      const f1Row = roundJudgeRows.find(js => js.judge === judgeName && matchesFighter(js.fighter, meta.fighter1_name));
      const f2Row = roundJudgeRows.find(js => js.judge === judgeName && matchesFighter(js.fighter, meta.fighter2_name));
      // Require both sides — a judge with only one fighter is a cross-fight name collision
      if (!f1Row || !f2Row) return null;
      const f1Score = f1Row.score;
      const f2Score = f2Row.score;
      const jWinner = f1Score > f2Score ? 'f1' : f2Score > f1Score ? 'f2' : 'draw';
      const matchesModel = jWinner === model.winner;
      return { judgeName, f1Score, f2Score, matchesModel };
    }).filter(Boolean);

    return { round: r, f1Stats, f2Stats, model, judges };
  });
}

// --- HELPER: display control time ---
function fmtControlTime(stats) {
  if (!stats) return '—';
  if (stats.control_time) return stats.control_time;
  const sec = stats.control_time_sec || 0;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// --- COMPONENT ---

const EDGE_FN_URL = `${process.env.REACT_APP_SUPABASE_URL}/functions/v1/record-fight-status`;
const ESPN_SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard';

const FightDetailView = ({ fight, currentTheme, onBack, isGuest = false }) => {
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [error, setError] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');

  // Whether the current user has submitted any scores for this fight
  // Gates the Final Scorecard and Scorecard Comparison reveal
  const [hasUserScores, setHasUserScores] = useState(false);

  useEffect(() => {
    if (fight.status !== 'completed') return;
    if (isGuest) {
      const scores = guestStorage.getFightScores(fight.id);
      if (Object.keys(scores).length > 0) setHasUserScores(true);
      return;
    }
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { count } = await supabase
        .from('user_round_scores')
        .select('id', { count: 'exact', head: true })
        .eq('fight_id', fight.id)
        .eq('user_id', user.id);
      if (count > 0) setHasUserScores(true);
    })();
  }, [fight.id, fight.status, isGuest]);

  // Live fight status — seeded from DB, updated by ESPN polling
  const [fightStartedAt, setFightStartedAt] = useState(fight.fight_started_at || null);
  const [fightEndedAt, setFightEndedAt]     = useState(fight.fight_ended_at   || null);

  // Derived: fight is currently in progress / scoring window is closed
  const isLive   = !!fightStartedAt && !fightEndedAt;
  const isLocked = !!fightEndedAt;

  // ESPN-derived round data — seeded from DB (populated by live polling), persists after ESPN goes dark.
  // scheduledRounds: 3 or 5 from format.regulation.periods — available before fight starts.
  // scorableRounds: rounds that are fully complete and can be scored.
  const [scheduledRounds, setScheduledRounds] = useState(fight.scheduled_rounds || null);
  const [scorableRounds, setScorableRounds]   = useState(() => {
    // Seed from DB whenever rounds_fought is known and valid (> 0)
    if (fight.rounds_fought != null && fight.rounds_fought > 0) {
      return fight.ended_by_decision
        ? fight.rounds_fought
        : Math.max(0, fight.rounds_fought - 1);
    }
    // rounds_fought missing or 0 — fall back to scheduled_rounds (or 3) if fight has ended.
    if (fight.fight_ended_at) {
      return fight.scheduled_rounds || 3;
    }
    return 0;
  });

  // Sync scorableRounds when the fight prop updates after initial mount.
  // Handles the case where fight data loads asynchronously (fight_ended_at / rounds_fought
  // arrive after the component has already mounted with incomplete data).
  useEffect(() => {
    if (scorableRounds > 0) return; // already set, don't override
    if (fight.rounds_fought != null && fight.rounds_fought > 0) {
      const val = fight.ended_by_decision
        ? fight.rounds_fought
        : Math.max(0, fight.rounds_fought - 1);
      setScorableRounds(val);
    } else if (fight.fight_ended_at) {
      setScorableRounds(fight.scheduled_rounds || 3);
    }
  }, [fight.rounds_fought, fight.ended_by_decision, fight.fight_ended_at, fight.scheduled_rounds, scorableRounds]);

  // Poll ESPN every 60s for upcoming fights with a known ESPN competition ID.
  // First client to detect a status change calls the Edge Function, which writes
  // the timestamp to the DB. Subsequent clients read it from the DB on mount.
  useEffect(() => {
    if (fight.status !== 'upcoming' || fightEndedAt) return;

    const dateParam = (fight.event_date || '').replace(/-/g, '');
    if (!dateParam) return;

    let prevStatus = null;
    let stopped = false;

    const callEdgeFn = async (status, extraFields = {}) => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const body = { fight_id: fight.id, ...extraFields };
        if (status) body.status = status;
        await fetch(EDGE_FN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}`, 'apikey': process.env.REACT_APP_SUPABASE_ANON_KEY },
          body: JSON.stringify(body),
        });
      } catch (e) {
        console.warn('[FightPoll] Edge Function call failed:', e);
      }
    };

    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`${ESPN_SCOREBOARD}?dates=${dateParam}`);
        const json = await res.json();
        for (const ev of json.events || []) {
          if (!ev.name?.toUpperCase().includes('UFC')) continue;
          const comp = fight.espn_competition_id
            ? (ev.competitions || []).find(c => String(c.id) === String(fight.espn_competition_id))
            : (ev.competitions || []).find(c => boutMatchesComp(fight.bout, c));
          if (!comp) continue;

          // Persist scheduled rounds on first sight — available even before fight starts.
          // Survives after ESPN goes dark so scoring panel has correct round count.
          const espnScheduled = comp.format?.regulation?.periods || null;
          if (espnScheduled && !scheduledRounds) {
            setScheduledRounds(espnScheduled);
            callEdgeFn(null, { scheduled_rounds: espnScheduled });
          }

          const statusName = comp.status?.type?.name;
          if (statusName === prevStatus) break;
          prevStatus = statusName;
          const period = comp.status?.period || 0;

          if (statusName?.startsWith('STATUS_IN_PROGRESS') || statusName === 'STATUS_END_OF_ROUND') {
            setFightStartedAt(s => s || new Date().toISOString());
            // Unlock completed rounds: between rounds → period rounds done; mid-round → period-1 done
            const newScorable = statusName === 'STATUS_END_OF_ROUND' ? period : Math.max(0, period - 1);
            setScorableRounds(prev => Math.max(prev, newScorable));
            await callEdgeFn('in_progress', espnScheduled ? { scheduled_rounds: espnScheduled } : {});
          } else if (statusName === 'STATUS_FINAL') {
            const now = new Date().toISOString();
            const isDecision = (comp.details || []).some(d => d.type?.id === '22');
            // Guard: ESPN occasionally returns period=0 on STATUS_FINAL.
            // Fall back to last known scorable round count, then scheduledRounds, then 3.
            const finalPeriod = period > 0 ? period : (scorableRounds > 0 ? scorableRounds : (scheduledRounds || 3));
            const finalScorable = isDecision ? finalPeriod : Math.max(0, finalPeriod - 1);
            setScorableRounds(finalScorable);
            setFightStartedAt(s => s || now);
            setFightEndedAt(now);
            stopped = true;
            await callEdgeFn('final', {
              ...(espnScheduled ? { scheduled_rounds: espnScheduled } : {}),
              rounds_fought: finalPeriod,
              ended_by_decision: isDecision,
            });
            // Re-sync from DB after write — ensures scorableRounds reflects what was persisted,
            // so any client that refreshes after this will see the correct panel.
            try {
              const { data: freshFight } = await supabase
                .from('fights')
                .select('rounds_fought, ended_by_decision, scheduled_rounds')
                .eq('id', fight.id)
                .single();
              if (freshFight?.rounds_fought > 0) {
                const synced = freshFight.ended_by_decision
                  ? freshFight.rounds_fought
                  : Math.max(0, freshFight.rounds_fought - 1);
                setScorableRounds(prev => Math.max(prev, synced));
              }
            } catch (e) {
              console.warn('[FightPoll] DB re-sync after FINAL failed:', e);
            }
          }
          break;
        }
      } catch (e) {
        console.warn('[FightPoll] ESPN fetch failed:', e);
      }
    };

    poll(); // immediate first check
    const intervalId = setInterval(poll, 60000);
    return () => { stopped = true; clearInterval(intervalId); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fight.id, fight.status, fight.bout, fight.event_date, fightEndedAt]);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const { meta: m, roundStats, judgeScores } = await dataService.getFightDetail(
          fight.fight_url,
          fight.event_name,
          fight.event_date
        );
        if (!m) return; // meta not yet available — render handles it gracefully
        setMeta(m);
        // Debug: log judge_scores coverage for this fight
        if (judgeScores.length === 0) {
          console.warn(`[FightDetail] No judge_scores rows for date=${fight.event_date} — event may not be in DB yet`);
        } else {
          const jsNames = [...new Set(judgeScores.map(js => js.fighter))];
          console.log(`[FightDetail] judge_scores fighters on ${fight.event_date}:`, jsNames);
          console.log(`[FightDetail] Looking for: "${m.fighter1_name}" / "${m.fighter2_name}"`);
          console.log(`[FightDetail] normName f1="${normName(m.fighter1_name)}" f2="${normName(m.fighter2_name)}"`);
        }
        const eventYear = fight.event_date ? new Date(fight.event_date).getFullYear() : new Date().getFullYear();
        const roundData = buildRoundData(m, roundStats, judgeScores, eventYear);
        setRounds(roundData);
      } catch (err) {
        console.error('FightDetailView load error:', err);
        setError('Failed to load fight details.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [fight.fight_url, fight.event_name, fight.event_date]);

  if (!fight) return null;

  const STATS_ROWS = (rd) => [
    {
      label: 'Sig Strikes',
      f1: rd.f1Stats ? `${rd.f1Stats.sig_strikes_landed}/${rd.f1Stats.sig_strikes_attempted}` : '—',
      f2: rd.f2Stats ? `${rd.f2Stats.sig_strikes_landed}/${rd.f2Stats.sig_strikes_attempted}` : '—',
      f1Raw: rd.f1Stats?.sig_strikes_landed ?? 0,
      f2Raw: rd.f2Stats?.sig_strikes_landed ?? 0,
    },
    {
      label: 'Knockdowns',
      f1: rd.f1Stats?.kd ?? '—',
      f2: rd.f2Stats?.kd ?? '—',
      f1Raw: rd.f1Stats?.kd ?? 0,
      f2Raw: rd.f2Stats?.kd ?? 0,
    },
    {
      label: 'Takedowns',
      f1: rd.f1Stats ? `${rd.f1Stats.takedowns_landed}/${rd.f1Stats.takedowns_attempted}` : '—',
      f2: rd.f2Stats ? `${rd.f2Stats.takedowns_landed}/${rd.f2Stats.takedowns_attempted}` : '—',
      f1Raw: rd.f1Stats?.takedowns_landed ?? 0,
      f2Raw: rd.f2Stats?.takedowns_landed ?? 0,
    },
    {
      label: 'Control Time',
      f1: fmtControlTime(rd.f1Stats),
      f2: fmtControlTime(rd.f2Stats),
      f1Raw: rd.f1Stats?.control_time_sec ?? 0,
      f2Raw: rd.f2Stats?.control_time_sec ?? 0,
    },
    {
      label: 'Sub Attempts',
      f1: rd.f1Stats?.sub_attempts ?? '—',
      f2: rd.f2Stats?.sub_attempts ?? '—',
      f1Raw: rd.f1Stats?.sub_attempts ?? 0,
      f2Raw: rd.f2Stats?.sub_attempts ?? 0,
    },
    {
      label: 'Head',
      f1: rd.f1Stats?.sig_strikes_head_landed ?? '—',
      f2: rd.f2Stats?.sig_strikes_head_landed ?? '—',
      f1Raw: rd.f1Stats?.sig_strikes_head_landed ?? 0,
      f2Raw: rd.f2Stats?.sig_strikes_head_landed ?? 0,
    },
    {
      label: 'Body',
      f1: rd.f1Stats?.sig_strikes_body_landed ?? '—',
      f2: rd.f2Stats?.sig_strikes_body_landed ?? '—',
      f1Raw: rd.f1Stats?.sig_strikes_body_landed ?? 0,
      f2Raw: rd.f2Stats?.sig_strikes_body_landed ?? 0,
    },
    {
      label: 'Legs',
      f1: rd.f1Stats?.sig_strikes_leg_landed ?? '—',
      f2: rd.f2Stats?.sig_strikes_leg_landed ?? '—',
      f1Raw: rd.f1Stats?.sig_strikes_leg_landed ?? 0,
      f2Raw: rd.f2Stats?.sig_strikes_leg_landed ?? 0,
    },
  ];

  // --- Helpers for overview tab ---
  const f1Name = meta ? meta.fighter1_name : fight.bout?.split(' vs ')[0]?.trim() || 'Unknown';
  const f2Name = meta ? meta.fighter2_name : fight.bout?.split(' vs ')[1]?.trim() || 'Fighter';
  const f1Initials = f1Name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const f2Initials = f2Name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const f1Last = f1Name.split(' ').pop();
  const f1First = f1Name.split(' ').slice(0, -1).join(' ');
  const f2Last = f2Name.split(' ').pop();
  const f2First = f2Name.split(' ').slice(0, -1).join(' ');
  const weightClass = meta?.weight_class_clean || meta?.weight_class || fight.weight_class || '';

  // Aggregate totals across all rounds for overview stats
  const overviewStats = rounds.length > 0 ? (() => {
    const sum = (key) => rounds.reduce((t, rd) => t + (rd.f1Stats?.[key] || 0), 0);
    const sum2 = (key) => rounds.reduce((t, rd) => t + (rd.f2Stats?.[key] || 0), 0);
    return [
      { label: 'Sig. Strikes', f1: sum('sig_strikes_landed'), f2: sum2('sig_strikes_landed'), f1Disp: `${sum('sig_strikes_landed')}/${sum('sig_strikes_attempted')}`, f2Disp: `${sum2('sig_strikes_landed')}/${sum2('sig_strikes_attempted')}` },
      { label: 'Knockdowns', f1: sum('kd'), f2: sum2('kd') },
      { label: 'Takedowns', f1: sum('takedowns_landed'), f2: sum2('takedowns_landed'), f1Disp: `${sum('takedowns_landed')}/${sum('takedowns_attempted')}`, f2Disp: `${sum2('takedowns_landed')}/${sum2('takedowns_attempted')}` },
      { label: 'Ctrl Time', f1: sum('control_time_sec'), f2: sum2('control_time_sec'), f1Disp: `${Math.floor(sum('control_time_sec') / 60)}:${(sum('control_time_sec') % 60).toString().padStart(2, '0')}`, f2Disp: `${Math.floor(sum2('control_time_sec') / 60)}:${(sum2('control_time_sec') % 60).toString().padStart(2, '0')}` },
      { label: 'Head', f1: sum('sig_strikes_head_landed'), f2: sum2('sig_strikes_head_landed') },
      { label: 'Body', f1: sum('sig_strikes_body_landed'), f2: sum2('sig_strikes_body_landed') },
      { label: 'Legs', f1: sum('sig_strikes_leg_landed'), f2: sum2('sig_strikes_leg_landed') },
      { label: 'Sub Attempts', f1: sum('sub_attempts'), f2: sum2('sub_attempts') },
    ];
  })() : [];

  // Dual bar component
  const DualBar = ({ f1Val, f2Val }) => {
    const total = (f1Val || 0) + (f2Val || 0);
    const f1Pct = total > 0 ? (f1Val / total) * 100 : 50;
    const f2Pct = total > 0 ? (f2Val / total) * 100 : 50;
    return (
      <div className="flex w-full h-[5px] rounded-full overflow-hidden gap-[2px]">
        <div className="bg-pulse-red rounded-l-full" style={{ width: `${f1Pct}%` }} />
        <div className="bg-pulse-blue rounded-r-full" style={{ width: `${f2Pct}%` }} />
      </div>
    );
  };

  // Stat row component for overview
  const StatRow = ({ label, f1Val, f2Val, f1Display, f2Display }) => (
    <div className="flex items-center mb-3.5">
      <div className={`w-12 text-center font-heading font-bold text-[15px] ${f1Val > f2Val ? 'text-pulse-red' : 'text-pulse-text-2'}`}>
        {f1Display ?? f1Val}
      </div>
      <div className="flex-1 flex flex-col items-center gap-1 px-1.5">
        <span className="text-[10px] text-pulse-text-3 uppercase tracking-wider">{label}</span>
        <DualBar f1Val={f1Val} f2Val={f2Val} />
      </div>
      <div className={`w-12 text-center font-heading font-bold text-[15px] ${f2Val > f1Val ? 'text-pulse-blue' : 'text-pulse-text-2'}`}>
        {f2Display ?? f2Val}
      </div>
    </div>
  );

  // Available tabs
  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'byRound', label: 'By Round' },
    { key: 'scoring', label: 'Scoring' },
    { key: 'judges', label: 'Judges' },
  ];

  return (
    <div className="animate-in fade-in">

      {/* BACK BUTTON */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 mb-4 text-xs font-semibold text-pulse-text-3 hover:text-pulse-red transition-colors uppercase tracking-wider"
      >
        <div className="w-9 h-9 rounded-btn bg-pulse-surface border border-white/[0.06] flex items-center justify-center">
          <ChevronLeft size={18} />
        </div>
        <span>{fight.event_name}</span>
      </button>

      {/* LOADING */}
      {loading && (
        <div className="flex items-center justify-center py-24">
          <div className="w-8 h-8 border-2 border-pulse-red border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* ERROR */}
      {!loading && error && (
        <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-6 text-center">
          <p className="text-sm text-pulse-text-3 uppercase tracking-widest">{error}</p>
        </div>
      )}

      {/* CONTENT */}
      {!loading && !error && (
        <>
          {/* FIGHT HEADER — two-column avatar layout */}
          <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-5 mb-3">
            <div className="flex items-center justify-between">
              {/* Fighter 1 */}
              <div className="flex flex-col items-center flex-1 min-w-0">
                <div className="w-[60px] h-[60px] rounded-full border-[3px] border-pulse-red bg-pulse-red/[0.08] flex items-center justify-center font-heading font-bold text-xl text-pulse-text mb-2">
                  {f1Initials}
                </div>
                <div className="font-heading font-bold text-base uppercase tracking-wider text-center leading-tight">
                  {f1First && <span className="block text-[11px] font-medium text-pulse-text-2">{f1First}</span>}
                  {f1Last}
                </div>
              </div>

              {/* VS divider */}
              <div className="flex flex-col items-center gap-1.5 px-2 shrink-0">
                <span className="font-heading font-extrabold text-base text-pulse-text-3 tracking-widest">VS</span>
                {weightClass && (
                  <span className="text-[9px] text-pulse-text-2 bg-pulse-surface-2 px-2 py-1 rounded-pill whitespace-nowrap text-center leading-tight">
                    {weightClass}
                    {meta?.round ? <><br />{meta.round} · {fight.bout?.includes('Title') ? 'Title' : 'Bout'}</> : ''}
                  </span>
                )}
              </div>

              {/* Fighter 2 */}
              <div className="flex flex-col items-center flex-1 min-w-0">
                <div className="w-[60px] h-[60px] rounded-full border-[3px] border-pulse-blue bg-pulse-blue/[0.08] flex items-center justify-center font-heading font-bold text-xl text-pulse-text mb-2">
                  {f2Initials}
                </div>
                <div className="font-heading font-bold text-base uppercase tracking-wider text-center leading-tight">
                  {f2First && <span className="block text-[11px] font-medium text-pulse-text-2">{f2First}</span>}
                  {f2Last}
                </div>
              </div>
            </div>
          </div>

          {/* RESULT BANNER */}
          {meta?.winner && fight.status === 'completed' && (
            <div className="mx-0 mb-3 bg-pulse-green/[0.08] border border-pulse-green/20 rounded-card px-4 py-3 flex items-center gap-2.5">
              <div className="w-2 h-2 rounded-full bg-pulse-green shrink-0" />
              <span className="font-heading font-semibold text-[15px] text-pulse-green tracking-wider">
                {meta.winner} wins{meta.method ? ` via ${meta.method}` : ''}
                {meta.round ? ` (R${meta.round}` : ''}
                {meta.time ? `, ${meta.time})` : meta.round ? ')' : ''}
              </span>
            </div>
          )}

          {/* LIVE / UPCOMING BANNERS */}
          {fight.status === 'upcoming' && !isLive && !isLocked && (
            <div className="bg-pulse-surface border border-white/[0.06] rounded-card p-6 text-center mb-3">
              <p className="text-sm text-pulse-text-3 uppercase tracking-widest">
                Fight has not yet started. Scoring opens when the fight begins.
              </p>
            </div>
          )}
          {fight.status === 'upcoming' && isLive && (
            <div className="bg-pulse-red/10 border border-pulse-red/20 rounded-card px-4 py-3 mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-pulse-red animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-widest text-pulse-red">Fight In Progress</span>
            </div>
          )}
          {fight.status === 'upcoming' && isLocked && (
            <div className="bg-pulse-surface border border-white/[0.06] rounded-card p-4 text-center mb-3">
              <p className="text-sm text-pulse-text-3 uppercase tracking-widest">
                Fight finished. Official stats will be available shortly.
              </p>
            </div>
          )}

          {/* LIVE / UPCOMING SCORING */}
          {fight.status === 'upcoming' && (isLive || isLocked) && (
            <RoundScoringPanel fight={fight} meta={meta} isLocked={false} currentTheme={currentTheme} onAllRoundsScored={() => setHasUserScores(true)} totalRoundsOverride={scorableRounds} isGuest={isGuest} />
          )}

          {/* COMPLETED — no meta yet */}
          {fight.status === 'completed' && !meta && (
            <div className="bg-pulse-surface border border-white/[0.06] rounded-card p-6 text-center mb-3">
              <p className="text-sm text-pulse-text-3 uppercase tracking-widest">Round stats not yet available for this fight.</p>
            </div>
          )}
          {fight.status === 'completed' && !meta && scorableRounds > 0 && (
            <RoundScoringPanel fight={fight} meta={null} isLocked={false} currentTheme={currentTheme} onAllRoundsScored={() => setHasUserScores(true)} totalRoundsOverride={scorableRounds} isGuest={isGuest} />
          )}

          {/* COMPLETED — has meta: TAB BAR + CONTENT */}
          {fight.status === 'completed' && meta && (
            <>
              {/* Tab bar */}
              <div className="flex gap-1 mb-4 overflow-x-auto pb-1 scrollbar-hide">
                {tabs.map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setDetailTab(key)}
                    className={`font-heading font-semibold text-[13px] px-3.5 py-1.5 rounded-pill whitespace-nowrap uppercase tracking-wider border transition-all
                      ${detailTab === key
                        ? 'bg-pulse-red text-white border-pulse-red'
                        : 'bg-pulse-surface text-pulse-text-3 border-white/[0.06] hover:text-pulse-text-2'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* === OVERVIEW TAB === */}
              {detailTab === 'overview' && (
                <div className="animate-in fade-in">
                  {overviewStats.length > 0 ? (
                    <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-4 mb-3">
                      <h3 className="font-heading font-bold text-sm uppercase tracking-widest text-pulse-text-2 mb-4">Fight Statistics</h3>
                      {overviewStats.map(row => (
                        <StatRow key={row.label} label={row.label} f1Val={row.f1} f2Val={row.f2} f1Display={row.f1Disp} f2Display={row.f2Disp} />
                      ))}
                    </div>
                  ) : (
                    <div className="bg-pulse-surface border border-white/[0.06] rounded-card p-6 text-center mb-3">
                      <p className="text-sm text-pulse-text-3 uppercase tracking-widest">Round stats not yet available for this fight.</p>
                    </div>
                  )}

                  {/* Round Breakdown Summary */}
                  {rounds.length > 0 && (
                    <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-4 mb-3">
                      <h3 className="font-heading font-bold text-sm uppercase tracking-widest text-pulse-text-2 mb-1">Round Breakdown</h3>
                      <p className="text-[11px] text-pulse-text-3 mb-4 flex items-center gap-1.5">
                        <Brain size={12} />
                        ML model prediction of round dominance based on fight stats
                      </p>
                      {(() => {
                        const isDecision = meta.method?.toLowerCase().includes('decision');
                        const lastRound = rounds.length;
                        return rounds.map(rd => {
                          const isFinishRound = !isDecision && rd.round === lastRound;
                          if (isFinishRound) {
                            return (
                              <div key={rd.round} className="flex items-center gap-2 mb-2">
                                <span className="font-heading font-semibold text-xs text-pulse-text-3 w-6 text-center">R{rd.round}</span>
                                <div className="flex-1 h-2 bg-pulse-surface-2 rounded-full overflow-hidden" />
                                <span className="text-[10px] text-pulse-text-3 w-6 text-center">—</span>
                              </div>
                            );
                          }
                          const conf = rd.model.confidence || 0.5;
                          const pct = Math.round(conf * 100);
                          const isF1 = rd.model.winner === 'f1';
                          return (
                            <div key={rd.round} className="flex items-center gap-2 mb-2">
                              <span className="font-heading font-semibold text-xs text-pulse-text-3 w-6 text-center">R{rd.round}</span>
                              <div className="flex-1 h-2 bg-pulse-surface-2 rounded-full overflow-hidden relative">
                                {isF1 ? (
                                  <div className="absolute left-0 top-0 h-full bg-pulse-red rounded-full" style={{ width: `${pct}%` }} />
                                ) : (
                                  <div className="absolute right-0 top-0 h-full bg-pulse-blue rounded-full" style={{ width: `${pct}%` }} />
                                )}
                              </div>
                              <span className={`text-[10px] font-semibold w-6 text-center ${isF1 ? 'text-pulse-red' : 'text-pulse-blue'}`}>
                                {isF1 ? f1Initials : f2Initials}
                              </span>
                            </div>
                          );
                        });
                      })()}
                    </div>
                  )}

                  {/* Stoppage note */}
                  {meta.method && !meta.method.toLowerCase().includes('decision') && (
                    <p className="text-[11px] text-pulse-text-3 text-center uppercase tracking-wider mb-3">
                      Ended by {meta.method} — no judges' scorecard available
                    </p>
                  )}
                </div>
              )}

              {/* === BY ROUND TAB === */}
              {detailTab === 'byRound' && (
                <div className="animate-in fade-in">
                  {rounds.length === 0 && (
                    <div className="bg-pulse-surface border border-white/[0.06] rounded-card p-6 text-center">
                      <p className="text-sm text-pulse-text-3 uppercase tracking-widest">Round stats not yet available for this fight.</p>
                    </div>
                  )}
                  {rounds.map(rd => (
                    <div key={rd.round} className="bg-pulse-surface border border-white/[0.06] rounded-fight mb-3 overflow-hidden">
                      <div className="px-4 py-2.5 border-b border-white/[0.06]">
                        <p className="text-xs font-heading font-bold uppercase tracking-widest text-pulse-text-2">Round {rd.round}</p>
                      </div>
                      <div className="p-4">
                        {(rd.f1Stats || rd.f2Stats) ? (
                          <>
                            {STATS_ROWS(rd).map(row => (
                              <StatRow key={row.label} label={row.label} f1Val={row.f1Raw} f2Val={row.f2Raw} f1Display={row.f1} f2Display={row.f2} />
                            ))}
                          </>
                        ) : (
                          <p className="text-xs text-pulse-text-3 text-center uppercase tracking-widest py-4">No stats for this round</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* === SCORING TAB === */}
              {detailTab === 'scoring' && (
                <div className="animate-in fade-in">
                  {(() => {
                    const isDecision = meta?.method?.toLowerCase().includes('decision');
                    const roundsFought = parseInt((meta?.round || '').split(' ')[0]) || 0;
                    const scoreableRounds = isDecision ? roundsFought : Math.max(0, roundsFought - 1);
                    if (scoreableRounds === 0) {
                      return (
                        <div className="bg-pulse-surface border border-white/[0.06] rounded-card p-6 text-center">
                          <p className="text-sm text-pulse-text-2 uppercase tracking-widest mb-1">No rounds to score</p>
                          <p className="text-xs text-pulse-text-3">
                            This fight ended in Round {roundsFought || 1} by {meta?.method || 'stoppage'} — only completed rounds can be scored.
                          </p>
                        </div>
                      );
                    }
                    return (
                      <RoundScoringPanel
                        fight={fight}
                        meta={meta}
                        isLocked={false}
                        currentTheme={currentTheme}
                        onAllRoundsScored={() => setHasUserScores(true)}
                        isGuest={isGuest}
                      />
                    );
                  })()}
                </div>
              )}

              {/* === JUDGES TAB === */}
              {detailTab === 'judges' && (
                <div className="animate-in fade-in">
                  {rounds.length > 0 ? (
                    <ScorecardComparison fight={fight} rounds={rounds} meta={meta} currentTheme={currentTheme} hasUserScores={hasUserScores} isGuest={isGuest} />
                  ) : (
                    <div className="bg-pulse-surface border border-white/[0.06] rounded-card p-6 text-center">
                      <p className="text-sm text-pulse-text-3 uppercase tracking-widest">Judge data not yet available for this fight.</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

export default FightDetailView;
