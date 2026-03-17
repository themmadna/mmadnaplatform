import { useState, useEffect, Fragment } from 'react';
import { ChevronLeft, Scale, AlertTriangle } from 'lucide-react';
import { dataService } from '../dataService';

const pct = (v) => v != null ? `${(v * 100).toFixed(1)}%` : '—';

const outlierColor = (rate) => {
  if (rate == null) return 'text-white/40';
  if (rate >= 0.10) return 'text-red-400';
  if (rate >= 0.07) return 'text-yellow-400';
  return 'text-green-400';
};

const StatBox = ({ label, value, sub, valueClass = 'text-white' }) => (
  <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-center">
    <p className="text-xs text-white/40 uppercase tracking-widest mb-1">{label}</p>
    <p className={`text-2xl font-black ${valueClass}`}>{value}</p>
    {sub && <p className="text-xs text-white/30 mt-1">{sub}</p>}
  </div>
);

const BiasBar = ({ label, pctVal, color = 'bg-[#D4AF37]' }) => (
  <div className="mb-3">
    <div className="flex justify-between text-xs mb-1">
      <span className="text-white/60">{label}</span>
      <span className="font-bold text-white/80">{pct(pctVal)}</span>
    </div>
    <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
      <div className={`h-full ${color} rounded-full transition-all duration-700`}
        style={{ width: `${Math.min((pctVal || 0) * 100, 100)}%` }} />
    </div>
  </div>
);

const GenderComparisonCard = ({ genderSplit, currentTheme }) => {
  const m = genderSplit?.mens;
  const w = genderSplit?.womens;
  if (!m || !w || m.rounds < 10 || w.rounds < 10) return null;

  const rows = [
    { label: 'Rounds',           mv: m.rounds,         wv: w.rounds,         fmt: v => v?.toLocaleString() ?? '—' },
    { label: 'Outlier Rate',     mv: m.outlier_rate,    wv: w.outlier_rate,   fmt: pct, highlightHigher: 'red' },
    { label: '10-8 Rate',        mv: m.ten_eight_rate,  wv: w.ten_eight_rate, fmt: pct },
    { label: 'Unanimous %',      mv: m.unanimous_pct,   wv: w.unanimous_pct,  fmt: pct, highlightHigher: 'green' },
    { label: 'Lone Dissenter %', mv: m.lone_pct,        wv: w.lone_pct,       fmt: pct, highlightHigher: 'red' },
  ];

  const colorFor = (isHigher, highlightHigher) => {
    if (!isHigher || !highlightHigher) return 'text-white/80';
    return highlightHigher === 'red' ? 'text-red-400' : 'text-green-400';
  };

  return (
    <div className={`${currentTheme.card} p-5 rounded-xl mb-4`}>
      <h3 className="text-xs font-bold uppercase tracking-widest text-white/50 mb-4">Men's vs Women's</h3>
      <div className="grid grid-cols-[1fr_auto_1fr] gap-y-3 items-center">
        <span className="text-xs font-bold text-white/40 text-center uppercase tracking-widest">Men's</span>
        <span />
        <span className="text-xs font-bold text-white/40 text-center uppercase tracking-widest">Women's</span>
        {rows.map(row => {
          const mHigher = row.mv != null && row.wv != null && row.mv > row.wv;
          const wHigher = row.mv != null && row.wv != null && row.wv > row.mv;
          return (
            <Fragment key={row.label}>
              <span className={`text-sm font-bold text-center ${colorFor(mHigher, row.highlightHigher)}`}>{row.fmt(row.mv)}</span>
              <span className="text-xs text-white/40 text-center px-4 whitespace-nowrap">{row.label}</span>
              <span className={`text-sm font-bold text-center ${colorFor(wHigher, row.highlightHigher)}`}>{row.fmt(row.wv)}</span>
            </Fragment>
          );
        })}
      </div>
      <p className="text-xs text-white/20 mt-3 text-center">
        {m.fights?.toLocaleString()} men's fights · {w.fights?.toLocaleString()} women's fights
      </p>
    </div>
  );
};

