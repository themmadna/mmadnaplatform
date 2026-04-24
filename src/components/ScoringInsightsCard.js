import { useState } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Cell, Tooltip } from 'recharts';
import { Zap, ChevronRight, Lock, Shuffle, Unplug, Gauge, TrendingUp, Crosshair } from 'lucide-react';

const STAT_LABELS = {
  ssl_pct: 'Sig. Strikes',
  td_pct: 'Takedowns',
  ctrl_pct: 'Control',
  grd_pct: 'Ground Str.',
};


const TIER_LABELS = ['Locked', 'Base', 'Gender Split', 'Group Split'];
const TIER_COLORS = ['text-pulse-text-3', 'text-pulse-amber', 'text-pulse-blue', 'text-pulse-green'];

const TIER1_MIN_ROUNDS = 15;          // matched rounds required to unlock Scoring Insights
const CONSISTENCY_HIGH_THRESHOLD = 70; // normalized score above this → Highly Consistent
const CONSISTENCY_MID_THRESHOLD = 40;  // normalized score above this → Moderately Consistent

const lastName = (name) => name ? name.split(' ').pop() : '?';

// --- Sub-components ---

const SectionTitle = ({ children, icon: Icon, className = '' }) => (
  <div className={`flex items-center gap-2 font-heading font-bold text-[15px] uppercase tracking-wider text-pulse-text-2 ${className}`}>
    {Icon && <Icon size={16} className="text-pulse-text-3" />}
    {children}
  </div>
);

const TierBadge = ({ tier, roundsWithStats, tier2Progress, tier3Progress }) => {
  const label = TIER_LABELS[tier] || 'Base';
  const color = TIER_COLORS[tier] || 'text-pulse-amber';

  let progressText = null;
  if (tier === 0) {
    progressText = `${roundsWithStats} / ${TIER1_MIN_ROUNDS} matched rounds to unlock`;
  } else if (tier === 1 && tier2Progress) {
    const needed = tier2Progress.total_needed;
    progressText = needed > 0
      ? `${roundsWithStats} / ${roundsWithStats + needed} rounds for Gender Split`
      : null;
  } else if (tier === 2 && tier3Progress) {
    const needed = tier3Progress.total_needed;
    progressText = needed > 0
      ? `${tier3Progress.qualifying_groups} / ${tier3Progress.qualifying_groups + tier3Progress.groups_needed} groups for Group Split`
      : null;
  }

  let progressFrac = 0;
  if (tier === 0) {
    progressFrac = Math.min(roundsWithStats / TIER1_MIN_ROUNDS, 1);
  } else if (tier === 1 && tier2Progress?.total_needed > 0) {
    progressFrac = roundsWithStats / (roundsWithStats + tier2Progress.total_needed);
  } else if (tier === 2 && tier3Progress?.groups_needed > 0) {
    progressFrac = tier3Progress.qualifying_groups / (tier3Progress.qualifying_groups + tier3Progress.groups_needed);
  } else {
    progressFrac = 1;
  }

  return (
    <div className="flex items-center gap-3" role="status" aria-label={`Tier ${tier}: ${label}`}>
      <div className="flex items-center gap-1.5 px-3 py-1 rounded-pill bg-pulse-surface-2 border border-white/[0.06]">
        <Zap size={14} className={color} />
        <span className={`text-[12px] font-heading font-bold uppercase tracking-wider ${color}`}>
          Tier {tier} — {label}
        </span>
      </div>
      {progressText && (
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-[4px] bg-pulse-surface-2 rounded-full overflow-hidden" role="progressbar" aria-valuenow={Math.round(progressFrac * 100)} aria-valuemin={0} aria-valuemax={100}>
              <div
                className="h-full bg-pulse-red rounded-full transition-all duration-700"
                style={{ width: `${Math.round(progressFrac * 100)}%` }}
              />
            </div>
            <span className="text-[11px] text-pulse-text-3 flex-shrink-0 whitespace-nowrap">{progressText}</span>
          </div>
        </div>
      )}
    </div>
  );
};

