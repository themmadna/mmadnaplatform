import { useState, useEffect } from 'react';
import { ChevronLeft, Scale, AlertTriangle, Search } from 'lucide-react';
import { dataService } from '../dataService';

const pct = (v) => v != null ? `${(v * 100).toFixed(1)}%` : '—';

const outlierColor = (rate) => {
  if (rate == null) return 'text-white/40';
  if (rate >= 0.10) return 'text-red-400';
  if (rate >= 0.07) return 'text-yellow-400';
  return 'text-green-400';
};

const agreeColor = (rate) => {
  if (rate == null) return 'text-white/60';
  if (rate >= 0.75) return 'text-green-400';
  if (rate >= 0.60) return 'text-yellow-400';
  return 'text-red-400';
};

// Two-color bar: blue = user, amber = judge
const DualBar = ({ label, v1, v2 }) => {
  const w1 = Math.min((v1 || 0) * 100, 100);
  const w2 = Math.min((v2 || 0) * 100, 100);
  return (
    <div className="mb-4">
      <div className="flex justify-between text-xs mb-1">
        <span className="text-white/50">{label}</span>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-blue-400 font-bold w-10 text-right">{pct(v1)}</span>
        <div className="flex-1 h-2 bg-white/10 rounded-full overflow-hidden relative">
          <div className="absolute inset-y-0 left-0 bg-blue-500/60 rounded-l-full transition-all duration-700"
            style={{ width: `${w1}%` }} />
          <div className="absolute inset-y-0 right-0 bg-amber-500/60 rounded-r-full transition-all duration-700"
            style={{ width: `${w2}%` }} />
        </div>
        <span className="text-amber-400 font-bold w-10">{pct(v2)}</span>
      </div>
    </div>
  );
};

