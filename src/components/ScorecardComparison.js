import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { dataService } from '../dataService';

// Majority winner for a round: needs 2+ of 3 judges
function roundMajority(judges) {
  if (!judges || judges.length < 2) return null;
  const f1Wins = judges.filter(j => j.f1Score > j.f2Score).length;
  const f2Wins = judges.filter(j => j.f2Score > j.f1Score).length;
  if (f1Wins >= 2) return 'f1';
  if (f2Wins >= 2) return 'f2';
  return null; // split 1-1-1 — no clear majority
}

// Three-column comparison: You | Official judges | Community average.
// hasUserScores is lifted from FightDetailView — gates the reveal.
const ScorecardComparison = ({ fight, rounds, meta, currentTheme, hasUserScores }) => {
  const [userScores, setUserScores] = useState([]);
  const [community, setCommunity] = useState([]);

  // Re-fetch when hasUserScores flips true so scores + community load in
  useEffect(() => {
    if (!hasUserScores) return;
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const [commData, userResult] = await Promise.all([
        dataService.getCommunityScorecard(fight.id),
        user
          ? supabase.from('user_round_scores')
              .select('round, f1_score, f2_score')
              .eq('fight_id', fight.id)
              .eq('user_id', user.id)
          : Promise.resolve({ data: [] }),
      ]);
      setCommunity(commData);
      setUserScores(userResult.data || []);
    };
    load();
  }, [fight.id, hasUserScores]);

  if (!rounds || rounds.length === 0) return null;

  const f1Last = meta.fighter1_name.split(' ').pop();
  const f2Last = meta.fighter2_name.split(' ').pop();

  const userTotal = userScores.reduce(
    (acc, s) => ({ f1: acc.f1 + s.f1_score, f2: acc.f2 + s.f2_score }),
    { f1: 0, f2: 0 }
  );
  const commTotal = community.reduce(
    (acc, s) => ({ f1: acc.f1 + parseFloat(s.f1_avg), f2: acc.f2 + parseFloat(s.f2_avg) }),
    { f1: 0, f2: 0 }
  );

  return (
    <div className={`${currentTheme.card} rounded-xl border mb-6 shadow-lg overflow-hidden`}>
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 bg-black/30 border-b border-white/10">
        <p className="text-xs font-black uppercase tracking-widest opacity-60">Scorecard Comparison</p>
      </div>

      {/* Pre-scoring prompt */}
      {!hasUserScores && (
        <div className="p-6 text-center">
          <p className="text-xs opacity-40 uppercase tracking-widest">Score this fight to reveal the comparison</p>
        </div>
      )}

      {hasUserScores && (
      <div className="p-4 sm:p-6">
        {/* Fighter name headers */}
        <div className="grid grid-cols-3 text-xs opacity-40 uppercase tracking-widest mb-4">
          <span className="font-bold">{f1Last}</span>
          <span className="text-center" />
          <span className="text-right font-bold">{f2Last}</span>
        </div>

        {/* Per-round rows */}
        {rounds.map(rd => {
          const userRow = userScores.find(s => s.round === rd.round);
          const commRow = community.find(s => s.round === rd.round);
          const majority = roundMajority(rd.judges);

          const userWinner = userRow
            ? (userRow.f1_score > userRow.f2_score ? 'f1'
              : userRow.f2_score > userRow.f1_score ? 'f2' : 'draw')
            : null;
          const commWinner = commRow
            ? (parseFloat(commRow.f1_avg) > parseFloat(commRow.f2_avg) ? 'f1'
              : parseFloat(commRow.f2_avg) > parseFloat(commRow.f1_avg) ? 'f2' : 'draw')
            : null;

          const userColor = majority
            ? (userWinner === majority ? 'text-green-400' : 'text-red-400')
            : '';
          const commColor = majority
            ? (commWinner === majority ? 'text-green-400' : 'text-red-400')
            : 'opacity-50';

          return (
            <div key={rd.round} className="mb-4 pb-4 border-b border-white/10 last:border-0 last:mb-0 last:pb-0">
              <p className="text-xs opacity-40 uppercase tracking-widest mb-2">Round {rd.round}</p>

              {/* Your score */}
              {userRow ? (
                <div className={`grid grid-cols-3 items-center text-xs mb-1 font-bold ${userColor}`}>
                  <span>{userRow.f1_score}</span>
                  <span className="text-center opacity-70">You</span>
                  <span className="text-right">{userRow.f2_score}</span>
                </div>
              ) : (
                <div className="grid grid-cols-3 items-center text-xs mb-1 opacity-25">
                  <span>—</span>
                  <span className="text-center">You</span>
                  <span className="text-right">—</span>
                </div>
              )}

              {/* ML model prediction */}
              {rd.model.confidence !== null && (
                <div className="grid grid-cols-3 items-center text-xs mb-1 opacity-50">
                  <span className={`font-bold ${rd.model.winner === 'f1' ? 'opacity-100' : ''}`}>
                    {rd.model.f1Score}
                  </span>
                  <span className="text-center">
                    Model ({Math.round(rd.model.confidence * 100)}%)
                  </span>
                  <span className={`text-right font-bold ${rd.model.winner === 'f2' ? 'opacity-100' : ''}`}>
                    {rd.model.f2Score}
                  </span>
                </div>
              )}

              {/* Official judge scores */}
              {rd.judges.map(j => (
                <div key={j.judgeName} className="grid grid-cols-3 items-center text-xs mb-1 opacity-50">
                  <span className={`font-bold ${j.f1Score > j.f2Score ? 'opacity-100' : ''}`}>
                    {j.f1Score}
                  </span>
                  <span className="text-center truncate">{j.judgeName.split(' ').pop()}</span>
                  <span className={`text-right font-bold ${j.f2Score > j.f1Score ? 'opacity-100' : ''}`}>
                    {j.f2Score}
                  </span>
                </div>
              ))}

              {/* Community average */}
              {commRow && (
                <div className={`grid grid-cols-3 items-center text-xs mt-1 ${commColor}`}>
                  <span className="font-bold">{parseFloat(commRow.f1_avg).toFixed(1)}</span>
                  <span className="text-center opacity-70">
                    Users Avg ({commRow.user_count})
                  </span>
                  <span className="text-right font-bold">{parseFloat(commRow.f2_avg).toFixed(1)}</span>
                </div>
              )}
            </div>
          );
        })}

        {/* Totals */}
        <div className="mt-4 pt-3 border-t border-white/10 space-y-1">
          <div className="grid grid-cols-3 items-center text-sm">
            <span className={`font-black ${userTotal.f1 > userTotal.f2 ? currentTheme.accent : 'opacity-60'}`}>
              {userTotal.f1}
            </span>
            <span className="text-center text-xs opacity-40 uppercase tracking-wider">Your Total</span>
            <span className={`text-right font-black ${userTotal.f2 > userTotal.f1 ? currentTheme.accent : 'opacity-60'}`}>
              {userTotal.f2}
            </span>
          </div>
          {community.length > 0 && (
            <div className="grid grid-cols-3 items-center text-sm">
              <span className={`font-black ${commTotal.f1 > commTotal.f2 ? currentTheme.accent : 'opacity-60'}`}>
                {commTotal.f1.toFixed(1)}
              </span>
              <span className="text-center text-xs opacity-40 uppercase tracking-wider">Users Avg Total</span>
              <span className={`text-right font-black ${commTotal.f2 > commTotal.f1 ? currentTheme.accent : 'opacity-60'}`}>
                {commTotal.f2.toFixed(1)}
              </span>
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
};

export default ScorecardComparison;
