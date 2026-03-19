import { useState } from 'react';
import { Scale, ChevronRight } from 'lucide-react';

const MIN_ROUNDS = 5;

const shortClass = (wc) => wc || '—';
const lastName = (name) => name ? name.split(' ').pop() : '?';
const normN = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const getInitials = (name) => {
  const parts = (name || '').trim().split(' ');
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : (name || '??').substring(0, 2).toUpperCase();
};

// --- Pulse sub-components ---

const AccuracyRing = ({ value }) => {
  const pct = value != null ? Math.round(value * 100) : 0;
  const circumference = 2 * Math.PI * 42; // r=42
  const offset = circumference * (1 - (pct / 100));
  return (
    <div className="relative w-24 h-24 flex-shrink-0">
      <svg viewBox="0 0 96 96" className="w-24 h-24" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="48" cy="48" r="42" fill="none" stroke="#24242e" strokeWidth="7" />
        <circle
          cx="48" cy="48" r="42" fill="none"
          stroke="#ef4444" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1s ease' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-heading font-black text-[28px] text-pulse-red">
        {pct}%
      </div>
    </div>
  );
};

const PulsePct = ({ value, size = 'md', color = 'text-pulse-text' }) => {
  const display = value != null ? `${Math.round(value * 100)}%` : '—';
  const sizeClass = size === 'lg' ? 'text-[26px]' : size === 'sm' ? 'text-base' : 'text-xl';
  return <span className={`font-heading font-extrabold leading-none ${sizeClass} ${color}`}>{display}</span>;
};

const SectionTitle = ({ children }) => (
  <div className="font-heading font-bold text-[15px] uppercase tracking-wider text-pulse-text-2 mb-4">
    {children}
  </div>
);

// Stacked horizontal bar for agreement breakdown
const AgreementBar = ({ breakdown }) => {
  if (!breakdown || !breakdown.total) return null;
  const segments = [
    { key: 'all3',           pct: breakdown.all3_pct, label: 'All 3',  color: 'bg-pulse-green' },
    { key: 'two_of_three',   pct: breakdown.two_pct,  label: '2 of 3', color: 'bg-emerald-400' },
    { key: 'one_of_three',   pct: breakdown.one_pct,  label: '1 of 3', color: 'bg-pulse-amber' },
    { key: 'lone_dissenter', pct: breakdown.lone_pct, label: 'None',   color: 'bg-pulse-red' },
  ];

  return (
    <div className="space-y-2">
      <div className="flex h-[6px] rounded-full overflow-hidden gap-px bg-pulse-surface-2">
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
      <div className="flex">
        {segments.map(s =>
          (s.pct || 0) > 0 ? (
            <div
              key={s.key}
              className="text-center overflow-hidden min-w-0"
              style={{ width: `${Math.round((s.pct || 0) * 100)}%` }}
            >
              <p className="text-[11px] font-heading font-bold text-pulse-text truncate">
                {Math.round(s.pct * 100)}%
              </p>
              <p className="text-[11px] uppercase tracking-wide text-pulse-text-3 truncate">{s.label}</p>
            </div>
          ) : null
        )}
      </div>
    </div>
  );
};

// Two-tone bar: red for striking, blue for grappling (Pulse colors)
const SplitBar = ({ strikePct, grapplingPct }) => {
  if (strikePct == null) return <span className="text-xs text-pulse-text-3">—</span>;
  const s = Math.round((strikePct || 0) * 100);
  const g = Math.round((grapplingPct || 0) * 100);
  const total = s + g || 1;
  const sBar = Math.round((s / total) * 100);
  const gBar = 100 - sBar;
  return (
    <div className="space-y-1.5">
      <div className="flex h-[6px] rounded-full overflow-hidden gap-[2px] bg-pulse-surface-2">
        {sBar > 0 && <div className="bg-pulse-red transition-all duration-700 rounded-l-full" style={{ width: `${sBar}%` }} />}
        {gBar > 0 && <div className="bg-pulse-blue transition-all duration-700 rounded-r-full" style={{ width: `${gBar}%` }} />}
      </div>
      <div className="flex justify-between text-[12px]">
        <span className="text-pulse-red font-medium">{sBar}% striking</span>
        <span className="text-pulse-blue font-medium">{gBar}% grappling</span>
      </div>
    </div>
  );
};

