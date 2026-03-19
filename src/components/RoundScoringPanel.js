import { useState, useEffect } from 'react';
import { dataService } from '../dataService';
import * as guestStorage from '../guestStorage';

const getInitials = (name) => {
  const parts = name.trim().split(' ');
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.substring(0, 2).toUpperCase();
};

const RoundScoringPanel = ({ fight, meta, isLocked, currentTheme, onAllRoundsScored, totalRoundsOverride, isGuest = false }) => {
  const [user, setUser]                   = useState(null);
  const [scores, setScores]               = useState({});   // { [round]: { fighterScoredFor, points } } — from DB
  const [pending, setPending]             = useState({});   // local UI selection
  const [scorecardState, setScorecardState] = useState(null);
  const [judgesRevealed, setJudgesRevealed] = useState(false);
  const [saving, setSaving]               = useState({});   // { [round]: bool }
  const [loaded, setLoaded]               = useState(false);
  const [activeRound, setActiveRound]     = useState(1);

  const isHistorical = fight.status === 'completed';

  const f1Name = meta?.fighter1_name || fight.bout?.split(' vs ')[0]?.trim() || 'Fighter 1';
  const f2Name = meta?.fighter2_name || fight.bout?.split(' vs ')[1]?.trim() || 'Fighter 2';
  const f1Initials = getInitials(f1Name);
  const f2Initials = getInitials(f2Name);
  const f1Last = f1Name.split(' ').pop();
  const f2Last = f2Name.split(' ').pop();

  // Scoreable rounds:
  // - Decisions: all rounds fought (judges scored them all)
  // - Finishes: rounds up to but NOT including the finishing round (that round was partial)
  // - Live: use scheduled rounds from time_format; finish constraint applied post-scrape
  const isDecision = meta?.method?.toLowerCase().includes('decision');
  const roundsFought = parseInt((meta?.round || '').split(' ')[0]) || 0;
  const totalRounds = totalRoundsOverride != null
    ? totalRoundsOverride
    : isHistorical
      ? (isDecision ? roundsFought : Math.max(0, roundsFought - 1))
      : (parseInt(meta?.time_format?.match(/^(\d+)\s*Rnd/)?.[1]) || 3);

  const rounds = Array.from({ length: totalRounds }, (_, i) => i + 1);

  // Post-reveal: read-only only when fight is fully over (isLocked) or historical.
  // Live in-progress fights stay editable between rounds so users can score new rounds
  // even after the previous round's judges have been revealed.
  const readOnly = judgesRevealed && !isHistorical && isLocked;

  // Live fights: scoring closes once ESPN marks fight FINAL; historical always open
  const canSubmit = isHistorical || !isLocked;

  useEffect(() => {
    const load = async () => {
      if (isGuest) {
        const rawScores = guestStorage.getFightScores(fight.id);
        const state = guestStorage.getScorecardState(fight.id);
        const scoresMap = {};
        Object.entries(rawScores).forEach(([round, s]) => {
          const fighterScoredFor = s.f1_score >= s.f2_score ? f1Name : f2Name;
          const points = Math.min(s.f1_score, s.f2_score);
          scoresMap[parseInt(round)] = { fighterScoredFor, points };
        });
        setScores(scoresMap);
        setPending(scoresMap);
        setScorecardState(state);
        setJudgesRevealed(!!state?.judges_revealed_at || isHistorical);
        setUser({ id: 'guest' });
        setLoaded(true);
        return;
      }
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
  }, [fight.id, isHistorical, isGuest]);

  // Set active round to first unscored after loading
  useEffect(() => {
    if (loaded && totalRounds > 0) {
      const firstUnscored = rounds.find(r => !scores[r]);
      setActiveRound(firstUnscored || 1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  const handleReveal = async (currentScores, forfeited) => {
    const allDone = Object.keys(currentScores).length >= totalRounds;
    const scoredBlind = !forfeited && allDone;
    const updates = {
      scored_blind: scoredBlind,
      forfeited,
      judges_revealed_at: new Date().toISOString(),
    };
    if (isGuest) {
      guestStorage.setScorecardState(fight.id, updates);
      setScorecardState(s => ({ ...(s || {}), ...updates }));
      setJudgesRevealed(true);
      return;
    }
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
        if (isGuest) guestStorage.setScorecardState(fight.id, { modified_after_reveal: true });
        else await dataService.upsertScorecardState(fight.id, { modified_after_reveal: true });
        setScorecardState(s => ({ ...(s || {}), modified_after_reveal: true }));
      }
      const f1Score = p.fighterScoredFor === f1Name ? 10 : p.points;
      const f2Score = p.fighterScoredFor === f2Name ? 10 : p.points;
      if (isGuest) guestStorage.setScore(fight.id, round, f1Score, f2Score);
      else await dataService.upsertRoundScore(fight.id, round, f1Score, f2Score);
      const newScores = { ...scores, [round]: p };
      setScores(newScores);
      // Notify parent + auto-reveal when all scoreable rounds submitted.
      // For live fights: only reveal after fight ends (isLocked) to avoid locking
      // inputs mid-fight when more rounds are still coming.
      if (Object.keys(newScores).length >= totalRounds && totalRounds > 0) {
        onAllRoundsScored?.();
        if (!judgesRevealed && (isLocked || isHistorical)) await handleReveal(newScores, false);
      }
    } catch (e) {
      console.error('[RoundScoring] submit error:', e);
    } finally {
      setSaving(s => ({ ...s, [round]: false }));
    }
  };

  const handleScoreClick = (fighter, value) => {
    if (readOnly || !canSubmit) return;
    const otherFighter = fighter === f1Name ? f2Name : f1Name;
    setPending(prev => {
      if (value === 10) {
        const currentPoints = prev[activeRound]?.fighterScoredFor === fighter
          ? prev[activeRound]?.points : 9;
        return { ...prev, [activeRound]: { fighterScoredFor: fighter, points: currentPoints } };
      }
      return { ...prev, [activeRound]: { fighterScoredFor: otherFighter, points: value } };
    });
  };

  const handleLockRound = async () => {
    await handleSubmitRound(activeRound);
    // Auto-advance to next unscored round
    const next = rounds.find(r => r > activeRound && !scores[r])
      || rounds.find(r => r !== activeRound && !scores[r]);
    if (next) setActiveRound(next);
  };

  // --- Render guards ---
  if (!loaded) return null;
  if (!user) return null;
  if (totalRounds === 0) return null;

  const scoredCount = Object.keys(scores).length;
  const p = pending[activeRound] || { fighterScoredFor: null, points: 9 };
  const saved = scores[activeRound];
  const isDirty = !saved
    || p.fighterScoredFor !== saved.fighterScoredFor
    || p.points !== saved.points;
  const isSaving = !!saving[activeRound];

  // Active round scores for display
  const f1ActiveScore = p.fighterScoredFor ? (p.fighterScoredFor === f1Name ? 10 : p.points) : null;
  const f2ActiveScore = p.fighterScoredFor ? (p.fighterScoredFor === f2Name ? 10 : p.points) : null;

  // Running totals from saved scores
  let f1Total = 0, f2Total = 0;
  Object.values(scores).forEach(s => {
    f1Total += s.fighterScoredFor === f1Name ? 10 : s.points;
    f2Total += s.fighterScoredFor === f2Name ? 10 : s.points;
  });

  const eligibilityNote = (() => {
    if (!judgesRevealed) return null;
    if (scorecardState?.leaderboard_eligible) return { text: '✓ Eligible', positive: true };
    if (isHistorical) return null;
    if (scorecardState?.forfeited) return { text: 'Ineligible — forfeited', positive: false };
    if (scorecardState?.modified_after_reveal) return { text: 'Ineligible — edited after reveal', positive: false };
    return { text: 'Ineligible', positive: false };
  })();

  return (
    <div className="mb-6">
      {/* Fighter Header */}
      <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-4 mb-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col items-center flex-1">
            <div className="w-[52px] h-[52px] rounded-full border-[3px] border-pulse-red bg-pulse-red/[0.08] flex items-center justify-center font-heading font-bold text-lg text-pulse-text mb-1.5">
              {f1Initials}
            </div>
            <div className="font-heading font-bold text-sm uppercase tracking-wide text-center leading-tight">
              {f1Last}
            </div>
          </div>
          <div className="font-heading font-extrabold text-sm text-pulse-text-3 tracking-wider px-2">VS</div>
          <div className="flex flex-col items-center flex-1">
            <div className="w-[52px] h-[52px] rounded-full border-[3px] border-pulse-blue bg-pulse-blue/[0.08] flex items-center justify-center font-heading font-bold text-lg text-pulse-text mb-1.5">
              {f2Initials}
            </div>
            <div className="font-heading font-bold text-sm uppercase tracking-wide text-center leading-tight">
              {f2Last}
            </div>
          </div>
        </div>
        {eligibilityNote && (
          <div className="mt-3 pt-3 border-t border-white/[0.06] text-center">
            <span className={`text-xs font-semibold uppercase tracking-wider ${eligibilityNote.positive ? 'text-pulse-green' : 'text-pulse-text-3'}`}>
              {eligibilityNote.text}
            </span>
          </div>
        )}
      </div>

      {/* Round Selector */}
      <div className="flex gap-2 px-1 py-3 overflow-x-auto" style={{ scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch' }}>
        {rounds.map(round => {
          const isActive = round === activeRound;
          const roundScore = scores[round];
          const isF1Winner = roundScore?.fighterScoredFor === f1Name;

          let bgClass, borderColor, textClass;
          if (roundScore) {
            bgClass = isF1Winner ? 'bg-pulse-red/[0.08]' : 'bg-pulse-blue/[0.08]';
            borderColor = isF1Winner ? 'border-pulse-red' : 'border-pulse-blue';
            textClass = isF1Winner ? 'text-pulse-red' : 'text-pulse-blue';
          } else {
            bgClass = 'bg-pulse-surface';
            borderColor = 'border-white/[0.06]';
            textClass = 'text-pulse-text-3';
          }

          return (
            <button
              key={round}
              onClick={() => setActiveRound(round)}
              className={`w-12 h-12 rounded-card flex items-center justify-center font-heading font-bold text-sm flex-shrink-0 transition-all
                ${bgClass} ${textClass} ${borderColor}
                ${isActive ? 'border-[3px] border-white scale-110 shadow-[0_0_12px_rgba(255,255,255,0.4)]' : 'border-2'}`}
            >
              R{round}
            </button>
          );
        })}
      </div>

      {/* Scoring Panel — Active Round */}
      <div className="bg-pulse-surface border border-white/[0.06] rounded-[16px] p-5 mb-2">
        <div className="font-heading font-bold text-base uppercase tracking-wider text-center mb-5">
          Round {activeRound} — {readOnly ? (
            <span className="text-pulse-text-2">Locked</span>
          ) : (
            <span className="text-pulse-red">Score Blind</span>
          )}
        </div>

        {readOnly ? (
          /* Read-only: show saved score for this round */
          saved ? (
            <div className="flex items-center justify-center gap-6">
              <div className="flex flex-col items-center gap-1">
                <span className="font-heading font-bold text-[13px] uppercase tracking-wide text-pulse-red">{f1Last}</span>
                <div className={`w-[72px] h-[72px] rounded-[16px] flex items-center justify-center font-heading font-extrabold text-[28px]
                  ${saved.fighterScoredFor === f1Name
                    ? 'bg-pulse-red/[0.12] border-2 border-pulse-red text-pulse-text shadow-[0_0_20px_rgba(239,68,68,0.2)]'
                    : 'bg-pulse-surface-2 border-2 border-white/[0.06] text-pulse-text-3'}`}>
                  {saved.fighterScoredFor === f1Name ? 10 : saved.points}
                </div>
              </div>
              <div className="font-heading font-extrabold text-pulse-text-3 text-sm tracking-wider">vs</div>
              <div className="flex flex-col items-center gap-1">
                <span className="font-heading font-bold text-[13px] uppercase tracking-wide text-pulse-blue">{f2Last}</span>
                <div className={`w-[72px] h-[72px] rounded-[16px] flex items-center justify-center font-heading font-extrabold text-[28px]
                  ${saved.fighterScoredFor === f2Name
                    ? 'bg-pulse-blue/[0.12] border-2 border-pulse-blue text-pulse-text shadow-[0_0_20px_rgba(59,130,246,0.2)]'
                    : 'bg-pulse-surface-2 border-2 border-white/[0.06] text-pulse-text-3'}`}>
                  {saved.fighterScoredFor === f2Name ? 10 : saved.points}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-pulse-text-3 text-center">Not scored</p>
          )
        ) : (
          /* Editable — two-column score grid */
          <>
            <div className="grid grid-cols-2 gap-4">
              {/* Fighter 1 column */}
              <div className="flex flex-col items-center gap-2">
                <span className="font-heading font-bold text-[13px] uppercase tracking-wide text-pulse-red mb-1">{f1Last}</span>
                {[10, 9, 8].map(val => {
                  const isSelected = f1ActiveScore === val;
                  return (
                    <button
                      key={val}
                      disabled={!canSubmit}
                      onClick={() => handleScoreClick(f1Name, val)}
                      className={`w-[72px] h-[72px] rounded-[16px] flex items-center justify-center font-heading font-extrabold text-[28px] transition-all
                        ${isSelected
                          ? 'bg-pulse-red/[0.12] border-2 border-pulse-red text-pulse-text shadow-[0_0_20px_rgba(239,68,68,0.2)]'
                          : 'bg-pulse-surface-2 border-2 border-white/[0.06] text-pulse-text-3 hover:border-white/[0.15]'
                        } disabled:opacity-40`}
                    >
                      {val}
                    </button>
                  );
                })}
              </div>

              {/* Fighter 2 column */}
              <div className="flex flex-col items-center gap-2">
                <span className="font-heading font-bold text-[13px] uppercase tracking-wide text-pulse-blue mb-1">{f2Last}</span>
                {[10, 9, 8].map(val => {
                  const isSelected = f2ActiveScore === val;
                  return (
                    <button
                      key={val}
                      disabled={!canSubmit}
                      onClick={() => handleScoreClick(f2Name, val)}
                      className={`w-[72px] h-[72px] rounded-[16px] flex items-center justify-center font-heading font-extrabold text-[28px] transition-all
                        ${isSelected
                          ? 'bg-pulse-blue/[0.12] border-2 border-pulse-blue text-pulse-text shadow-[0_0_20px_rgba(59,130,246,0.2)]'
                          : 'bg-pulse-surface-2 border-2 border-white/[0.06] text-pulse-text-3 hover:border-white/[0.15]'
                        } disabled:opacity-40`}
                    >
                      {val}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Lock Round button */}
            {p.fighterScoredFor && canSubmit && isDirty && (
              <button
                onClick={handleLockRound}
                disabled={isSaving}
                className="w-full mt-5 py-3.5 font-heading font-bold text-base uppercase tracking-wider bg-pulse-red text-white rounded-card transition-all active:scale-[0.98] disabled:opacity-40"
              >
                {isSaving ? 'Saving…' : saved ? 'Update Round' : 'Lock Round'}
              </button>
            )}
            {/* Saved confirmation */}
            {saved && !isDirty && (
              <p className="mt-4 text-xs text-pulse-text-3 text-center tracking-wider">
                {isGuest ? '✓ Saved locally' : '✓ Saved'}
              </p>
            )}
          </>
        )}
      </div>

      {/* Scored Rounds Summary */}
      <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-3.5 mb-2">
        <div className="font-heading font-bold text-[13px] uppercase text-pulse-text-2 tracking-wider mb-3">Your Scorecard</div>
        <div className="flex gap-2 justify-center">
          {rounds.map(round => {
            const s = scores[round];
            if (!s) return (
              <div key={round} className="flex flex-col items-center gap-1">
                <div className="text-[10px] text-pulse-text-3 font-semibold">R{round}</div>
                <div className="font-heading font-bold text-sm py-1.5 px-2.5 rounded-lg bg-transparent border border-dashed border-white/[0.15] text-pulse-text-3 min-w-[52px] text-center">
                  --
                </div>
              </div>
            );
            const sf1 = s.fighterScoredFor === f1Name ? 10 : s.points;
            const sf2 = s.fighterScoredFor === f2Name ? 10 : s.points;
            const isF1 = s.fighterScoredFor === f1Name;
            return (
              <div key={round} className="flex flex-col items-center gap-1">
                <div className="text-[10px] text-pulse-text-3 font-semibold">R{round}</div>
                <div className={`font-heading font-bold text-sm py-1.5 px-2.5 rounded-lg bg-pulse-surface-2 min-w-[52px] text-center
                  ${isF1 ? 'text-pulse-red border border-pulse-red/20' : 'text-pulse-blue border border-pulse-blue/20'}`}>
                  {sf1}-{sf2}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Running Total */}
      {scoredCount > 0 && (
        <div className="text-center py-4">
          <div className="text-[11px] text-pulse-text-3 uppercase tracking-wider mb-1">Your Score</div>
          <div className="font-heading font-extrabold text-[32px] tracking-wider">
            <span className="text-pulse-red">{f1Total}</span>
            <span className="text-pulse-text-3 mx-1">–</span>
            <span className="text-pulse-blue">{f2Total}</span>
          </div>
        </div>
      )}

      {/* Submit / Progress / Forfeit */}
      {!judgesRevealed && (
        <div className="px-0 pb-2">
          {scoredCount >= totalRounds && totalRounds > 0 ? (
            <button
              onClick={() => handleReveal(scores, false)}
              className="w-full py-4 font-heading font-bold text-base uppercase tracking-wider bg-pulse-red text-white rounded-card transition-all active:scale-[0.98]"
            >
              Submit Full Scorecard
            </button>
          ) : (
            <div className="w-full py-4 font-heading font-bold text-base uppercase tracking-wider bg-pulse-surface-2 text-pulse-text-3 border-2 border-dashed border-white/[0.06] rounded-card text-center">
              Submit Scorecard ({totalRounds - scoredCount} remaining)
            </div>
          )}
          {!isLocked && !isHistorical && (
            <button
              onClick={() => handleReveal(scores, true)}
              className="w-full mt-2 text-xs text-pulse-text-3 hover:text-pulse-text-2 underline text-center py-1 transition-colors"
            >
              Forfeit & view judges
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default RoundScoringPanel;
