import { useState, useEffect } from 'react';
import { ChevronLeft } from 'lucide-react';
import { dataService } from '../dataService';

// --- SCORING MODEL ---

const WEIGHTS = {
  sig_strikes_landed: 1.0,
  kd: 5.0,
  takedowns_landed: 2.5,
  control_time_sec: 0.015,
  sub_attempts: 1.5,
};

function computeRoundScore(stats) {
  if (!stats) return 0;
  return (
    (stats.sig_strikes_landed || 0) * WEIGHTS.sig_strikes_landed +
    (stats.kd || 0) * WEIGHTS.kd +
    (stats.takedowns_landed || 0) * WEIGHTS.takedowns_landed +
    (stats.control_time_sec || 0) * WEIGHTS.control_time_sec +
    (stats.sub_attempts || 0) * WEIGHTS.sub_attempts
  );
}

function scoreRound(f1Stats, f2Stats) {
  const s1 = computeRoundScore(f1Stats);
  const s2 = computeRoundScore(f2Stats);
  const margin = Math.abs(s1 - s2);
  const winner = s1 > s2 ? 'f1' : s2 > s1 ? 'f2' : 'draw';
  const f1KD = (f1Stats?.kd || 0) > 0;
  const f2KD = (f2Stats?.kd || 0) > 0;
  // 10-8: winner scored a KD, OR margin is very large
  const dominant = (winner === 'f1' && (f1KD || margin > 15)) ||
                   (winner === 'f2' && (f2KD || margin > 15));

  let f1Score, f2Score;
  if (winner === 'draw') {
    f1Score = 10; f2Score = 10;
  } else if (winner === 'f1') {
    f1Score = 10; f2Score = dominant ? 8 : 9;
  } else {
    f2Score = 10; f1Score = dominant ? 8 : 9;
  }
  return { f1Score, f2Score, winner, margin };
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
  if (a.replace(/\s/g, '') === b.replace(/\s/g, '')) return true;

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

function buildRoundData(meta, roundStats, judgeScores) {
  const roundsFought = parseInt((meta.round || '').split(' ')[0]) || 0;
  if (roundsFought === 0) return [];

  return Array.from({ length: roundsFought }, (_, i) => {
    const r = i + 1;
    const f1Stats = roundStats.find(s => s.fighter_name === meta.fighter1_name && s.round === r) || null;
    const f2Stats = roundStats.find(s => s.fighter_name === meta.fighter2_name && s.round === r) || null;
    const model = scoreRound(f1Stats, f2Stats);

    // Filter judge rows for this round that belong to this fight's fighters
    const roundJudgeRows = judgeScores.filter(js =>
      js.round === r &&
      (matchesFighter(js.fighter, meta.fighter1_name) || matchesFighter(js.fighter, meta.fighter2_name))
    );
    const judgeNames = [...new Set(roundJudgeRows.map(js => js.judge))];
    const judges = judgeNames.map(judgeName => {
      const f1Row = roundJudgeRows.find(js => js.judge === judgeName && matchesFighter(js.fighter, meta.fighter1_name));
      const f2Row = roundJudgeRows.find(js => js.judge === judgeName && matchesFighter(js.fighter, meta.fighter2_name));
      const f1Score = f1Row?.score ?? null;
      const f2Score = f2Row?.score ?? null;
      let matchesModel = null;
      if (f1Score !== null && f2Score !== null) {
        const jWinner = f1Score > f2Score ? 'f1' : f2Score > f1Score ? 'f2' : 'draw';
        matchesModel = jWinner === model.winner;
      }
      return { judgeName, f1Score, f2Score, matchesModel };
    });

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

const FightDetailView = ({ fight, currentTheme, onBack }) => {
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState(null);
  const [rounds, setRounds] = useState([]);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState(null);

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
        const roundData = buildRoundData(m, roundStats, judgeScores);
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

            {/* UPCOMING NOTICE */}
            {fight.status === 'upcoming' && (
              <div className={`${currentTheme.card} p-6 rounded-xl border text-center opacity-60`}>
                <p className="text-sm uppercase tracking-widest">
                  Fight has not yet taken place. Stats and scoring will be available after the event.
                </p>
              </div>
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

                  {/* MODEL PREDICTION */}
                  <div className="bg-black/20 rounded-lg px-4 py-3 mb-3 flex items-center justify-between">
                    <span className="text-xs uppercase tracking-widest opacity-50 font-bold">Model</span>
                    <span className="text-sm font-black">
                      <span className={rd.model.winner === 'f1' ? currentTheme.accent : 'opacity-50'}>
                        {rd.model.f1Score}
                      </span>
                      <span className="opacity-30 mx-2">–</span>
                      <span className={rd.model.winner === 'f2' ? currentTheme.accent : 'opacity-50'}>
                        {rd.model.f2Score}
                      </span>
                    </span>
                    <span className={`text-xs font-bold uppercase tracking-wider ${
                      (rd.model.f1Score === 8 || rd.model.f2Score === 8) ? 'text-red-400' : 'opacity-30'
                    }`}>
                      {(rd.model.f1Score === 8 || rd.model.f2Score === 8) ? '10-8' :
                       rd.model.winner === 'draw' ? '10-10' : '10-9'}
                    </span>
                  </div>

                  {/* JUDGE SCORES */}
                  {rd.judges.length > 0 ? (
                    <div className="space-y-2">
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
                  ) : (
                    fight.status === 'completed' && (
                      <p className="text-xs opacity-30 text-center uppercase tracking-widest">No scorecard data for this round</p>
                    )
                  )}
                </div>
              </div>
            ))}

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
          </>
        )}
      </div>
    </div>
  );
};

export default FightDetailView;
