import { Scale } from 'lucide-react';

const MIN_FIGHTS = 5;

const Pct = ({ value }) => (
  <span className="font-black text-2xl sm:text-3xl">
    {value !== null && value !== undefined ? `${Math.round(value * 100)}%` : '—'}
  </span>
);

const JudgingDNACard = ({ profile, currentTheme }) => {
  if (!profile) return null;

  const { fights_scored, rounds_matched, accuracy, ten_eight_rate, accuracy_by_class, judges } = profile;

  // Not enough data yet
  if ((fights_scored || 0) < MIN_FIGHTS) {
    return (
      <div className={`p-6 rounded-xl border border-dashed ${currentTheme.card} opacity-50 text-center mb-6`}>
        <Scale className="mx-auto mb-2 opacity-50" />
        <p className="text-sm">Score {MIN_FIGHTS - (fights_scored || 0)} more fight{fights_scored === MIN_FIGHTS - 1 ? '' : 's'} to unlock your Judging DNA</p>
      </div>
    );
  }

  const closestJudge = judges?.[0] || null;
  const topClasses = (accuracy_by_class || []).slice(0, 4);

  return (
    <div className={`${currentTheme.card} rounded-xl border shadow-lg overflow-hidden mb-6`}>
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 bg-black/30 border-b border-white/10 flex items-center justify-between">
        <p className="text-xs font-black uppercase tracking-widest opacity-60">Judging DNA</p>
        <span className="text-xs opacity-30 uppercase tracking-widest">{rounds_matched} rounds</span>
      </div>

      <div className="p-4 sm:p-6 space-y-6">
        {/* Overall accuracy */}
        <div className="text-center">
          <p className="text-xs opacity-40 uppercase tracking-widest mb-1">Accuracy vs Judges</p>
          <Pct value={accuracy} />
          <p className="text-xs opacity-30 mt-1">rounds matching majority</p>
        </div>

        {/* 10-8 rate */}
        <div className="flex items-center justify-between border-t border-white/10 pt-4">
          <div>
            <p className="text-xs opacity-40 uppercase tracking-widest mb-1">10-8 Rate</p>
            <p className="text-xs opacity-25">How often you give 10-8s</p>
          </div>
          <Pct value={ten_eight_rate} />
        </div>

        {/* Closest judge */}
        {closestJudge && (
          <div className="flex items-center justify-between border-t border-white/10 pt-4">
            <div>
              <p className="text-xs opacity-40 uppercase tracking-widest mb-1">Closest Judge</p>
              <p className="text-sm font-bold">{closestJudge.name}</p>
              <p className="text-xs opacity-30">{closestJudge.rounds} rounds shared</p>
            </div>
            <Pct value={closestJudge.agreement_pct} />
          </div>
        )}

        {/* Accuracy by weight class */}
        {topClasses.length > 0 && (
          <div className="border-t border-white/10 pt-4">
            <p className="text-xs opacity-40 uppercase tracking-widest mb-3">By Weight Class</p>
            <div className="space-y-2">
              {topClasses.map(wc => (
                <div key={wc.weight_class} className="flex items-center gap-3">
                  <span className="text-xs opacity-50 w-28 truncate flex-shrink-0">
                    {wc.weight_class?.replace(' Weight', '').replace('Super ', 'S.') || '—'}
                  </span>
                  {/* bar */}
                  <div className="flex-1 bg-black/30 rounded-full h-1.5 overflow-hidden">
                    <div
                      className={`h-full ${currentTheme.primary} transition-all duration-700`}
                      style={{ width: `${Math.round((wc.accuracy || 0) * 100)}%` }}
                    />
                  </div>
                  <span className="text-xs font-bold w-10 text-right">
                    {Math.round((wc.accuracy || 0) * 100)}%
                  </span>
                  <span className="text-xs opacity-30 w-10 text-right">{wc.rounds}r</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default JudgingDNACard;