// Build radar + ranked bars for a fingerprint object
const FingerprintChart = ({ fp, label }) => {
  if (!fp) return null;

  // Build ranked list from fp directly if no .ranked array (gender/group splits don't have it)
  const ranked = fp.ranked || Object.entries(STAT_LABELS)
    .map(([key, lbl]) => ({ stat: key, label: lbl, pct: fp[key] || 0 }))
    .sort((a, b) => b.pct - a.pct);

  return (
    <div>
      {label && (
        <p className="text-[12px] font-heading font-semibold text-pulse-text-3 uppercase tracking-wider mb-2">
          {label}{fp.rounds ? ` · ${fp.rounds} rounds` : ''}
        </p>
      )}
      <p className="text-[12px] text-pulse-text-3 mb-4">
        How often you gave the round to the fighter who won each stat category
      </p>
      <div className="space-y-2.5">
        {ranked.map((r, i) => {
          const pct = Math.round(r.pct * 100);
          const barColor = i === 0 ? 'bg-pulse-red' : i === 1 ? 'bg-pulse-amber' : 'bg-white/20';
          return (
            <div key={r.stat}>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[12px] font-heading font-semibold text-pulse-text-2 uppercase tracking-wider">
                  {r.label}
                </span>
                <span className="text-[13px] font-heading font-extrabold text-pulse-text">{pct}%</span>
              </div>
              <div className="h-[4px] bg-pulse-surface-2 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${barColor}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const FingerprintRadar = ({ fingerprint, fingerprintMens, fingerprintWomens, fingerprintByGroup, tier, fpFilter, setFpFilter }) => {
  if (!fingerprint) return null;

  const showGender = tier >= 2 && (fingerprintMens || fingerprintWomens);
  const showGroup = tier >= 3 && fingerprintByGroup?.length > 0;

  // Determine which fingerprint to display
  let activeFp = fingerprint;
  let activeLabel = null;
  if (fpFilter === 'mens' && fingerprintMens) {
    activeFp = fingerprintMens;
    activeLabel = "Men's";
  } else if (fpFilter === 'womens' && fingerprintWomens) {
    activeFp = fingerprintWomens;
    activeLabel = "Women's";
  } else if (fpFilter?.startsWith('group:') && fingerprintByGroup) {
    const groupName = fpFilter.slice(6);
    const grp = fingerprintByGroup.find(g => g.group === groupName);
    if (grp) { activeFp = grp; activeLabel = groupName; }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <SectionTitle icon={Crosshair}>Scoring Fingerprint</SectionTitle>
        {(showGender || showGroup) && (
          <div className="flex items-center gap-1 flex-wrap justify-end">
            {showGender && (
              <div className="flex items-center gap-0.5 bg-pulse-surface-2 rounded-pill p-0.5" role="radiogroup" aria-label="Gender filter">
                {['all', 'mens', 'womens'].map(f => {
                  const isDisabled = (f === 'mens' && !fingerprintMens) || (f === 'womens' && !fingerprintWomens);
                  return (
                    <button
                      key={f}
                      onClick={() => setFpFilter(fpFilter === f ? 'all' : f)}
                      disabled={isDisabled}
                      role="radio"
                      aria-checked={fpFilter === f}
                      className={`text-[10px] font-heading font-semibold uppercase tracking-wider px-2.5 py-1 min-h-[28px] rounded-pill transition-colors ${
                        fpFilter === f
                          ? 'bg-pulse-red text-white'
                          : isDisabled
                            ? 'text-pulse-text-3/40 cursor-not-allowed'
                            : 'text-pulse-text-3 hover:text-pulse-text-2'
                      }`}
                    >
                      {f === 'all' ? 'All' : f === 'mens' ? "M" : "W"}
                    </button>
                  );
                })}
              </div>
            )}
            {showGroup && (
              <select
                value={fpFilter?.startsWith('group:') ? fpFilter : ''}
                onChange={e => setFpFilter(e.target.value || 'all')}
                aria-label="Weight class group filter"
                className="text-[10px] font-heading font-semibold uppercase tracking-wider bg-pulse-surface-2 text-pulse-text-2 border border-white/[0.06] rounded-pill px-2.5 py-1 min-h-[28px] cursor-pointer"
              >
                <option value="">By Group</option>
                {fingerprintByGroup.map(g => (
                  <option key={g.group} value={`group:${g.group}`}>{g.group} ({g.rounds}r)</option>
                ))}
              </select>
            )}
          </div>
        )}
      </div>

      <FingerprintChart fp={activeFp} label={activeLabel} />

      <p className="text-[11px] text-pulse-text-3 mt-3 leading-relaxed">
        % of rounds where the winner led in each stat — shows which stats drive your scoring
      </p>
    </div>
  );
};

const PatternBreakSection = ({ patternBreaks }) => {
  if (!patternBreaks) return null;
  const { rate, count, total, examples } = patternBreaks;
  const ratePct = Math.round((rate || 0) * 100);

  return (
    <div>
      <SectionTitle icon={Shuffle} className="mb-4">Pattern Breaks</SectionTitle>
      <div className="flex items-center gap-4 mb-4">
        <div className="text-center flex-shrink-0">
          <span className="font-heading font-black text-[32px] leading-none text-pulse-amber">{ratePct}%</span>
          <p className="text-[11px] text-pulse-text-3 mt-1">{count} / {total} rounds</p>
        </div>
        <p className="text-[13px] text-pulse-text-2 leading-relaxed">
          You went against your own fingerprint in <strong className="text-pulse-text">{ratePct}%</strong> of rounds — picking a winner whose stats didn't match your usual pattern.
        </p>
      </div>

      {examples?.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-heading font-semibold uppercase tracking-wider text-pulse-text-3 mb-2">
            Biggest surprises
          </p>
          {examples.map((ex) => (
            <div
              key={`${ex.fight_url}-${ex.round}`}
              className="flex items-center justify-between py-2 px-3 rounded-card bg-pulse-surface-2"
            >
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-pulse-text truncate">
                  {lastName(ex.fighter1_name)} vs {lastName(ex.fighter2_name)}
                  <span className="text-pulse-text-3 font-normal text-[12px] ml-1.5">R{ex.round}</span>
                </p>
                <p className="text-[11px] text-pulse-text-3 truncate">{ex.weight_class_clean}</p>
              </div>
              <div className="flex-shrink-0 text-right ml-3">
                <p className="text-[12px] text-pulse-text-2">
                  Predicted <span className="text-pulse-text-3">{lastName(ex.predicted_pick)}</span>
                </p>
                <p className="text-[12px] text-pulse-amber font-semibold">
                  Picked {lastName(ex.actual_pick)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const DisconnectSection = ({ disconnect }) => {
  if (!disconnect) return null;
  const { rate, count, total, examples } = disconnect;
  const ratePct = Math.round((rate || 0) * 100);

  return (
    <div>
      <SectionTitle icon={Unplug} className="mb-4">Stat Disconnects</SectionTitle>
      <div className="flex items-center gap-4 mb-4">
        <div className="text-center flex-shrink-0">
          <span className="font-heading font-black text-[32px] leading-none text-pulse-red">{ratePct}%</span>
          <p className="text-[11px] text-pulse-text-3 mt-1">{count} / {total} rounds</p>
        </div>
        <p className="text-[13px] text-pulse-text-2 leading-relaxed">
          In <strong className="text-pulse-text">{ratePct}%</strong> of rounds, the fighter you picked lost the majority of stat categories — a disconnect between stats and your scoring.
        </p>
      </div>

      {examples?.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-heading font-semibold uppercase tracking-wider text-pulse-text-3 mb-2">
            Biggest gaps
          </p>
          {examples.map((ex) => (
            <div
              key={`${ex.fight_url}-${ex.round}`}
              className="py-2 px-3 rounded-card bg-pulse-surface-2"
            >
              <p className="text-[13px] font-semibold text-pulse-text">
                {lastName(ex.fighter1_name)} vs {lastName(ex.fighter2_name)}
                <span className="text-pulse-text-3 font-normal text-[12px] ml-1.5">R{ex.round}</span>
              </p>
              <p className="text-[11px] text-pulse-text-3 mt-0.5">
                Your pick won {ex.winner_cats} of 5 stats · opponent won {ex.loser_cats}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

const ConsistencyGauge = ({ consistency }) => {
  if (!consistency) return null;
  const { score, buckets } = consistency;
  const pct = Math.round((score || 0) * 100);

  // Normalize to 0-100: score ranges 0.5 (random) to 1.0 (perfectly consistent)
  const normalized = Math.max(0, Math.round(((score || 0.5) - 0.5) * 200));
  const gaugeColor = normalized >= CONSISTENCY_HIGH_THRESHOLD ? 'text-pulse-green' : normalized >= CONSISTENCY_MID_THRESHOLD ? 'text-pulse-amber' : 'text-pulse-red';
  const gaugeLabel = normalized >= CONSISTENCY_HIGH_THRESHOLD ? 'Highly Consistent' : normalized >= CONSISTENCY_MID_THRESHOLD ? 'Moderately Consistent' : 'Variable';

  return (
    <div>
      <SectionTitle icon={Gauge} className="mb-4">Consistency</SectionTitle>
      <div className="flex items-center gap-5 mb-4">
        <div className="text-center flex-shrink-0">
          <span className={`font-heading font-black text-[32px] leading-none ${gaugeColor}`} aria-label={`Consistency score: ${pct}%`}>{pct}%</span>
          <p className={`text-[11px] font-heading font-semibold uppercase tracking-wider mt-1 ${gaugeColor}`}>
            {gaugeLabel}
          </p>
        </div>
        <p className="text-[13px] text-pulse-text-2 leading-relaxed">
          When similar stat patterns repeat, you pick the same way <strong className="text-pulse-text">{pct}%</strong> of the time. Higher means more predictable scoring.
        </p>
      </div>

      {buckets?.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-heading font-semibold uppercase tracking-wider text-pulse-text-3 mb-2">
            By stat dominance
          </p>
          {buckets.map((b, i) => {
            const bPct = Math.round((b.picked_dominant_pct || 0) * 100);
            return (
              <div key={i} className="flex items-center gap-3">
                <span className="text-[11px] text-pulse-text-3 w-28 flex-shrink-0 truncate font-heading font-semibold uppercase">
                  Won {b.dominant_cats} of 5
                </span>
                <div className="flex-1 h-[4px] bg-pulse-surface-2 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-pulse-green rounded-full transition-all duration-700"
                    style={{ width: `${bPct}%` }}
                  />
                </div>
                <span className="text-[12px] font-heading font-semibold text-pulse-text w-10 text-right">{bPct}%</span>
                <span className="text-[11px] text-pulse-text-3 w-8 text-right">{b.rounds}r</span>
              </div>
            );
          })}
          <p className="text-[11px] text-pulse-text-3 mt-2">
            % of time you picked the fighter who won more stat categories
          </p>
        </div>
      )}
    </div>
  );
};

const DriftSparkline = ({ drift }) => {
  if (!drift) return null;
  const { by_round, momentum_rate, momentum_sample } = drift;

  const chartData = (by_round || []).map(r => ({
    name: `R${r.round}`,
    accuracy: Math.round((r.accuracy || 0) * 100),
    count: r.count,
  }));

  const momPct = Math.round((momentum_rate || 0) * 100);
  const hasChart = chartData.length > 0;
  const hasMomentum = (momentum_sample || 0) > 0;
  if (!hasChart && !hasMomentum) return null;

  return (
    <div>
      <SectionTitle icon={TrendingUp} className="mb-4">Judge Agreement by Round</SectionTitle>

      {hasChart && (
        <div className="mb-4">
          <p className="text-[11px] font-heading font-semibold uppercase tracking-wider text-pulse-text-3 mb-2">
            How often your pick matched the judges' majority in each round
          </p>
          <div className="h-[160px]" role="img" aria-label={`Round accuracy: ${chartData.map(d => `${d.name} ${d.accuracy}%`).join(', ')}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} barCategoryGap="25%">
                <XAxis
                  dataKey="name"
                  tick={{ fill: '#94949e', fontSize: 11 }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tick={{ fill: '#94949e', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={30}
                  tickFormatter={v => `${v}%`}
                />
                <Tooltip
                  contentStyle={{ background: '#1a1a24', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 13, padding: '8px 12px' }}
                  labelStyle={{ color: '#ffffff', fontWeight: 700, fontSize: 14 }}
                  itemStyle={{ color: '#d1d1d8' }}
                  formatter={(val, _name, props) => [`${val}% (${props.payload.count} rounds)`, 'Accuracy']}
                  cursor={{ fill: 'rgba(255,255,255,0.04)' }}
                  position={{ y: 0 }}
                />
                <Bar dataKey="accuracy" radius={[4, 4, 0, 0]}>
                  {chartData.map((d, i) => (
                    <Cell
                      key={i}
                      fill={d.accuracy >= 60 ? '#22c55e' : d.accuracy >= 45 ? '#f59e0b' : '#ef4444'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {hasMomentum && (
        <div className={`flex items-center gap-4 ${hasChart ? 'pt-3 border-t border-white/[0.06]' : ''}`}>
          <div className="text-center flex-shrink-0">
            <span className="font-heading font-black text-[26px] leading-none text-pulse-blue">{momPct}%</span>
          </div>
          <p className="text-[13px] text-pulse-text-2 leading-relaxed">
            <strong className="text-pulse-text">Momentum bias:</strong> in {momentum_sample} fights where you gave R1 and R2 to the same fighter, you also gave them R3 <strong className="text-pulse-text">{momPct}%</strong> of the time — suggesting you may ride early momentum.
          </p>
        </div>
      )}
    </div>
  );
};

// --- Main component ---

const ScoringInsightsCard = ({ insights }) => {
  const [expanded, setExpanded] = useState(false);
  const [fpFilter, setFpFilter] = useState('all');

  if (!insights) return null;

  const {
    tier, rounds_with_stats, tier2_progress, tier3_progress,
    fingerprint, fingerprint_mens, fingerprint_womens, fingerprint_by_group,
    pattern_breaks, disconnect, consistency, drift,
  } = insights;

  // Tier 0: locked state
  if (tier === 0) {
    return (
      <div className="bg-pulse-surface border border-dashed border-white/[0.06] rounded-fight p-6 text-center">
        <Lock className="mx-auto mb-2 text-pulse-text-3" size={20} />
        <p className="text-sm text-pulse-text-2 mb-3">
          Score {TIER1_MIN_ROUNDS - (rounds_with_stats || 0)} more matched round{TIER1_MIN_ROUNDS - (rounds_with_stats || 0) === 1 ? '' : 's'} to unlock Scoring Insights
        </p>
        <div className="w-48 mx-auto h-[4px] bg-pulse-surface-2 rounded-full overflow-hidden" role="progressbar" aria-valuenow={rounds_with_stats || 0} aria-valuemin={0} aria-valuemax={TIER1_MIN_ROUNDS}>
          <div
            className="h-full bg-pulse-red rounded-full transition-all duration-700"
            style={{ width: `${Math.round(((rounds_with_stats || 0) / TIER1_MIN_ROUNDS) * 100)}%` }}
          />
        </div>
        <p className="text-[11px] text-pulse-text-3 mt-2">{rounds_with_stats || 0} / {TIER1_MIN_ROUNDS} rounds</p>
      </div>
    );
  }

  // Build feature sections with conditional dividers
  const sections = [
    fingerprint && (
      <FingerprintRadar
        key="fingerprint"
        fingerprint={fingerprint}
        fingerprintMens={fingerprint_mens}
        fingerprintWomens={fingerprint_womens}
        fingerprintByGroup={fingerprint_by_group}
        tier={tier}
        fpFilter={fpFilter}
        setFpFilter={setFpFilter}
      />
    ),
    pattern_breaks && <PatternBreakSection key="pattern" patternBreaks={pattern_breaks} />,
    disconnect && <DisconnectSection key="disconnect" disconnect={disconnect} />,
    consistency && <ConsistencyGauge key="consistency" consistency={consistency} />,
    drift && <DriftSparkline key="drift" drift={drift} />,
  ].filter(Boolean);

  return (
    <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-5">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center justify-between w-full text-left"
        aria-expanded={expanded}
        aria-controls="scoring-insights-content"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-pulse-red to-orange-600 flex items-center justify-center">
            <Zap size={16} className="text-white" />
          </div>
          <span className="font-heading font-bold text-[15px] uppercase tracking-wider text-pulse-text-2">
            Scoring Insights
          </span>
        </div>
        <ChevronRight
          size={16}
          className={`text-pulse-text-3 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
      </button>

      {expanded && (
        <div id="scoring-insights-content" className="mt-5 space-y-6 animate-in fade-in slide-in-from-top-2 duration-200">
          <TierBadge
            tier={tier}
            roundsWithStats={rounds_with_stats}
            tier2Progress={tier2_progress}
            tier3Progress={tier3_progress}
          />

          {sections.map((section, i) => (
            <div key={section.key}>
              {i > 0 && <div className="border-t border-white/[0.06] mb-6" />}
              {section}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ScoringInsightsCard;