export default function UserJudgeComparison({
  currentTheme,
  onBack,
  onViewJudge,
  onFightClick,
  userProfile,
  initialJudge = null,
}) {
  const [selectedJudge, setSelectedJudge] = useState(initialJudge);
  const [judgeList, setJudgeList] = useState([]);
  const [search, setSearch] = useState('');
  const [judgeProfile, setJudgeProfile] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(true);

  useEffect(() => {
    dataService.getJudgeDirectory().then(list => {
      setJudgeList(list);
      setLoadingList(false);
    });
  }, []);

  useEffect(() => {
    if (!selectedJudge) return;
    setLoading(true);
    Promise.all([
      dataService.getJudgeProfile(selectedJudge),
      dataService.getUserJudgeComparison(selectedJudge),
    ]).then(([jp, cmp]) => {
      setJudgeProfile(jp);
      setComparison(cmp);
      setLoading(false);
    });
  }, [selectedJudge]);

  const filteredList = judgeList.filter(j =>
    j.name.toLowerCase().includes(search.toLowerCase())
  );

  // --- PICKER VIEW ---
  if (!selectedJudge) {
    return (
      <div className="pb-20 animate-in fade-in duration-300">
        <button onClick={onBack} className="flex items-center gap-2 mb-6 text-xs font-bold uppercase tracking-widest text-white/40 hover:text-[#D4AF37] transition-colors">
          <ChevronLeft size={16} /> Judging DNA
        </button>
        <div className="flex items-center gap-3 mb-6">
          <Scale size={20} className="text-[#D4AF37]" />
          <div>
            <h2 className="text-lg font-black uppercase tracking-widest">You vs Judge</h2>
            <p className="text-white/40 text-xs">Pick a judge to compare your scoring against</p>
          </div>
        </div>

        <div className="relative mb-4">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
          <input
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-[#D4AF37]/50"
            placeholder="Search judges..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        {loadingList ? (
          <p className="text-white/30 text-sm text-center py-8">Loading...</p>
        ) : (
          <div className="space-y-1">
            {filteredList.map(j => (
              <button
                key={j.name}
                onClick={() => setSelectedJudge(j.name)}
                className="w-full flex justify-between items-center px-4 py-3 rounded-xl hover:bg-white/5 text-left transition-colors border border-transparent hover:border-white/10"
              >
                <span className="font-semibold text-white/90">{j.name}</span>
                <span className="text-white/30 text-xs">{j.rounds_judged.toLocaleString()} rds</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // --- LOADING STATE ---
  if (loading) {
    return (
      <div className="pb-20">
        <button onClick={() => setSelectedJudge(null)} className="flex items-center gap-2 mb-6 text-xs font-bold uppercase tracking-widest text-white/40 hover:text-[#D4AF37] transition-colors">
          <ChevronLeft size={16} /> Change judge
        </button>
        <div className="flex items-center justify-center py-20 text-white/40 text-sm">Loading comparison...</div>
      </div>
    );
  }

  if (!judgeProfile || !comparison) return null;

  const sp = judgeProfile.style_preference || {};
  const ub = userProfile || {};
  const svgBias = ub.striking_vs_grappling_bias || {};
  const hasTendencies = (svgBias.rounds > 0) || (sp.rounds > 0);

  const agreePct = comparison.agreement_rate;
  const judgeName = selectedJudge;

  return (
    <div className="pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Back + change */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={onBack} className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/40 hover:text-[#D4AF37] transition-colors">
          <ChevronLeft size={16} /> Back
        </button>
        <button onClick={() => setSelectedJudge(null)} className="text-xs text-white/30 hover:text-white/60 transition-colors underline">
          Change judge
        </button>
      </div>

      {/* Header */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-3 mb-1">
          <span className="text-blue-400 font-black text-lg">You</span>
          <span className="text-white/30 font-bold">vs</span>
          <button onClick={() => onViewJudge(judgeName)} className="text-amber-400 font-black text-lg hover:underline">
            {judgeName}
          </button>
        </div>
        <p className="text-xs text-white/30">
          {(comparison.shared_rounds || 0).toLocaleString()} shared rounds · {(comparison.shared_fights || 0).toLocaleString()} fights
        </p>
      </div>

      {/* Agreement rate — hero stat */}
      <div className={`${currentTheme.card} p-5 rounded-xl mb-4 text-center`}>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-1">Agreement Rate</p>
        <p className={`text-4xl font-black mb-1 ${agreeColor(agreePct)}`}>{pct(agreePct)}</p>
        <p className="text-xs text-white/30">of shared rounds you scored the same winner</p>
      </div>

      {/* Side-by-side stats */}
      <div className={`${currentTheme.card} p-5 rounded-xl mb-4`}>
        <div className="grid grid-cols-3 text-xs text-center mb-3">
          <span className="text-blue-400 font-bold">You</span>
          <span className="text-white/30 uppercase tracking-widest">Metric</span>
          <span className="text-amber-400 font-bold truncate">{judgeName.split(' ').pop()}</span>
        </div>
        {[
          {
            label: 'Rounds scored / judged',
            v1: (ub.rounds_scored || 0).toLocaleString(),
            v2: (judgeProfile.rounds_judged || 0).toLocaleString(),
            raw: true,
          },
          {
            label: 'Outlier rate',
            v1: pct(ub.outlier_rate),
            v2: pct(judgeProfile.outlier_rate),
            c1: outlierColor(ub.outlier_rate),
            c2: outlierColor(judgeProfile.outlier_rate),
          },
          {
            label: '10-8 rate',
            v1: pct(ub.ten_eight_rate),
            v2: pct(judgeProfile.ten_eight_rate),
          },
        ].map(row => (
          <div key={row.label} className="grid grid-cols-3 text-sm py-2 border-b border-white/5 last:border-0 items-center">
            <span className={`font-bold text-right pr-3 ${row.c1 || 'text-white/80'}`}>{row.v1}</span>
            <span className="text-white/30 text-xs text-center">{row.label}</span>
            <span className={`font-bold text-left pl-3 ${row.c2 || 'text-white/80'}`}>{row.v2}</span>
          </div>
        ))}
      </div>

      {/* Scoring Tendencies */}
      {hasTendencies && (
        <div className={`${currentTheme.card} p-5 rounded-xl mb-4`}>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-white/50">Scoring Tendencies</h3>
            <div className="flex gap-3 text-xs">
              <span className="text-blue-400 font-bold">You</span>
              <span className="text-amber-400 font-bold">{judgeName.split(' ').pop()}</span>
            </div>
          </div>
          <DualBar label="Striking winner (more sig strikes landed)" v1={svgBias.striking_pct}   v2={sp.striking_pct} />
          <DualBar label="Grappling winner (more TD + ctrl time)"   v1={svgBias.grappling_pct}  v2={sp.grappling_pct} />
          <DualBar label="Volume aggressor (more attempts)"         v1={ub.aggressor_bias}       v2={sp.aggressor_pct} />
          <DualBar label="Knockdown scorer rewarded"                v1={ub.knockdown_bias?.kd_bias_pct} v2={sp.kd_pct} />
        </div>
      )}

      {/* Agreement by division */}
      {comparison.by_class && comparison.by_class.length > 0 && (
        <div className={`${currentTheme.card} p-5 rounded-xl mb-4`}>
          <h3 className="text-xs font-bold uppercase tracking-widest text-white/50 mb-3">Agreement by Division</h3>
          <div className="space-y-2">
            {comparison.by_class.map(row => (
              <div key={row.weight_class_clean} className="flex items-center gap-3">
                <span className="text-xs text-white/50 w-28 flex-shrink-0 truncate">{row.weight_class_clean}</span>
                <div className="flex-1 bg-black/30 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-700 ${
                      row.agreement_pct >= 0.75 ? 'bg-green-500' :
                      row.agreement_pct >= 0.60 ? 'bg-yellow-400' : 'bg-red-500'
                    }`}
                    style={{ width: `${Math.round((row.agreement_pct || 0) * 100)}%` }}
                  />
                </div>
                <span className={`text-xs font-bold w-10 text-right ${agreeColor(row.agreement_pct)}`}>
                  {Math.round((row.agreement_pct || 0) * 100)}%
                </span>
                <span className="text-xs text-white/25 w-8 text-right">{row.rounds}r</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Top disagreement fights */}
      {comparison.top_disagreements && comparison.top_disagreements.length > 0 && (
        <div className={`${currentTheme.card} p-5 rounded-xl mb-4`}>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle size={14} className="text-yellow-400" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-white/50">Biggest Disagreements</h3>
          </div>
          <div className="space-y-3">
            {comparison.top_disagreements.map((fight, i) => (
              <div
                key={i}
                onClick={() => onFightClick?.({
                  fight_url: fight.fight_url,
                  bout: fight.bout,
                  event_date: fight.fight_date,
                })}
                className={`flex items-center justify-between py-1 border-b border-white/5 last:border-0 ${onFightClick ? 'cursor-pointer hover:bg-white/5 rounded-lg px-2 -mx-2 transition-colors' : ''}`}
              >
                <div>
                  <p className="text-sm font-semibold text-white/90">{fight.bout}</p>
                  <p className="text-xs text-white/30">
                    {new Date(fight.fight_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-yellow-400 font-bold text-sm">{fight.disagreement_rounds} / {fight.scored_rounds}</p>
                  <p className="text-white/30 text-xs">rounds disagreed</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {comparison.shared_rounds === 0 && (
        <div className={`${currentTheme.card} p-6 rounded-xl text-center`}>
          <p className="text-white/40 text-sm">No shared rounds found.</p>
          <p className="text-white/25 text-xs mt-1">Score fights that {judgeName} has judged to see a comparison.</p>
        </div>
      )}
    </div>
  );
}