// Bias stat tile for the 2x2 grid
const BiasTile = ({ value, label, sub }) => (
  <div className="bg-pulse-surface-2 rounded-card p-4 text-center">
    <PulsePct value={value} size="lg" color="text-pulse-text" />
    <p className="text-[11px] font-heading font-semibold uppercase tracking-wider text-pulse-text-2 mt-2">{label}</p>
    <p className="text-[12px] text-pulse-text-3 mt-1 leading-tight">{sub}</p>
  </div>
);

const JudgingDNACard = ({ profile, currentTheme, scoredFights = [], onFightClick = null, onCompareWithJudge = null }) => {
  const [showBiasByClass, setShowBiasByClass] = useState(false);
  const [showScoredFights, setShowScoredFights] = useState(false);
  const [genderFilter, setGenderFilter] = useState('all');

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
    scoring_differentials,
    takedown_lean,
    gender_split,
  } = profile;

  if ((rounds_scored || 0) < MIN_ROUNDS) {
    return (
      <div className="bg-pulse-surface border border-dashed border-white/[0.06] rounded-fight p-6 text-center mb-4">
        <Scale className="mx-auto mb-2 text-pulse-text-3" />
        <p className="text-sm text-pulse-text-2">
          Score {MIN_ROUNDS - (rounds_scored || 0)} more round{MIN_ROUNDS - (rounds_scored || 0) === 1 ? '' : 's'} to unlock your Judging DNA
        </p>
      </div>
    );
  }

  const showGenderToggle = (gender_split?.womens?.rounds_scored || 0) > 0;
  const activeG = genderFilter !== 'all' ? gender_split?.[genderFilter] : null;

  const activeAccuracy       = activeG?.accuracy       ?? accuracy;
  const activeOutlierRate    = activeG?.outlier_rate    ?? outlier_rate;
  const activeRoundsMatched  = activeG?.rounds_matched  ?? rounds_matched;
  const activeTenEightRate   = activeG?.ten_eight_rate  ?? ten_eight_rate;
  const activeAggressorBias  = activeG?.aggressor_bias  ?? aggressor_bias;
  const activeStrikingBias   = activeG
    ? { striking_pct: activeG.striking_pct, grappling_pct: activeG.grappling_pct, rounds: activeG.rounds_matched || 0 }
    : striking_vs_grappling_bias;

  const filteredClasses = (accuracy_by_class || []).filter(wc => {
    if (genderFilter === 'womens') return wc.weight_class_clean?.includes('Women');
    if (genderFilter === 'mens')   return !wc.weight_class_clean?.includes('Women');
    return true;
  });
  const topClasses = filteredClasses.slice(0, 5);
  const hasBiasData = activeStrikingBias?.rounds > 0;

  return (
    <div className="space-y-4 mb-4">

      {/* ── Header card ── */}
      <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-pulse-red to-red-700 flex items-center justify-center">
              <Scale size={18} className="text-white" />
            </div>
            <div>
              <h2 className="font-heading font-bold text-lg uppercase tracking-wide text-pulse-text">Judging DNA</h2>
              <p className="text-[12px] text-pulse-text-3">{rounds_scored} rounds scored · {fights_scored} fights</p>
            </div>
          </div>
          {showGenderToggle && (
            <div className="flex items-center gap-0.5 bg-pulse-surface-2 rounded-pill p-0.5">
              {['all', 'mens', 'womens'].map(f => (
                <button
                  key={f}
                  onClick={() => setGenderFilter(f)}
                  className={`text-[10px] font-heading font-semibold uppercase tracking-wider px-2.5 py-1 rounded-pill transition-colors ${
                    genderFilter === f
                      ? 'bg-pulse-red text-white'
                      : 'text-pulse-text-3 hover:text-pulse-text-2'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'mens' ? "Men's" : "Women's"}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Accuracy overview card ── */}
      <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-5">
        <SectionTitle>Overall Accuracy</SectionTitle>
        <div className="flex items-center gap-5 mb-4">
          <AccuracyRing value={activeAccuracy} />
          <div className="flex-1 space-y-1">
            <p className="text-[14px] text-pulse-text-2 leading-relaxed">
              You match the <strong className="text-pulse-text">judging majority {activeAccuracy != null ? `${Math.round(activeAccuracy * 100)}%` : '—'}</strong> of the time across all scored fights.
            </p>
          </div>
        </div>
        {/* Secondary stats row */}
        <div className="grid grid-cols-3 gap-3 pt-4 border-t border-white/[0.06]">
          <div className="text-center">
            <PulsePct value={activeOutlierRate} size="md" color="text-pulse-amber" />
            <p className="text-[12px] font-heading font-semibold uppercase tracking-wider text-pulse-text-3 mt-1">Outlier Rate</p>
          </div>
          <div className="text-center">
            <span className="font-heading font-extrabold text-xl leading-none text-pulse-text">{activeRoundsMatched ?? '—'}</span>
            <p className="text-[12px] font-heading font-semibold uppercase tracking-wider text-pulse-text-3 mt-1">Rounds Matched</p>
          </div>
          <div className="text-center">
            <span className="font-heading font-extrabold text-xl leading-none text-pulse-text">{fights_scored ?? '—'}</span>
            <p className="text-[12px] font-heading font-semibold uppercase tracking-wider text-pulse-text-3 mt-1">Fights Scored</p>
          </div>
        </div>
      </div>

      {/* ── Agreement breakdown card ── */}
      <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-5">
        <SectionTitle>Judge Agreement</SectionTitle>
        <AgreementBar breakdown={agreement_breakdown} />
        <p className="text-[12px] text-pulse-text-3 mt-3 text-center">
          How many of the 3 judges agree with your pick per round
        </p>
      </div>

      {/* ── 10-8 Rounds card ── */}
      <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-5">
        <SectionTitle>10-8 Rounds</SectionTitle>
        <div className="flex items-center justify-around">
          <div className="text-center">
            <PulsePct value={activeTenEightRate} size="lg" color="text-pulse-red" />
            <p className="text-[11px] font-heading font-semibold uppercase tracking-wider text-pulse-text-2 mt-2">Your Rate</p>
            <p className="text-[12px] text-pulse-text-3 mt-0.5">how often you give 10-8s</p>
          </div>
          <div className="w-px h-14 bg-white/[0.06]" />
          <div className="text-center">
            <PulsePct value={ten_eight_quality} size="lg" color="text-pulse-green" />
            <p className="text-[11px] font-heading font-semibold uppercase tracking-wider text-pulse-text-2 mt-2">10-8 Accuracy</p>
            <p className="text-[12px] text-pulse-text-3 mt-0.5">judges also scored dominant</p>
          </div>
        </div>
      </div>

      {/* ── Judge Match card ── */}
      {judges && judges.length > 0 && (
        <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-5">
          <div className="flex items-center justify-between mb-4">
            <SectionTitle>Judge Match</SectionTitle>
            {onCompareWithJudge && (
              <span className="text-[10px] text-pulse-text-3 uppercase tracking-wider">tap to compare</span>
            )}
          </div>
          <div className="space-y-2">
            {judges.slice(0, 3).map((j, i) => {
              const agreePct = j.agreement_pct != null ? Math.round(j.agreement_pct * 100) : 0;
              const avatarBg = i === 0 ? 'bg-pulse-green' : i === 1 ? 'bg-pulse-blue' : 'bg-pulse-amber';
              const pctColor = i === 0 ? 'text-pulse-green' : i === 1 ? 'text-pulse-blue' : 'text-pulse-amber';
              return (
                <div
                  key={j.name}
                  onClick={() => onCompareWithJudge?.(j.name)}
                  className={`flex items-center gap-3.5 py-3 px-3.5 rounded-card transition-colors ${
                    onCompareWithJudge ? 'cursor-pointer hover:bg-pulse-surface-2' : ''
                  }`}
                >
                  <div className={`w-11 h-11 rounded-full flex-shrink-0 flex items-center justify-center font-heading font-bold text-[13px] text-white ${avatarBg}`}>
                    {getInitials(j.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-semibold text-pulse-text truncate">{j.name}</p>
                    <p className="text-[12px] text-pulse-text-3">{j.rounds} rounds shared</p>
                  </div>
                  <span className={`font-heading font-extrabold text-[22px] flex-shrink-0 ${pctColor}`}>
                    {agreePct}%
                  </span>
                  {onCompareWithJudge && <ChevronRight size={16} className="text-pulse-text-3 flex-shrink-0" />}
                </div>
              );
            })}
          </div>
          {onCompareWithJudge && (
            <button
              onClick={() => onCompareWithJudge(null)}
              className="mt-3 w-full text-center text-[11px] text-pulse-text-3 hover:text-pulse-text-2 font-heading font-semibold uppercase tracking-wider transition-colors"
            >
              Compare vs any judge ›
            </button>
          )}
        </div>
      )}

      {/* ── Accuracy by Weight Class — horizontal scroll cards ── */}
      {topClasses.length > 0 && (
        <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-5 pr-0">
          <div className="pr-5">
            <SectionTitle>Accuracy by Weight Class</SectionTitle>
          </div>
          <div className="flex gap-2.5 overflow-x-auto pb-2 pr-5" style={{ WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
            {topClasses.map(wc => {
              const accPct = Math.round((wc.accuracy || 0) * 100);
              return (
                <div
                  key={wc.weight_class_clean || wc.weight_class}
                  className="flex-shrink-0 w-[140px] bg-pulse-surface-2 rounded-card p-4 border border-white/[0.06]"
                >
                  <p className="text-[12px] font-heading font-semibold uppercase tracking-wide text-pulse-text-2 mb-1.5 truncate">
                    {shortClass(wc.weight_class_clean || wc.weight_class)}
                  </p>
                  <p className="font-heading font-extrabold text-[26px] leading-none text-pulse-text mb-2">
                    {accPct}%
                  </p>
                  <div className="h-[3px] bg-white/[0.06] rounded-full overflow-hidden mb-2">
                    <div
                      className="h-full bg-pulse-red rounded-full transition-all duration-700"
                      style={{ width: `${accPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[12px] text-pulse-text-3">
                    <span>{wc.rounds}r</span>
                    <span>{wc.avg_loser_score != null ? wc.avg_loser_score.toFixed(1) : '—'} avg</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="pr-5 pt-3 space-y-0.5">
            <p className="text-[11px] text-pulse-text-3">r — rounds with judge data available</p>
            <p className="text-[11px] text-pulse-text-3">avg — your average score for the losing fighter (lower = stricter)</p>
          </div>
        </div>
      )}

      {/* ── Scoring Tendencies card ── */}
      {hasBiasData && (
        <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-5">
          <div className="flex items-center justify-between mb-4">
            <SectionTitle>Scoring Tendencies</SectionTitle>
            {genderFilter === 'all' && topClasses.some(wc => wc.striking_pct != null) && (
              <button
                onClick={() => setShowBiasByClass(v => !v)}
                className="text-[11px] font-heading font-semibold text-pulse-text-3 hover:text-pulse-text-2 uppercase tracking-wider transition-colors"
              >
                {showBiasByClass ? 'Overall ▴' : 'By Class ▾'}
              </button>
            )}
          </div>

          {/* Strike vs Grapple lean */}
          <div className="mb-5">
            <p className="text-[11px] font-heading font-semibold uppercase tracking-wider text-pulse-text-3 mb-2.5">
              Strike vs Grapple Lean
            </p>
            {!showBiasByClass ? (
              <SplitBar
                strikePct={activeStrikingBias?.striking_pct}
                grapplingPct={activeStrikingBias?.grappling_pct}
              />
            ) : (
              <div className="space-y-3">
                {topClasses.filter(wc => wc.striking_pct != null).map(wc => (
                  <div key={wc.weight_class_clean} className="flex items-center gap-3">
                    <span className="text-[11px] text-pulse-text-3 w-20 flex-shrink-0 truncate font-heading font-semibold uppercase">
                      {shortClass(wc.weight_class_clean)}
                    </span>
                    <div className="flex-1">
                      <SplitBar strikePct={wc.striking_pct} grapplingPct={wc.grappling_pct} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[12px] text-pulse-text-3 mt-2.5">
              Which factor was more dominant in rounds you awarded — striking (sig. strikes) or grappling (takedowns + control)?
            </p>

            {/* Scoring differentials */}
            {scoring_differentials?.rounds > 0 && (
              <div className="mt-4 pt-4 border-t border-white/[0.06]">
                <p className="text-[13px] font-heading font-semibold uppercase tracking-wider text-pulse-text-3 mb-3">
                  Avg margin when awarding a round
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="bg-pulse-surface-2 rounded-card p-3">
                    <p className="font-heading font-extrabold text-lg leading-none text-pulse-red">
                      +{scoring_differentials.avg_strike_diff ?? '—'}
                    </p>
                    <p className="text-[11px] font-heading uppercase tracking-wider text-pulse-text-3 mt-1.5">Sig Strikes</p>
                  </div>
                  <div className="bg-pulse-surface-2 rounded-card p-3">
                    <p className="font-heading font-extrabold text-lg leading-none text-pulse-red">
                      +{scoring_differentials.avg_ctrl_diff ?? '—'}s
                    </p>
                    <p className="text-[11px] font-heading uppercase tracking-wider text-pulse-text-3 mt-1.5">Control</p>
                  </div>
                  <div className="bg-pulse-surface-2 rounded-card p-3">
                    <p className="font-heading font-extrabold text-lg leading-none text-pulse-red">
                      +{scoring_differentials.avg_grd_diff ?? '—'}
                    </p>
                    <p className="text-[11px] font-heading uppercase tracking-wider text-pulse-text-3 mt-1.5">Grd Strikes</p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Aggressor / Passive Control / Knockdown / Takedown — 2x2 grid */}
          {genderFilter !== 'all' && (
            <p className="text-[12px] text-pulse-text-3 mb-2">Passive Control, KD Fighter, and TD Fighter shown overall only</p>
          )}
          <div className="grid grid-cols-2 gap-3 border-t border-white/[0.06] pt-4">
            <BiasTile
              value={activeAggressorBias}
              label="Aggressor Lean"
              sub="sided with higher volume when accuracy favoured opponent"
            />
            <BiasTile
              value={takedown_quality_bias?.passive_control_pct}
              label="Passive Control"
              sub="of control wins had no subs or ground strikes"
            />
            <BiasTile
              value={knockdown_bias?.kd_bias_pct}
              label="KD Fighter"
              sub={`sided with knockdown scorer${knockdown_bias?.kd_rounds > 0 ? ` (${knockdown_bias.kd_rounds} KD rds)` : ''}`}
            />
            <BiasTile
              value={takedown_lean?.pct}
              label="TD Fighter"
              sub={`sided with more takedowns${takedown_lean?.rounds > 0 ? ` (${takedown_lean.rounds} rds)` : ''}`}
            />
          </div>
        </div>
      )}

      {/* ── Scored Fights collapsible card ── */}
      {scoredFights?.length > 0 && (
        <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-5">
          <button
            onClick={() => setShowScoredFights(v => !v)}
            className="flex items-center justify-between w-full text-left"
          >
            <span className="font-heading font-bold text-[15px] uppercase tracking-wider text-pulse-text-2">
              Scored Fights
            </span>
            <span className="flex items-center gap-1.5 text-[13px] font-heading font-semibold text-pulse-text-3">
              {scoredFights.length}
              <ChevronRight size={14} className={`transition-transform duration-200 ${showScoredFights ? 'rotate-90' : ''}`} />
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
                  dotColor = normN(userPick) === normN(sf.winner) ? 'bg-pulse-green' : 'bg-pulse-red';
                }

                return (
                  <div
                    key={sf.id}
                    onClick={() => onFightClick?.(sf)}
                    className={`flex items-center justify-between py-2.5 px-3 rounded-card transition-colors ${
                      onFightClick ? 'cursor-pointer hover:bg-pulse-surface-2' : ''
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        {dotColor && <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />}
                        <p className="text-[14px] font-semibold text-pulse-text truncate">
                          {lastName(f1Name)} <span className="text-pulse-text-3 font-normal text-xs">vs</span> {lastName(f2Name)}
                        </p>
                      </div>
                      <p className="text-[12px] text-pulse-text-3 uppercase tracking-wider truncate">
                        {sf.weight_class_clean || sf.weight_class || ''}{sf.event_name ? ` · ${sf.event_name}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                      <span className="text-[13px] font-heading font-semibold text-pulse-text-2">{scoreDisplay}</span>
                      {onFightClick && <ChevronRight size={14} className="text-pulse-text-3" />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

    </div>
  );
};

export default JudgingDNACard;
