import { Scale } from 'lucide-react';

const MIN_FIGHTS = 5;

// weight_class_clean is already stripped — just return as-is
const shortClass = (wc) => wc || '—';

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

const JudgingDNACard = ({ profile, currentTheme }) => {
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
  } = profile;

  if ((fights_scored || 0) < MIN_FIGHTS) {
    return (
      <div className={`p-6 ${currentTheme.rounded} border border-dashed ${currentTheme.card} opacity-50 text-center mb-6`}>
        <Scale className="mx-auto mb-2 opacity-50" />
        <p className="text-sm">
          Score {MIN_FIGHTS - (fights_scored || 0)} more fight{fights_scored === MIN_FIGHTS - 1 ? '' : 's'} to unlock your Judging DNA
        </p>
      </div>
    );
  }

  const closestJudge = judges?.[0] || null;
  const topClasses = (accuracy_by_class || []).slice(0, 5);

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

        {/* Closest judge */}
        {closestJudge && (
          <div className="border-t border-white/10 pt-5 flex items-center justify-between">
            <div>
              <p className="text-xs opacity-40 uppercase tracking-widest mb-1">Closest Judge</p>
              <p className="text-sm font-bold">{closestJudge.name}</p>
              <p className="text-xs opacity-30">{closestJudge.rounds} rounds shared</p>
            </div>
            <div className="text-right">
              <Pct value={closestJudge.agreement_pct} big />
              <p className="text-[10px] opacity-30 mt-1">agreement</p>
            </div>
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

      </div>
    </div>
  );
};

export default JudgingDNACard;
