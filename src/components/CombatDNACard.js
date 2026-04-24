import { Activity, Swords, Zap } from 'lucide-react';

const CombatDNACard = ({ dna, currentTheme, baselines }) => {

  if (!dna) return (
    <div className="bg-pulse-surface border border-dashed border-white/[0.06] rounded-fight p-6 text-center opacity-50">
      <Activity className="mx-auto mb-2 opacity-50" />
      <p className="text-sm text-pulse-text-2">Rate more fights to generate your Combat DNA</p>
    </div>
  );

  const Comparison = ({ userVal, baseVal, suffix = '' }) => {
    const safeUser = Number(userVal) || 0;
    const safeBase = Number(baseVal) || 0;
    const diff = (safeUser - safeBase).toFixed(1);
    const isHigher = parseFloat(diff) > 0;
    return (
      <span className={`text-xs font-bold ml-2 ${isHigher ? 'text-pulse-red' : 'text-pulse-text-3'}`}>
        {isHigher ? '↑' : '↓'} {isHigher ? '+' : ''}{diff}{suffix}
      </span>
    );
  };

  const intensityScore = dna.intensityScore || 0;
  const getIntensityLabel = (score) => {
      if (score > 12) return { text: "MAULER", color: "text-pulse-red" };
      if (score > 7) return { text: "ACTIVE GRAPPLER", color: "text-pulse-amber" };
      return { text: "CONTROL FOCUSED", color: "text-pulse-blue" };
  };
  const intensityLabel = getIntensityLabel(intensityScore);

  return (
    <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-5 mb-4">
      {/* Hero metrics */}
      <div className="grid grid-cols-2 gap-3 mb-5">
        <div className="bg-pulse-surface-2 rounded-card p-3.5 text-center border border-white/[0.06]">
          <p className="text-[11px] text-pulse-text-2 uppercase tracking-wider mb-1">Strike Pace</p>
          <div className="font-heading font-extrabold text-[28px] text-pulse-red leading-none mb-1">{dna.strikePace}</div>
          <p className="text-[12px] text-pulse-text-3 mb-2">strikes / min</p>
          <Comparison userVal={dna.strikePace} baseVal={baselines.strikePace} />
        </div>
        <div className="bg-pulse-surface-2 rounded-card p-3.5 text-center border border-white/[0.06]">
          <p className="text-[11px] text-pulse-text-2 uppercase tracking-wider mb-1">Violence Index</p>
          <div className="font-heading font-extrabold text-[28px] text-pulse-red leading-none mb-1">{dna.violenceIndex}</div>
          <p className="text-[12px] text-pulse-text-3 mb-2">(KD + Sub) / min</p>
          <Comparison userVal={dna.violenceIndex} baseVal={baselines.violenceIndex} />
        </div>
      </div>

      {/* Engagement Style */}
      <div className="mb-5">
        <div className="flex justify-between text-sm mb-2 font-bold">
          <span className="flex items-center gap-2 font-heading font-bold text-sm uppercase tracking-wide">
            <Swords size={14} className="text-pulse-red" /> Engagement Style
          </span>
          <div className="flex items-center">
            <span className="text-sm">{dna.engagementStyle}% Control</span>
            <Comparison userVal={dna.engagementStyle} baseVal={baselines.engagementStyle} suffix="%" />
          </div>
        </div>
        <div className="h-1.5 bg-pulse-surface-2 rounded-full overflow-hidden relative mb-3" title="0% = Standup War, 100% = Grappling Clinic">
          <div className="absolute top-0 bottom-0 w-0.5 bg-white/20 z-10" style={{ left: `${baselines.engagementStyle}%` }} />
          <div className="h-full bg-pulse-red rounded-full transition-all duration-1000" style={{ width: `${dna.engagementStyle}%` }} />
        </div>

        {/* Intensity */}
        <div className="flex items-center justify-between bg-pulse-surface-2 rounded-card p-3 border border-white/[0.06]">
          <div className="flex flex-col">
            <span className="text-[12px] uppercase tracking-wider text-pulse-text-3">Grappling Intensity</span>
            <span className={`text-xs font-bold ${intensityLabel.color}`}>{intensityLabel.text}</span>
          </div>
          <div className="flex items-center gap-3">
            <Comparison userVal={intensityScore} baseVal={baselines.intensityScore} />
            <div className="text-right">
              <span className="font-heading font-extrabold text-lg">{intensityScore}</span>
              <span className="text-[12px] text-pulse-text-3 ml-1">Work Rate</span>
            </div>
          </div>
        </div>
      </div>

      {/* Finish Profile */}
      <div className="bg-pulse-surface-2 p-4 rounded-card border border-white/[0.06]">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={16} className="text-pulse-red" />
          <span className="font-heading font-bold text-sm uppercase tracking-wider">Finish Profile</span>
        </div>
        <div className="flex justify-between items-center text-center">
          <div className="flex-1 border-r border-white/[0.06]">
            <div className="font-heading font-extrabold text-2xl">{dna.finishRate}%</div>
            <div className="text-[12px] text-pulse-text-2 mb-1">Finish Rate</div>
            <Comparison userVal={dna.finishRate} baseVal={baselines.finishRate} suffix="%" />
          </div>
          <div className="flex-1">
            <div className="font-heading font-extrabold text-2xl">{dna.avgFightTime}m</div>
            <div className="text-[12px] text-pulse-text-2 mb-1">Avg Duration</div>
            <Comparison userVal={dna.avgFightTime} baseVal={baselines.avgFightTime} suffix="m" />
          </div>
        </div>
      </div>
    </div>
  );
};

export default CombatDNACard;
