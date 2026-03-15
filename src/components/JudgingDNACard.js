import { useState } from 'react';
import { Scale, ChevronRight } from 'lucide-react';

const MIN_ROUNDS = 5;

// weight_class_clean is already stripped — just return as-is
const shortClass = (wc) => wc || '—';

const lastName = (name) => name ? name.split(' ').pop() : '?';
const normN = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const Stat = ({ label, value, sub, big = false }) => (
  <div className="text-center">
    <p className={`font-black leading-none ${big ? 'text-3xl sm:text-4xl' : 'text-xl sm:text-2xl'}`}>
      {value ?? '—'}
    </p>
    <p className="text-[10px] uppercase tracking-widest opacity-40 mt-1">{label}</p>
    {sub && <p className="text-[10px] opacity-25 mt-0.5">{sub}</p>}
  </div>
);

const Pct = ({ value, big = false }) => {
  const display = value !== null && value !== undefined ? `${Math.round(value * 100)}%` : '—';
  return (
    <span className={`font-black leading-none ${big ? 'text-3xl sm:text-4xl' : 'text-xl sm:text-2xl'}`}>
      {display}
    </span>
  );
};

// Stacked horizontal bar for agreement breakdown
const AgreementBar = ({ breakdown }) => {
  if (!breakdown || !breakdown.total) return null;
  const segments = [
    { key: 'all3',          pct: breakdown.all3_pct,  label: 'All 3',    color: 'bg-green-500' },
    { key: 'two_of_three',  pct: breakdown.two_pct,   label: '2 of 3',   color: 'bg-emerald-400' },
    { key: 'one_of_three',  pct: breakdown.one_pct,   label: '1 of 3',   color: 'bg-amber-400' },
    { key: 'lone_dissenter',pct: breakdown.lone_pct,  label: 'None',     color: 'bg-red-500' },
  ];

  return (
    <div className="space-y-2">
      {/* Stacked bar */}
      <div className="flex h-3 rounded-full overflow-hidden gap-px">
        {segments.map(s =>
          (s.pct || 0) > 0 ? (
            <div
              key={s.key}
              className={`${s.color} transition-all duration-700`}
              style={{ width: `${Math.round((s.pct || 0) * 100)}%` }}
            />
          ) : null
        )}
      </div>
      {/* Labels — same widths as bar segments so they align */}
      <div className="flex">
        {segments.map(s =>
          (s.pct || 0) > 0 ? (
            <div
              key={s.key}
              className="text-center overflow-hidden min-w-0"
              style={{ width: `${Math.round((s.pct || 0) * 100)}%` }}
            >
              <p className="text-[10px] font-bold opacity-70 truncate">
                {Math.round(s.pct * 100)}%
              </p>
              <p className="text-[9px] uppercase tracking-wide opacity-35 truncate">{s.label}</p>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
};

// Two-tone bar: blue for striking, amber for grappling.
// strikePct / grapplingPct are independent (not complementary) so the bar
// shows relative lean (normalized), while labels show the raw percentages.
const SplitBar = ({ strikePct, grapplingPct }) => {
  if (strikePct == null) return <span className="text-xs opacity-30">—</span>;
  const s = Math.round((strikePct || 0) * 100);
  const g = Math.round((grapplingPct || 0) * 100);
  const total = s + g || 1;
  const sBar = Math.round((s / total) * 100);
  const gBar = 100 - sBar;
  return (
    <div className="space-y-1.5">
      <div className="flex h-2 rounded-full overflow-hidden gap-[2px]">
        {sBar > 0 && <div className="bg-blue-500 transition-all duration-700" style={{ width: `${sBar}%` }} />}
        {gBar > 0 && <div className="bg-amber-500 transition-all duration-700" style={{ width: `${gBar}%` }} />}
      </div>
      <div className="flex justify-between text-[9px] opacity-40">
        <span>{sBar}% striking</span>
        <span>{gBar}% grappling</span>
      </div>
    </div>
  );
};

const JudgingDNACard = ({ profile, currentTheme, scoredFights = [], onFightClick = null, onCompareWithJudge = null }) => {
  const [showBiasByClass, setShowBiasByClass] = useState(false);
  const [showScoredFights, setShowScoredFights] = useState(false);

  if (!profile) return null;

  const {
    fights_scored,
    rounds_scored,
    rounds_matched,
    accuracy,
    outlier_rate,
    agreement_breakdown,
    ten_eight_rate,
    ten_eight_quality,
    accuracy_by_class,
    judges,
    striking_vs_grappling_bias,
    aggressor_bias,
    takedown_quality_bias,
    knockdown_bias,
  } = profile;

  if ((rounds_scored || 0) < MIN_ROUNDS) {
    return (
      <div className={`p-6 ${currentTheme.rounded} border border-dashed ${currentTheme.card} opacity-50 text-center mb-6`}>
        <Scale className="mx-auto mb-2 opacity-50" />
        <p className="text-sm">
          Score {MIN_ROUNDS - (rounds_scored || 0)} more round{MIN_ROUNDS - (rounds_scored || 0) === 1 ? '' : 's'} to unlock your Judging DNA
        </p>
      </div>
    );
  }

  const closestJudge = judges?.[0] || null;
  const topClasses = (accuracy_by_class || []).slice(0, 5);
  const hasBiasData = striking_vs_grappling_bias?.rounds > 0;

  return (
    <div className={`${currentTheme.card} ${currentTheme.rounded} shadow-sm overflow-hidden mb-6`}>
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 bg-black/30 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Scale size={14} className="opacity-50" />
          <p className="text-xs font-black uppercase tracking-widest opacity-60">Judging DNA</p>
        </div>
        <span className="text-xs opacity-30 uppercase tracking-widest">
          {rounds_scored} rounds scored
        </span>
      </div>

      <div className="p-4 sm:p-6 space-y-6">

        {/* Overview strip — 4 key stats */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Accuracy" value={<Pct value={accuracy} />} sub="vs judge majority" big />
          <Stat label="Outlier Rate" value={<Pct value={outlier_rate} />} sub="lone dissenter rounds" />
          <Stat label="Rounds Matched" value={rounds_matched} sub="with judge data" />
          <Stat label="Fights Scored" value={fights_scored} />
        </div>

        {/* Agreement breakdown */}
        <div className="border-t border-white/10 pt-5">
          <p className="text-xs opacity-40 uppercase tracking-widest mb-3">Judge Agreement</p>
          <AgreementBar breakdown={agreement_breakdown} />
          <p className="text-[10px] opacity-20 mt-2 text-center">
            How many of the 3 judges agree with your pick per round
          </p>
        </div>

        {/* 10-8 section */}
        <div className="border-t border-white/10 pt-5">
          <p className="text-xs opacity-40 uppercase tracking-widest mb-3">10-8 Rounds</p>
          <div className="flex items-center justify-around">
            <div className="text-center">
              <Pct value={ten_eight_rate} big />
              <p className="text-[10px] uppercase tracking-widest opacity-40 mt-1">Your Rate</p>
              <p className="text-[10px] opacity-25">how often you give 10-8s</p>
            </div>
            <div className="w-px h-12 bg-white/10" />
            <div className="text-center">
              <Pct value={ten_eight_quality} big />
              <p className="text-[10px] uppercase tracking-widest opacity-40 mt-1">Judge Confirmed</p>
              <p className="text-[10px] opacity-25">judges also scored dominant</p>
            </div>
          </div>
        </div>

        {/* Judge matches */}
        {judges && judges.length > 0 && (
          <div className="border-t border-white/10 pt-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs opacity-40 uppercase tracking-widest">Judge Match</p>
              {onCompareWithJudge && (
                <span className="text-[10px] opacity-30 uppercase tracking-widest">tap to compare</span>
              )}
            </div>
            <div className="space-y-1">
              {judges.slice(0, 3).map(j => (
                <div
                  key={j.name}
                  onClick={() => onCompareWithJudge?.(j.name)}
                  className={`flex items-center justify-between py-2 px-3 rounded-lg transition-colors ${onCompareWithJudge ? 'cursor-pointer hover:bg-white/5' : ''}`}
                >
                  <div>
                    <p className="text-sm font-bold">{j.name}</p>
                    <p className="text-xs opacity-30">{j.rounds} rounds shared</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="text-right">
                      <Pct value={j.agreement_pct} />
                      <p className="text-[10px] opacity-30 mt-0.5">agreement</p>
                    </div>
                    {onCompareWithJudge && <ChevronRight size={14} className="opacity-20 flex-shrink-0" />}
                  </div>
                </div>
              ))}
            </div>
            {onCompareWithJudge && (
              <button
                onClick={() => onCompareWithJudge(null)}
                className="mt-3 w-full text-center text-[10px] opacity-30 hover:opacity-60 uppercase tracking-widest transition-opacity"
              >
                Compare vs any judge ›
              </button>
            )}
          </div>
        )}

        {/* Accuracy by weight class */}
        {topClasses.length > 0 && (
          <div className="border-t border-white/10 pt-5">
            <p className="text-xs opacity-40 uppercase tracking-widest mb-3">By Weight Class</p>
            <div className="space-y-2.5">
              {/* Column headers */}
              <div className="flex items-center gap-2 text-[9px] uppercase tracking-widest opacity-25 pb-1">
                <span className="w-32 flex-shrink-0">Division</span>
                <span className="flex-1">Accuracy</span>
                <span className="w-8 text-right">Acc</span>
                <span className="w-8 text-right">Rds</span>
                <span className="w-12 text-right">Avg loser</span>
              </div>
              {topClasses.map(wc => (
                <div key={wc.weight_class_clean || wc.weight_class} className="flex items-center gap-2">
                  <span className="text-xs opacity-50 w-20 truncate flex-shrink-0">
                    {shortClass(wc.weight_class_clean || wc.weight_class)}
                  </span>
                  <div className="flex-1 bg-black/30 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full ${currentTheme.primary} transition-all duration-700`}
                      style={{ width: `${Math.round((wc.accuracy || 0) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold w-8 text-right">
                    {Math.round((wc.accuracy || 0) * 100)}%
                  </span>
                  <span className="text-xs opacity-30 w-8 text-right">{wc.rounds}r</span>
                  <span className="text-xs opacity-40 w-12 text-right font-mono">
                    {wc.avg_loser_score != null ? wc.avg_loser_score.toFixed(1) : '—'}
                  </span>
                </div>
              ))}
              <div className="pt-2 space-y-0.5">
                <p className="text-[9px] opacity-20">Acc — % of rounds matching the judge majority</p>
                <p className="text-[9px] opacity-20">Rds — rounds where judge scorecard data was available</p>
                <p className="text-[9px] opacity-20">Avg loser — your average score for the losing fighter (lower = stricter)</p>
              </div>
            </div>
          </div>
        )}

        {/* Scoring Tendencies (bias stats — requires round_fight_stats data) */}
        {hasBiasData && (
          <div className="border-t border-white/10 pt-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs opacity-40 uppercase tracking-widest">Scoring Tendencies</p>
              {topClasses.some(wc => wc.striking_pct != null) && (
                <button
                  onClick={() => setShowBiasByClass(v => !v)}
                  className="text-[10px] opacity-40 hover:opacity-70 uppercase tracking-widest transition-opacity"
                >
                  {showBiasByClass ? 'Overall ▴' : 'By Class ▾'}
                </button>
              )}
            </div>

            {/* Strike vs Grapple lean */}
            <div className="mb-5">
              <p className="text-[10px] opacity-30 uppercase tracking-widest mb-2">Strike vs Grapple Lean</p>
              {!showBiasByClass ? (
                <SplitBar
                  strikePct={striking_vs_grappling_bias.striking_pct}
                  grapplingPct={striking_vs_grappling_bias.grappling_pct}
                />
              ) : (
                <div className="space-y-3">
                  {topClasses.filter(wc => wc.striking_pct != null).map(wc => (
                    <div key={wc.weight_class_clean} className="flex items-center gap-3">
                      <span className="text-xs opacity-50 w-20 flex-shrink-0 truncate">
                        {shortClass(wc.weight_class_clean)}
                      </span>
                      <div className="flex-1">
                        <SplitBar strikePct={wc.striking_pct} grapplingPct={wc.grappling_pct} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[9px] opacity-20 mt-2">
                Which factor was more dominant in rounds you awarded — striking (sig. strikes) or grappling (takedowns + control)?
              </p>
            </div>

            {/* Aggressor / Passive Control / Knockdown — 3 stats */}
            <div className="grid grid-cols-3 gap-3 border-t border-white/5 pt-4">
              <div className="text-center">
                <Pct value={aggressor_bias} big />
                <p className="text-[10px] uppercase tracking-widest opacity-40 mt-1">Aggressor Lean</p>
                <p className="text-[10px] opacity-20 mt-0.5">sided with higher volume when accuracy favoured opponent</p>
              </div>
              <div className="text-center">
                <Pct value={takedown_quality_bias?.passive_control_pct} big />
                <p className="text-[10px] uppercase tracking-widest opacity-40 mt-1">Passive Control</p>
                <p className="text-[10px] opacity-20 mt-0.5">of control wins had no subs or ground strikes</p>
              </div>
              <div className="text-center">
                <Pct value={knockdown_bias?.kd_bias_pct} big />
                <p className="text-[10px] uppercase tracking-widest opacity-40 mt-1">KD Fighter</p>
                <p className="text-[10px] opacity-20 mt-0.5">
                  sided with knockdown scorer
                  {knockdown_bias?.kd_rounds > 0 ? ` (${knockdown_bias.kd_rounds} KD rds)` : ''}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Scored Fights collapsible */}
        {scoredFights?.length > 0 && (
          <div className="border-t border-white/10 pt-5">
            <button
              onClick={() => setShowScoredFights(v => !v)}
              className="flex items-center justify-between w-full text-left"
            >
              <p className="text-xs opacity-40 uppercase tracking-widest">Scored Fights</p>
              <span className="text-xs opacity-40 flex items-center gap-1">
                {scoredFights.length}
                <ChevronRight size={12} className={`transition-transform duration-200 ${showScoredFights ? 'rotate-90' : ''}`} />
              </span>
            </button>

            {showScoredFights && (
              <div className="mt-3 space-y-0.5">
                {scoredFights.map(sf => {
                  const f1Name = sf.fighter1_name || (sf.bout?.split(/ vs /i)?.[0]?.trim() || '?');
                  const f2Name = sf.fighter2_name || (sf.bout?.split(/ vs /i)?.[1]?.trim() || '?');

                  let userPick = null;
                  let scoreDisplay = '—';
                  if (sf.f1_total > sf.f2_total) {
                    userPick = f1Name;
                    scoreDisplay = `${sf.f1_total}–${sf.f2_total} ${lastName(f1Name)}`;
                  } else if (sf.f2_total > sf.f1_total) {
                    userPick = f2Name;
                    scoreDisplay = `${sf.f2_total}–${sf.f1_total} ${lastName(f2Name)}`;
                  } else if (sf.rounds_scored > 0) {
                    scoreDisplay = `${sf.f1_total}–${sf.f2_total} Draw`;
                  }

                  let dotColor = null;
                  if (userPick && sf.winner) {
                    dotColor = normN(userPick) === normN(sf.winner) ? 'bg-green-500' : 'bg-red-500';
                  }

                  return (
                    <div
                      key={sf.id}
                      onClick={() => onFightClick?.(sf)}
                      className={`flex items-center justify-between py-2.5 px-3 rounded-lg transition-colors ${onFightClick ? 'cursor-pointer hover:bg-white/5' : ''}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          {dotColor && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotColor}`} />}
                          <p className="text-sm font-bold truncate">
                            {lastName(f1Name)} <span className="opacity-30 font-normal text-xs">vs</span> {lastName(f2Name)}
                          </p>
                        </div>
                        <p className="text-[10px] opacity-30 uppercase tracking-widest truncate">
                          {sf.weight_class_clean || sf.weight_class || ''}{sf.event_name ? ` • ${sf.event_name}` : ''}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                        <span className="text-xs font-mono opacity-60">{scoreDisplay}</span>
                        {onFightClick && <ChevronRight size={12} className="opacity-20" />}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
};

export default JudgingDNACard;
