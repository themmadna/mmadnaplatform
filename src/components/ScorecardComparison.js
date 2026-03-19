import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { dataService } from '../dataService';
import * as guestStorage from '../guestStorage';

// Majority winner for a round: needs 2+ of 3 judges
function roundMajority(judges) {
  if (!judges || judges.length < 2) return null;
  const f1Wins = judges.filter(j => j.f1Score > j.f2Score).length;
  const f2Wins = judges.filter(j => j.f2Score > j.f1Score).length;
  if (f1Wins >= 2) return 'f1';
  if (f2Wins >= 2) return 'f2';
  return null;
}

// Most common score among judges agreeing with the majority
function getMajorityInfo(judges) {
  const maj = roundMajority(judges);
  if (!maj || !judges || judges.length === 0) return { winner: null, f1Score: null, f2Score: null };
  const agreeing = judges.filter(j =>
    (maj === 'f1' && j.f1Score > j.f2Score) || (maj === 'f2' && j.f2Score > j.f1Score)
  );
  if (agreeing.length === 0) return { winner: null, f1Score: null, f2Score: null };
  const counts = {};
  agreeing.forEach(j => { const k = `${j.f1Score}-${j.f2Score}`; counts[k] = (counts[k] || 0) + 1; });
  const [f1, f2] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0].split('-').map(Number);
  return { winner: maj, f1Score: f1, f2Score: f2 };
}

const getInitials = (name) => {
  const parts = name.trim().split(' ');
  return parts.length >= 2 ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase() : name.substring(0, 2).toUpperCase();
};

const scoreColor = (winner) =>
  winner === 'f1' ? 'text-pulse-red' : winner === 'f2' ? 'text-pulse-blue' : 'text-pulse-text-3';

// Future: Share Scorecard button — add below result card