export default function JudgeProfileView({ judgeName, currentTheme, onBack, onCompare, onFightClick = null }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!judgeName) return;
    setLoading(true);
    setProfile(null);
    dataService.getJudgeProfile(judgeName).then(data => {
      setProfile(data);
      setLoading(false);
    });
  }, [judgeName]);

  if (loading) {
    return (
      <div className="pb-20">
        <button onClick={onBack} className="flex items-center gap-2 mb-6 text-xs font-bold uppercase tracking-widest text-white/40 hover:text-[#D4AF37] transition-colors">
          <ChevronLeft size={16} /> Judges
        </button>
        <div className="flex items-center justify-center py-20 text-white/40 text-sm">
          Loading profile...
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="pb-20">
        <button onClick={onBack} className="flex items-center gap-2 mb-6 text-xs font-bold uppercase tracking-widest text-white/40 hover:text-[#D4AF37] transition-colors">
          <ChevronLeft size={16} /> Judges
        </button>
        <p className="text-white/40 text-center py-20">No data found for {judgeName}.</p>
      </div>
    );
  }

  const ab = profile.agreement_breakdown || {};
  const sp = profile.style_preference || {};

  return (
    <div className="pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Back + Compare */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={onBack} className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/40 hover:text-[#D4AF37] transition-colors">
          <ChevronLeft size={16} /> Judges
        </button>
        <button onClick={onCompare} className="text-xs font-bold uppercase tracking-widest border border-white/20 text-white/50 hover:border-[#D4AF37]/60 hover:text-[#D4AF37] px-3 py-1.5 transition-all">
          Compare
        </button>
      </div>

      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <Scale size={24} className="text-[#D4AF37] mt-1 shrink-0" />
        <div>
          <h2 className="text-2xl font-black uppercase tracking-widest leading-tight">{profile.name}</h2>
          <p className="text-xs text-white/40 mt-1">
            {(profile.rounds_judged || 0).toLocaleString()} rounds · {(profile.fights_judged || 0).toLocaleString()} fights
            {profile.last_active && ` · Last active ${new Date(profile.last_active).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`}
          </p>
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <StatBox
          label="Outlier Rate"
          value={pct(profile.outlier_rate)}
          sub="lone dissenter"
          valueClass={outlierColor(profile.outlier_rate)}
        />
        <StatBox
          label="10-8 Rate"
          value={pct(profile.ten_eight_rate)}
          sub="dominant rounds"
        />
        <StatBox
          label="Unanimous"
          value={pct(ab.unanimous_pct)}
          sub="all 3 agreed"
        />
      </div>

      {/* Agreement Breakdown */}
      <div className={`${currentTheme.card} p-5 rounded-xl mb-4`}>
        <h3 className="text-xs font-bold uppercase tracking-widest text-white/50 mb-4">Agreement Breakdown</h3>
        <div className="space-y-2">
          {[
            { label: 'Unanimous (all 3 agreed)',     val: ab.unanimous_pct,      color: 'bg-green-500' },
            { label: 'Majority (2–1, with winner)',  val: ab.majority_pct,       color: 'bg-blue-500' },
            { label: 'Lone Dissenter (0 others)',    val: ab.lone_pct,           color: 'bg-red-500' },
          ].map(row => (
            <div key={row.label}>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-white/60">{row.label}</span>
                <span className="font-bold">{pct(row.val)}</span>
              </div>
              <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                <div className={`h-full ${row.color} rounded-full transition-all duration-700`}
                  style={{ width: `${Math.min((row.val || 0) * 100, 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-white/30 mt-3">{(ab.total || 0).toLocaleString()} scored rounds (excludes 10-10s)</p>
      </div>

      {/* Men's vs Women's Comparison */}
      <GenderComparisonCard genderSplit={profile.gender_split} currentTheme={currentTheme} />

      {/* Style Preference */}
      {sp.rounds > 0 && (
        <div className={`${currentTheme.card} p-5 rounded-xl mb-4`}>
          <h3 className="text-xs font-bold uppercase tracking-widest text-white/50 mb-1">Scoring Tendencies</h3>
          <p className="text-xs text-white/30 mb-4">{(sp.rounds || 0).toLocaleString()} rounds with fight stats</p>
          <BiasBar label="Winner had more sig strikes landed" pctVal={sp.striking_pct} color="bg-blue-500" />
          <BiasBar label="Winner had more TD + control time" pctVal={sp.grappling_pct} color="bg-amber-500" />
          <BiasBar label="Winner threw more volume (less accurate)" pctVal={sp.aggressor_pct} color="bg-purple-500" />
          <BiasBar label="Knockdown scored for winning fighter" pctVal={sp.kd_pct} color="bg-red-500" />
        </div>
      )}

      {/* By Division */}
      {profile.by_class && profile.by_class.length > 0 && (
        <div className={`${currentTheme.card} p-5 rounded-xl mb-4`}>
          <h3 className="text-xs font-bold uppercase tracking-widest text-white/50 mb-4">By Division</h3>
          <div className="space-y-2">
            {profile.by_class.map(row => (
              <div key={row.weight_class_clean} className="flex items-center justify-between text-sm py-1 border-b border-white/5 last:border-0">
                <span className="text-white/80 font-medium">{row.weight_class_clean}</span>
                <div className="flex gap-4 text-right">
                  <div>
                    <span className={`font-bold text-xs ${outlierColor(row.outlier_rate)}`}>{pct(row.outlier_rate)}</span>
                    <span className="text-white/30 text-xs ml-1">outlier</span>
                  </div>
                  <div>
                    <span className="text-white/60 text-xs">{pct(row.ten_eight_rate)}</span>
                    <span className="text-white/30 text-xs ml-1">10-8</span>
                  </div>
                  <span className="text-white/30 text-xs w-12 text-right">{row.rounds} rds</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Year Trend */}
      {profile.by_year && profile.by_year.length > 1 && (
        <div className={`${currentTheme.card} p-5 rounded-xl mb-4`}>
          <h3 className="text-xs font-bold uppercase tracking-widest text-white/50 mb-4">Outlier Rate by Year</h3>
          <div className="space-y-2">
            {profile.by_year.filter(y => y.rounds >= 10).map(row => (
              <div key={row.year} className="flex items-center gap-3">
                <span className="text-white/40 text-xs w-10">{row.year}</span>
                <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-700 ${
                      row.outlier_rate >= 0.10 ? 'bg-red-500' :
                      row.outlier_rate >= 0.07 ? 'bg-yellow-400' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min((row.outlier_rate || 0) * 500, 100)}%` }}
                  />
                </div>
                <span className={`text-xs font-bold w-10 text-right ${outlierColor(row.outlier_rate)}`}>
                  {pct(row.outlier_rate)}
                </span>
                <span className="text-white/20 text-xs w-12 text-right">{row.rounds} rds</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-white/20 mt-2">Years with &lt;10 rounds hidden</p>
        </div>
      )}

      {/* Controversial Fights */}
      {profile.controversial_fights && profile.controversial_fights.length > 0 && (
        <div className={`${currentTheme.card} p-5 rounded-xl mb-4`}>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={14} className="text-yellow-400" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-white/50">Most Controversial Decisions</h3>
          </div>
          <div className="space-y-3">
            {profile.controversial_fights.map((fight, i) => {
              const clickable = onFightClick && fight.fight_url;
              return (
                <div
                  key={i}
                  onClick={clickable ? () => onFightClick({ fight_url: fight.fight_url, event_name: fight.event_name, event_date: fight.fight_date, status: 'completed' }) : undefined}
                  className={`flex items-center justify-between py-1 border-b border-white/5 last:border-0 ${clickable ? 'cursor-pointer hover:bg-white/5 rounded px-1 -mx-1 transition-colors' : ''}`}
                >
                  <div>
                    <p className="text-sm font-semibold text-white/90">{fight.bout}</p>
                    <p className="text-xs text-white/30">
                      {new Date(fight.fight_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-red-400 font-bold text-sm">{fight.outlier_rounds} / {fight.total_rounds}</p>
                    <p className="text-white/30 text-xs">rounds as lone dissenter</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
