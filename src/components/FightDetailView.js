import { useState, useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import { dataService } from '../dataService';
import { supabase } from '../supabaseClient';
import RoundScoringPanel from './RoundScoringPanel';

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
  return (name || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
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

  // Fallback 1: same last name (handles nickname/middle-name differences like "Alex" vs "Alexander")
  const aLast = aWords[aWords.length - 1];
  const bLast = bWords[bWords.length - 1];
  if (aLast === bLast && aLast.length > 3) return true;

  // Fallback 2: all words of the shorter name appear in the longer (handles Jr., suffixes, middle names)
  const shorter = aWords.length <= bWords.length ? aWords : bWords;
  const longer  = aWords.length <= bWords.length ? bWords : aWords;
  return shorter.filter(w => w.length > 1).every(w => longer.includes(w));
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

function buildSummaryTotals(rounds, judgeScores, meta) {
  const modelF1 = rounds.reduce((a, r) => a + r.model.f1Score, 0);
  const modelF2 = rounds.reduce((a, r) => a + r.model.f2Score, 0);
  const allJudges = [...new Set(rounds.flatMap(r => r.judges.map(j => j.judgeName)))];
  const judgeTotals = allJudges.map(name => {
    let f1 = 0, f2 = 0;
    rounds.forEach(r => {
      const j = r.judges.find(j => j.judgeName === name);
      if (j?.f1Score != null && j?.f2Score != null) { f1 += j.f1Score; f2 += j.f2Score; }
    });
    return {
      judgeName: name,
      f1Total: f1,
      f2Total: f2,
      judgeWinner: f1 > f2 ? meta.fighter1_name : f2 > f1 ? meta.fighter2_name : 'DRAW',
    };
  });
  return { model: { f1: modelF1, f2: modelF2 }, judges: judgeTotals };
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

const FightDetailView = ({ fight, currentTheme, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

  // Live fight status — seeded from DB, updated by ESPN polling
  const [fightStartedAt, setFightStartedAt] = useState(fight.fight_started_at || null);
  const [fightEndedAt, setFightEndedAt]     = useState(fight.fight_ended_at   || null);

  // Derived: fight is currently in progress / scoring window is closed
  const isLive   = !!fightStartedAt && !fightEndedAt;
  const isLocked = !!fightEndedAt;

  // Poll ESPN every 60s for upcoming fights with a known ESPN competition ID.
  // First client to detect a status change calls the Edge Function, which writes
  // the timestamp to the DB. Subsequent clients read it from the DB on mount.
  useEffect(() => {
    if (fight.status !== 'upcoming' || !fight.espn_competition_id || fightEndedAt) return;

    const dateParam = (fight.event_date || '').replace(/-/g, '');
    if (!dateParam) return;

    let prevStatus = null;
    let stopped = false;

    const callEdgeFn = async (status) => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        await fetch(EDGE_FN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({ fight_id: fight.id, status }),
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
          const comp = (ev.competitions || []).find(c => String(c.id) === fight.espn_competition_id);
          if (!comp) continue;
          const statusName = comp.status?.type?.name;
          if (statusName === prevStatus) break;
          prevStatus = statusName;
          if (statusName === 'STATUS_IN_PROGRESS') {
            setFightStartedAt(new Date().toISOString());
            await callEdgeFn('in_progress');
          } else if (statusName === 'STATUS_FINAL') {
            const now = new Date().toISOString();
            setFightStartedAt(s => s || now);
            setFightEndedAt(now);
            stopped = true;
            await callEdgeFn('final');
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
  }, [fight.id, fight.status, fight.espn_competition_id, fight.event_date, fightEndedAt]);

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
        if (!m) { setError('Fight details not yet available.'); return; }
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
        setSummary(buildSummaryTotals(roundData, judgeScores, m));
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

  const getDecisionType = (judges) => {
    const winnerCounts = {};
    judges.forEach(j => { winnerCounts[j.judgeWinner] = (winnerCounts[j.judgeWinner] || 0) + 1; });
    const counts = Object.values(winnerCounts);
    if (counts.length === 1) return 'Unanimous';
    if (counts.some(c => c === 2)) return 'Split';
    return 'Majority';
  };

  return (
    <div className={`min-h-screen ${currentTheme.bg} p-4 md:p-8 animate-in fade-in`}>
      <div className="max-w-3xl mx-auto">

        {/* BACK BUTTON */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 mb-6 text-sm font-bold opacity-60 hover:opacity-100 transition-opacity uppercase tracking-widest"
        >
          <ChevronLeft size={16} />
          {fight.event_name}
        </button>

        {/* LOADING */}
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin opacity-50" />
          </div>
        )}

        {/* ERROR */}
        {!loading && error && (
          <div className={`${currentTheme.card} p-6 rounded-xl border text-center opacity-60`}>
            <p className="text-sm uppercase tracking-widest">{error}</p>
          </div>
        )}

        {/* CONTENT */}
        {!loading && meta && (
          <>
            {/* FIGHT HEADER */}
            <div className={`${currentTheme.card} p-6 rounded-xl border mb-6 shadow-lg text-center`}>
              <div className="flex items-center justify-center gap-4 mb-3 flex-wrap">
                <h1 className="text-lg sm:text-2xl font-black">{meta.fighter1_name}</h1>
                <span className={`text-lg font-bold ${currentTheme.accent} opacity-60`}>VS</span>
                <h1 className="text-lg sm:text-2xl font-black">{meta.fighter2_name}</h1>
              </div>
              <p className="text-xs opacity-50 uppercase tracking-widest">
                {fight.weight_class || meta.weight_class || ''}
                {meta.method ? ` · ${meta.method}` : ''}
                {meta.round ? ` · R${meta.round}` : ''}
                {meta.time ? ` ${meta.time}` : ''}
                {meta.referee ? ` · Ref: ${meta.referee}` : ''}
              </p>
              {meta.winner && fight.status === 'completed' && (
                <div className={`mt-3 inline-block text-xs font-bold uppercase tracking-widest px-3 py-1 rounded-full ${currentTheme.primary} text-white`}>
                  W: {meta.winner}
                </div>
              )}
            </div>

            {/* UPCOMING STATUS */}
            {fight.status === 'upcoming' && !isLive && !isLocked && (
              <div className={`${currentTheme.card} p-6 rounded-xl border text-center opacity-60`}>
                <p className="text-sm uppercase tracking-widest">
                  Fight has not yet started. Scoring opens when the fight begins.
                </p>
              </div>
            )}

            {/* LIVE — scoring window open */}
            {fight.status === 'upcoming' && isLive && (
              <div className={`${currentTheme.card} p-4 rounded-xl border mb-4 text-center`}>
                <p className="text-xs font-black uppercase tracking-widest opacity-60">🔴 Fight In Progress</p>
              </div>
            )}
            {fight.status === 'upcoming' && isLive && meta && (
              <RoundScoringPanel fight={fight} meta={meta} isLocked={false} currentTheme={currentTheme} />
            )}

            {/* ENDED — scoring locked, stats incoming */}
            {fight.status === 'upcoming' && isLocked && (
              <div className={`${currentTheme.card} p-6 rounded-xl border text-center opacity-60 mb-4`}>
                <p className="text-sm uppercase tracking-widest">
                  Fight finished. Official stats will be available shortly.
                </p>
              </div>
            )}
            {fight.status === 'upcoming' && isLocked && meta && (
              <RoundScoringPanel fight={fight} meta={meta} isLocked={true} currentTheme={currentTheme} />
            )}

            {/* NO STATS YET */}
            {fight.status !== 'upcoming' && rounds.length === 0 && (
              <div className={`${currentTheme.card} p-6 rounded-xl border text-center opacity-60`}>
                <p className="text-sm uppercase tracking-widest">Round stats not yet available for this fight.</p>
              </div>
            )}

            {/* ROUND BREAKDOWN */}
            {rounds.map(rd => (
              <div key={rd.round} className={`${currentTheme.card} rounded-xl border mb-4 shadow-lg overflow-hidden`}>

                {/* ROUND HEADER */}
                <div className="px-4 sm:px-6 py-3 bg-black/30 border-b border-white/10">
                  <p className="text-xs font-black uppercase tracking-widest opacity-60">Round {rd.round}</p>
                </div>

                <div className="p-4 sm:p-6">
                  {/* FIGHTER NAME HEADERS */}
                  <div className="grid grid-cols-3 text-xs opacity-40 uppercase tracking-widest mb-3">
                    <span className="font-bold">{meta.fighter1_name.split(' ').pop()}</span>
                    <span className="text-center"></span>
                    <span className="text-right font-bold">{meta.fighter2_name.split(' ').pop()}</span>
                  </div>

                  {/* STATS GRID */}
                  {(rd.f1Stats || rd.f2Stats) ? (
                    <div className="space-y-2 mb-5">
                      {STATS_ROWS(rd).map(row => (
                        <div key={row.label} className="grid grid-cols-3 items-center text-xs sm:text-sm">
                          <span className={`text-left font-bold ${row.f1Raw > row.f2Raw ? currentTheme.accent : 'opacity-80'}`}>
                            {row.f1}
                          </span>
                          <span className="text-center text-xs opacity-40 uppercase tracking-wider">{row.label}</span>
                          <span className={`text-right font-bold ${row.f2Raw > row.f1Raw ? currentTheme.accent : 'opacity-80'}`}>
                            {row.f2}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs opacity-40 text-center mb-5 uppercase tracking-widest">No stats for this round</p>
                  )}

                  {/* MODEL PREDICTION + JUDGE SCORES */}
                  {(rd.model.confidence !== null || rd.judges.length > 0) && (
                    <div className="space-y-2">
                      {rd.model.confidence !== null && (
                        <div className="grid grid-cols-3 items-center text-xs pb-2 border-b border-white/10">
                          <span className={`font-bold ${rd.model.winner === 'f1' ? currentTheme.accent : 'opacity-60'}`}>
                            {rd.model.f1Score}
                          </span>
                          <span className="text-center flex flex-col items-center opacity-50">
                            <span className="font-bold uppercase tracking-wider">Model</span>
                            <span className="opacity-80">({Math.round(rd.model.confidence * 100)}%)</span>
                          </span>
                          <span className={`text-right font-bold ${rd.model.winner === 'f2' ? currentTheme.accent : 'opacity-60'}`}>
                            {rd.model.f2Score}
                          </span>
                        </div>
                      )}
                      {rd.judges.map(j => (
                        <div key={j.judgeName} className="grid grid-cols-3 items-center text-xs">
                          <span className={`font-bold ${j.f1Score > j.f2Score ? currentTheme.accent : 'opacity-60'}`}>
                            {j.f1Score ?? '—'}
                          </span>
                          <span className="text-center opacity-40 flex items-center justify-center gap-1">
                            {j.judgeName}
                            {j.matchesModel !== null && (
                              <span className={j.matchesModel ? 'text-green-400' : 'text-red-400'}>
                                {j.matchesModel ? '✓' : '✗'}
                              </span>
                            )}
                          </span>
                          <span className={`text-right font-bold ${j.f2Score > j.f1Score ? currentTheme.accent : 'opacity-60'}`}>
                            {j.f2Score ?? '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {rd.judges.length === 0 && fight.status === 'completed' && (
                    <p className="text-xs opacity-30 text-center uppercase tracking-widest">No judges' scorecard for this round</p>
                  )}
                </div>
              </div>
            ))}

            {/* STOPPAGE NOTE */}
            {meta.method && !meta.method.toLowerCase().includes('decision') && (
              <p className="text-xs opacity-40 text-center uppercase tracking-widest mb-6">
                Ended by {meta.method} — no judges' scorecard available
              </p>
            )}

            {/* SUMMARY TOTALS */}
            {summary && summary.judges.length > 0 && (
              <div className={`${currentTheme.card} rounded-xl border mb-6 shadow-lg overflow-hidden`}>
                <div className="px-4 sm:px-6 py-3 bg-black/30 border-b border-white/10 flex items-center justify-between">
                  <p className="text-xs font-black uppercase tracking-widest opacity-60">Final Scorecard</p>
                  <span className={`text-xs font-bold uppercase tracking-widest ${currentTheme.accent}`}>
                    {getDecisionType(summary.judges)} Decision
                  </span>
                </div>
                <div className="p-6">
                  {/* Column headers */}
                  <div className="grid grid-cols-3 text-xs opacity-40 uppercase tracking-widest mb-3">
                    <span></span>
                    <span className="text-center font-bold">{meta.fighter1_name.split(' ').pop()}</span>
                    <span className="text-right font-bold">{meta.fighter2_name.split(' ').pop()}</span>
                  </div>
                  {/* Model row */}
                  <div className="grid grid-cols-3 items-center text-sm mb-2 pb-2 border-b border-white/10">
                    <span className="text-xs opacity-50 uppercase tracking-wider font-bold">Model</span>
                    <span className={`text-center font-black ${summary.model.f1 > summary.model.f2 ? currentTheme.accent : 'opacity-60'}`}>
                      {summary.model.f1}
                    </span>
                    <span className={`text-right font-black ${summary.model.f2 > summary.model.f1 ? currentTheme.accent : 'opacity-60'}`}>
                      {summary.model.f2}
                    </span>
                  </div>
                  {/* Judge rows */}
                  {summary.judges.map(j => (
                    <div key={j.judgeName} className="grid grid-cols-3 items-center text-sm mb-1">
                      <span className="text-xs opacity-40 truncate">{j.judgeName}</span>
                      <span className={`text-center font-bold ${j.f1Total > j.f2Total ? currentTheme.accent : 'opacity-60'}`}>
                        {j.f1Total}
                      </span>
                      <span className={`text-right font-bold ${j.f2Total > j.f1Total ? currentTheme.accent : 'opacity-60'}`}>
                        {j.f2Total}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* YOUR SCORECARD — completed fights */}
            {fight.status === 'completed' && meta && (
              <RoundScoringPanel fight={fight} meta={meta} isLocked={false} currentTheme={currentTheme} />
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default FightDetailView;