const ScorecardComparison = ({ fight, rounds, meta, currentTheme, hasUserScores, isGuest = false }) => {
  const [userScores, setUserScores] = useState([]);
  const [community, setCommunity] = useState([]);
  const [expandedRounds, setExpandedRounds] = useState(new Set());

  useEffect(() => {
    if (!hasUserScores) return;
    const load = async () => {
      const commData = await dataService.getCommunityScorecard(fight.id);
      setCommunity(commData);

      if (isGuest) {
        const raw = guestStorage.getFightScores(fight.id);
        setUserScores(Object.entries(raw).map(([round, s]) => ({
          round: parseInt(round), f1_score: s.f1_score, f2_score: s.f2_score,
        })));
        return;
      }

      const { data: { user } } = await supabase.auth.getUser();
      const userResult = user
        ? await supabase.from('user_round_scores')
            .select('round, f1_score, f2_score')
            .eq('fight_id', fight.id)
            .eq('user_id', user.id)
        : { data: [] };
      setUserScores(userResult.data || []);
    };
    load();
  }, [fight.id, hasUserScores, isGuest]);

  if (!rounds || rounds.length === 0) return null;

  const f1Name = meta.fighter1_name;
  const f2Name = meta.fighter2_name;
  const f1Last = f1Name.split(' ').pop();
  const f2Last = f2Name.split(' ').pop();
  const f1Initials = getInitials(f1Name);
  const f2Initials = getInitials(f2Name);

  const toggleExpand = (round) => {
    setExpandedRounds(prev => {
      const next = new Set(prev);
      if (next.has(round)) next.delete(round);
      else next.add(round);
      return next;
    });
  };

  // Per-round analysis
  let matchCount = 0, totalWithJudges = 0;
  const disagreementRounds = [];
  const roundData = rounds.map(rd => {
    const userRow = userScores.find(s => s.round === rd.round);
    const majInfo = getMajorityInfo(rd.judges);
    const userWinner = userRow
      ? (userRow.f1_score > userRow.f2_score ? 'f1' : userRow.f2_score > userRow.f1_score ? 'f2' : 'draw')
      : null;

    let isMatch = null;
    if (userWinner && userWinner !== 'draw' && majInfo.winner) {
      totalWithJudges++;
      isMatch = userWinner === majInfo.winner;
      if (isMatch) matchCount++;
      else disagreementRounds.push(rd.round);
    }

    return { ...rd, userRow, majInfo, userWinner, isMatch };
  });

  const matchPct = totalWithJudges > 0 ? Math.round((matchCount / totalWithJudges) * 100) : 0;
  const circumference = 2 * Math.PI * 36;
  const dashoffset = circumference * (1 - matchPct / 100);

  // Totals
  const userTotal = userScores.reduce(
    (acc, s) => ({ f1: acc.f1 + s.f1_score, f2: acc.f2 + s.f2_score }), { f1: 0, f2: 0 }
  );
  const isDecision = meta?.method?.toLowerCase().includes('decision');
  const lastRound = rounds.length;

  let judgeMajF1 = 0, judgeMajF2 = 0;
  let modelF1 = 0, modelF2 = 0, hasModelTotal = false;
  roundData.forEach(rd => {
    const isFinishRound = !isDecision && rd.round === lastRound;
    if (rd.majInfo.f1Score != null) { judgeMajF1 += rd.majInfo.f1Score; judgeMajF2 += rd.majInfo.f2Score; }
    if (rd.model?.confidence && !isFinishRound) { modelF1 += rd.model.f1Score; modelF2 += rd.model.f2Score; hasModelTotal = true; }
  });

  // Judge totals for result card
  const judgeTotals = {};
  rounds.forEach(rd => {
    rd.judges.forEach(j => {
      if (!judgeTotals[j.judgeName]) judgeTotals[j.judgeName] = { f1: 0, f2: 0 };
      judgeTotals[j.judgeName].f1 += j.f1Score;
      judgeTotals[j.judgeName].f2 += j.f2Score;
    });
  });
  const judgeScoreStrings = Object.values(judgeTotals).map(t => `${t.f1}-${t.f2}`);

  // Winner side for result card color
  const winnerSide = (() => {
    const w = (fight.winner || '').toLowerCase();
    if (w.includes(f1Last.toLowerCase())) return 'f1';
    if (w.includes(f2Last.toLowerCase())) return 'f2';
    return null;
  })();

  // Match summary description
  const matchDescription = totalWithJudges === 0
    ? 'No judge data available for comparison.'
    : matchCount === totalWithJudges
      ? 'You matched the judging majority on every round.'
      : `Your ${disagreementRounds.length === 1 ? 'only split' : 'splits'} from the majority: Round${disagreementRounds.length > 1 ? 's' : ''} ${disagreementRounds.join(', ')}.`;

  return (
    <div className="mb-6">
      {/* Pre-scoring prompt */}
      {!hasUserScores && (
        <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-6 text-center">
          <p className="text-sm text-pulse-text-3 uppercase tracking-wider">Score this fight to reveal the comparison</p>
        </div>
      )}

      {hasUserScores && (
        <>
          {/* Mini Fighter Header */}
          <div className="flex items-center justify-center gap-3 py-4 mb-2 border-b border-white/[0.06]">
            <div className="w-9 h-9 rounded-full bg-pulse-red flex items-center justify-center font-heading font-bold text-[13px] text-white">
              {f1Initials}
            </div>
            <div className="text-center">
              <div className="font-heading font-bold text-base tracking-wide">
                {f1Last} vs {f2Last}
              </div>
              <div className="text-[11px] text-pulse-text-2 mt-0.5">
                {meta.weight_class_clean || meta.weight_class} · {rounds.length} Rounds
              </div>
            </div>
            <div className="w-9 h-9 rounded-full bg-pulse-blue flex items-center justify-center font-heading font-bold text-[13px] text-white">
              {f2Initials}
            </div>
          </div>

          {/* Scorecard Grid */}
          <div className="bg-pulse-surface border border-white/[0.06] rounded-fight overflow-hidden mb-4">
            {/* Header */}
            <div className="grid grid-cols-[44px_1fr_1fr_1fr_32px] px-3.5 py-3 border-b border-white/[0.06]">
              <span />
              <span className="text-center font-heading font-semibold text-xs uppercase tracking-wider text-pulse-text-2">You</span>
              <span className="text-center font-heading font-semibold text-xs uppercase tracking-wider text-pulse-text-2">Judges</span>
              <span className="text-center font-heading font-semibold text-xs uppercase tracking-wider text-pulse-text-2">Model</span>
              <span />
            </div>

            {/* Round rows */}
            {roundData.map(rd => (
              <div key={rd.round}>
                <div
                  className={`grid grid-cols-[44px_1fr_1fr_1fr_32px] px-3.5 py-3 border-b border-white/[0.06] items-center cursor-pointer transition-colors
                    ${rd.isMatch === false ? 'bg-pulse-amber/[0.06]' : 'hover:bg-white/[0.02]'}`}
                  onClick={() => rd.judges.length > 0 && toggleExpand(rd.round)}
                >
                  <span className="font-heading font-semibold text-[13px] text-pulse-text-2">R{rd.round}</span>

                  {/* You */}
                  <span className={`text-center font-semibold text-sm ${scoreColor(rd.userWinner)}`}>
                    {rd.userRow ? `${rd.userRow.f1_score}–${rd.userRow.f2_score}` : '—'}
                  </span>

                  {/* Judges (majority) */}
                  <span className={`text-center font-semibold text-sm ${scoreColor(rd.majInfo.winner)}`}>
                    {rd.majInfo.winner ? (
                      <>
                        {rd.majInfo.f1Score}–{rd.majInfo.f2Score}
                        <span className="text-[10px] text-pulse-text-3 ml-0.5">
                          {expandedRounds.has(rd.round) ? '▴' : '▾'}
                        </span>
                      </>
                    ) : rd.judges.length > 0 ? 'Split' : '—'}
                  </span>

                  {/* Model — hide for finishing round in non-decision fights */}
                  {(() => {
                    const isFinishRound = !isDecision && rd.round === lastRound;
                    const showModel = !isFinishRound && rd.model?.confidence;
                    return (
                      <span className={`text-center font-semibold text-sm ${showModel ? scoreColor(rd.model.winner) : 'text-pulse-text-3'}`}>
                        {showModel ? `${rd.model.f1Score}–${rd.model.f2Score}` : '—'}
                      </span>
                    );
                  })()}

                  {/* Match icon */}
                  <span className="text-center text-sm">
                    {rd.isMatch === true && <span className="text-pulse-green">✓</span>}
                    {rd.isMatch === false && <span className="text-pulse-amber">●</span>}
                  </span>
                </div>

                {/* Expanded individual judges */}
                {expandedRounds.has(rd.round) && rd.judges.length > 0 && (
                  <div className="px-5 py-2 bg-pulse-surface-2/40 border-b border-white/[0.06]">
                    {rd.judges.map(j => {
                      const jWinner = j.f1Score > j.f2Score ? 'f1' : j.f2Score > j.f1Score ? 'f2' : 'draw';
                      return (
                        <div key={j.judgeName} className="flex items-center justify-between py-1.5 text-xs">
                          <span className="text-pulse-text-2">{j.judgeName.split(' ').pop()}</span>
                          <span className={`font-bold ${scoreColor(jWinner)}`}>{j.f1Score}–{j.f2Score}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}

            {/* Total row */}
            <div className="grid grid-cols-[44px_1fr_1fr_1fr_32px] px-3.5 py-3 bg-pulse-surface-2 items-center">
              <span className="font-heading font-semibold text-[13px] text-pulse-text-2">TOT</span>
              <span className={`text-center font-heading font-bold text-base ${scoreColor(userTotal.f1 > userTotal.f2 ? 'f1' : userTotal.f2 > userTotal.f1 ? 'f2' : null)}`}>
                {userTotal.f1}–{userTotal.f2}
              </span>
              <span className={`text-center font-heading font-bold text-base ${scoreColor(judgeMajF1 > judgeMajF2 ? 'f1' : judgeMajF2 > judgeMajF1 ? 'f2' : null)}`}>
                {judgeMajF1 > 0 ? `${judgeMajF1}–${judgeMajF2}` : '—'}
              </span>
              <span className={`text-center font-heading font-bold text-base ${hasModelTotal ? scoreColor(modelF1 > modelF2 ? 'f1' : modelF2 > modelF1 ? 'f2' : null) : 'text-pulse-text-3'}`}>
                {hasModelTotal ? `${modelF1}–${modelF2}` : '—'}
              </span>
              <span />
            </div>
          </div>

          {/* Match Summary with Accuracy Ring */}
          {totalWithJudges > 0 && (
            <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-5 mb-4 flex items-center gap-5">
              {/* Accuracy Ring */}
              <div className="w-20 h-20 relative flex-shrink-0">
                <svg viewBox="0 0 80 80" className="w-20 h-20" style={{ transform: 'rotate(-90deg)' }}>
                  <circle cx="40" cy="40" r="36" fill="none" stroke="#24242e" strokeWidth="6" />
                  <circle
                    cx="40" cy="40" r="36" fill="none"
                    stroke="#22c55e" strokeWidth="6" strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashoffset}
                    style={{ transition: 'stroke-dashoffset 1s ease' }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center font-heading font-extrabold text-[22px] text-pulse-green">
                  {matchPct}%
                </div>
              </div>

              {/* Description */}
              <div>
                <div className="font-heading font-bold text-base mb-1">
                  {matchCount} of {totalWithJudges} Rounds Matched
                </div>
                <p className="text-[13px] text-pulse-text-2 leading-relaxed">
                  {matchDescription}
                </p>
              </div>
            </div>
          )}

          {/* Result Card */}
          <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-5 text-center">
            <div className="text-[11px] text-pulse-text-3 uppercase tracking-wider mb-2">Official Result</div>
            {fight.winner ? (
              <>
                <div className={`font-heading font-bold text-lg ${scoreColor(winnerSide)}`}>
                  {fight.winner} Wins
                </div>
                <div className="text-[13px] text-pulse-text-2 mt-1">
                  {meta.method}{judgeScoreStrings.length > 0 && ` · ${judgeScoreStrings.join(', ')}`}
                </div>
              </>
            ) : (
              <div className="font-heading font-bold text-lg text-pulse-text-2">
                {meta.method || 'No Contest'}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default ScorecardComparison;
