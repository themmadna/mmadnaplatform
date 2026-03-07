import { useState, useEffect } from 'react';
import { dataService } from '../dataService';

const RoundScoringPanel = ({ fight, meta, isLocked, currentTheme, onAllRoundsScored }) => {
  const [user, setUser]                   = useState(null);
  const [scores, setScores]               = useState({});   // { [round]: { fighterScoredFor, points } } — from DB
  const [pending, setPending]             = useState({});   // local UI selection
  const [scorecardState, setScorecardState] = useState(null);
  const [judgesRevealed, setJudgesRevealed] = useState(false);
  const [saving, setSaving]               = useState({});   // { [round]: bool }
  const [loaded, setLoaded]               = useState(false);

  const isHistorical = fight.status === 'completed';

  const f1Name = meta?.fighter1_name || fight.bout?.split(' vs ')[0]?.trim() || 'Fighter 1';
  const f2Name = meta?.fighter2_name || fight.bout?.split(' vs ')[1]?.trim() || 'Fighter 2';

  // Scoreable rounds:
  // - Decisions: all rounds fought (judges scored them all)
  // - Finishes: rounds up to but NOT including the finishing round (that round was partial)
  // - Live: use scheduled rounds from time_format; finish constraint applied post-scrape
  const isDecision = meta?.method?.toLowerCase().includes('decision');
  const roundsFought = parseInt((meta?.round || '').split(' ')[0]) || 0;
  const totalRounds = isHistorical
    ? (isDecision ? roundsFought : Math.max(0, roundsFought - 1))
    : (parseInt(meta?.time_format?.match(/^(\d+)\s*Rnd/)?.[1]) || 3);

  // Post-reveal: read-only for live fights (inputs lock after judges shown)
  // Historical fights stay editable (but mark modified_after_reveal on save)
  const readOnly = judgesRevealed && !isHistorical;

  // Live fights: scoring closes once ESPN marks fight FINAL; historical always open
  const canSubmit = isHistorical || !isLocked;

  useEffect(() => {
    const load = async () => {
      const { user: u, scores: rawScores, scorecardState: state } =
        await dataService.getUserScoringData(fight.id);
      setUser(u);
      if (u) {
        const scoresMap = {};
        (rawScores || []).forEach(s => {
          const fighterScoredFor = s.f1_score >= s.f2_score ? f1Name : f2Name;
          const points = Math.min(s.f1_score, s.f2_score);
          scoresMap[s.round] = { fighterScoredFor, points };
        });
        setScores(scoresMap);
        setPending(scoresMap);
        setScorecardState(state);
        setJudgesRevealed(!!state?.judges_revealed_at || isHistorical);
      }
      setLoaded(true);
    };
    load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fight.id, isHistorical]);

  const handleReveal = async (currentScores, forfeited) => {
    const allDone = Object.keys(currentScores).length >= totalRounds;
    const scoredBlind = !forfeited && allDone;
    const updates = {
      scored_blind: scoredBlind,
      forfeited,
      judges_revealed_at: new Date().toISOString(),
    };
    try {
      await dataService.upsertScorecardState(fight.id, updates);
      setScorecardState(s => ({ ...(s || {}), ...updates }));
      setJudgesRevealed(true);
    } catch (e) {
      console.error('[RoundScoring] reveal error:', e);
    }
  };

  const handleSubmitRound = async (round) => {
    const p = pending[round];
    if (!p?.fighterScoredFor) return;
    setSaving(s => ({ ...s, [round]: true }));
    try {
      // Post-reveal edit on historical fight → mark ineligible
      if (judgesRevealed) {
        await dataService.upsertScorecardState(fight.id, { modified_after_reveal: true });
        setScorecardState(s => ({ ...(s || {}), modified_after_reveal: true }));
      }
      const f1Score = p.fighterScoredFor === f1Name ? 10 : p.points;
      const f2Score = p.fighterScoredFor === f2Name ? 10 : p.points;
      await dataService.upsertRoundScore(fight.id, round, f1Score, f2Score);
      const newScores = { ...scores, [round]: p };
      setScores(newScores);
      // Notify parent + auto-reveal when all scoreable rounds submitted
      if (Object.keys(newScores).length >= totalRounds) {
        onAllRoundsScored?.();
        if (!judgesRevealed) await handleReveal(newScores, false);
      }
    } catch (e) {
      console.error('[RoundScoring] submit error:', e);
    } finally {
      setSaving(s => ({ ...s, [round]: false }));
    }
  };

  // --- Render guards ---
  if (!loaded) return null;
  if (!user) return null; // app requires login; shouldn't reach here
  if (totalRounds === 0) return null;

  const scoredCount = Object.keys(scores).length;

  const eligibilityNote = (() => {
    if (!judgesRevealed) return null;
    if (scorecardState?.leaderboard_eligible) return { text: '✓ Eligible', positive: true };
    if (isHistorical) return null;
    if (scorecardState?.forfeited) return { text: 'Ineligible — forfeited', positive: false };
    if (scorecardState?.modified_after_reveal) return { text: 'Ineligible — edited after reveal', positive: false };
    return { text: 'Ineligible', positive: false };
  })();

  return (
    <div className={`${currentTheme.card} rounded-xl border shadow-lg overflow-hidden mb-6`}>
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 bg-black/30 border-b border-white/10 flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-widest opacity-60">Your Scorecard</p>
        {eligibilityNote && (
          <span className={`text-xs uppercase tracking-widest ${eligibilityNote.positive ? 'text-green-400' : 'opacity-30'}`}>
            {eligibilityNote.text}
          </span>
        )}
      </div>

      <div className="p-4 sm:p-6">
        {/* Fighter header */}
        <div className="grid grid-cols-3 text-xs opacity-40 uppercase tracking-widest mb-4">
          <span className="font-bold">{f1Name.split(' ').pop()}</span>
          <span className="text-center"></span>
          <span className="text-right font-bold">{f2Name.split(' ').pop()}</span>
        </div>

        {/* Round rows */}
        {Array.from({ length: totalRounds }, (_, i) => i + 1).map(round => {
          const saved = scores[round];
          const p = pending[round] || { fighterScoredFor: null, points: 9 };
          const isSaving = !!saving[round];
          // Only show save button when selection differs from what's already in DB
          const isDirty = !saved
            || p.fighterScoredFor !== saved.fighterScoredFor
            || p.points !== saved.points;

          return (
            <div key={round} className="mb-5 pb-5 border-b border-white/10 last:border-0 last:mb-0 last:pb-0">
              <p className="text-xs opacity-40 uppercase tracking-widest mb-2">Round {round}</p>

              {readOnly ? (
                /* Read-only display — live fight after judges revealed */
                saved ? (
                  <div className="grid grid-cols-3 items-center text-sm">
                    <span className={`font-bold ${saved.fighterScoredFor === f1Name ? currentTheme.accent : 'opacity-40'}`}>
                      {saved.fighterScoredFor === f1Name ? 10 : saved.points}
                    </span>
                    <span className="text-center text-xs opacity-40 uppercase tracking-wider">You</span>
                    <span className={`text-right font-bold ${saved.fighterScoredFor === f2Name ? currentTheme.accent : 'opacity-40'}`}>
                      {saved.fighterScoredFor === f2Name ? 10 : saved.points}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs opacity-30 text-center">Not scored</p>
                )
              ) : (
                /* Editable — historical fights + pre-reveal live */
                <>
                  {/* Winner selection */}
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    {[f1Name, f2Name].map(name => (
                      <button
                        key={name}
                        disabled={!canSubmit}
                        onClick={() => setPending(prev => ({
                          ...prev,
                          [round]: { fighterScoredFor: name, points: prev[round]?.points ?? 9 },
                        }))}
                        className={`py-2 px-3 rounded-lg text-xs font-bold border transition-all ${
                          p.fighterScoredFor === name
                            ? `${currentTheme.primary} border-transparent text-white`
                            : 'border-white/20 opacity-50 hover:opacity-80'
                        }`}
                      >
                        {name.split(' ').pop()}
                      </button>
                    ))}
                  </div>

                  {/* Points selection — loser's score */}
                  {p.fighterScoredFor && (
                    <div className="flex gap-2 mb-2">
                      {[9, 8, 7].map(pts => (
                        <button
                          key={pts}
                          onClick={() => setPending(prev => ({
                            ...prev,
                            [round]: { ...prev[round], points: pts },
                          }))}
                          className={`flex-1 py-1 rounded text-xs font-bold border transition-all ${
                            p.points === pts
                              ? `${currentTheme.primary} border-transparent text-white`
                              : 'border-white/20 opacity-50 hover:opacity-80'
                          }`}
                        >
                          10-{pts}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Save button — only when selection differs from saved */}
                  {p.fighterScoredFor && canSubmit && isDirty && (
                    <button
                      onClick={() => handleSubmitRound(round)}
                      disabled={isSaving}
                      className={`w-full py-2 rounded-lg text-xs font-black uppercase tracking-wider ${currentTheme.primary} text-white opacity-90 hover:opacity-100 transition-opacity disabled:opacity-40`}
                    >
                      {isSaving ? 'Saving…' : saved ? 'Update' : 'Submit'}
                    </button>
                  )}
                  {/* Quiet saved confirmation when pending matches DB */}
                  {saved && !isDirty && (
                    <p className="text-xs opacity-30 text-center tracking-widest">✓ Saved</p>
                  )}
                </>
              )}
            </div>
          );
        })}

        {/* Footer: progress + forfeit */}
        {!judgesRevealed && (
          <div className="mt-4 pt-3 border-t border-white/10 flex items-center justify-between">
            <span className="text-xs opacity-40">{scoredCount}/{totalRounds} rounds scored</span>
            {!isLocked && !isHistorical && (
              <button
                onClick={() => handleReveal(scores, true)}
                className="text-xs opacity-40 hover:opacity-70 underline"
              >
                Forfeit & view judges
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default RoundScoringPanel;
