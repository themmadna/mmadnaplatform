import { useState, useEffect } from 'react';
import { ChevronLeft, Scale, AlertTriangle, Search, ChevronRight } from 'lucide-react';
import { dataService } from '../dataService';
import { supabase } from '../supabaseClient';

const pct = (v) => v != null ? `${(v * 100).toFixed(1)}%` : '—';

const outlierColor = (rate) => {
  if (rate == null) return 'text-white/40';
  if (rate >= 0.10) return 'text-red-400';
  if (rate >= 0.07) return 'text-yellow-400';
  return 'text-green-400';
};

// Two-color bar showing both judges' values
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

export default function JudgeComparison({ judge1Name, currentTheme, onBack, onViewProfile, onFightClick }) {
  const [judge2Name, setJudge2Name] = useState(null);
  const [judgeList, setJudgeList] = useState([]);
  const [search, setSearch] = useState('');
  const [profile1, setProfile1] = useState(null);
  const [profile2, setProfile2] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(true);

  // Fetch directory for the picker
  useEffect(() => {
    dataService.getJudgeDirectory().then(list => {
      setJudgeList(list.filter(j => j.name !== judge1Name));
      setLoadingList(false);
    });
  }, [judge1Name]);

  // Fetch both profiles + comparison when judge2 is selected
  useEffect(() => {
    if (!judge2Name) return;
    setLoading(true);
    Promise.all([
      dataService.getJudgeProfile(judge1Name),
      dataService.getJudgeProfile(judge2Name),
      dataService.getJudgeComparison(judge1Name, judge2Name),
    ]).then(([p1, p2, cmp]) => {
      setProfile1(p1);
      setProfile2(p2);
      setComparison(cmp);
      setLoading(false);
    });
  }, [judge1Name, judge2Name]);

  const filteredList = judgeList.filter(j =>
    j.name.toLowerCase().includes(search.toLowerCase())
  );

  // --- PICKER VIEW ---
  if (!judge2Name) {
    return (
      <div className="pb-20 animate-in fade-in duration-300">
        <button onClick={onBack} className="flex items-center gap-2 mb-6 text-xs font-bold uppercase tracking-widest text-white/40 hover:text-[#D4AF37] transition-colors">
          <ChevronLeft size={16} /> {judge1Name}
        </button>
        <div className="flex items-center gap-3 mb-6">
          <Scale size={20} className="text-[#D4AF37]" />
          <div>
            <h2 className="text-lg font-black uppercase tracking-widest">Compare Judges</h2>
            <p className="text-white/40 text-xs">{judge1Name} vs...</p>
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
                onClick={() => setJudge2Name(j.name)}
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
        <button onClick={() => setJudge2Name(null)} className="flex items-center gap-2 mb-6 text-xs font-bold uppercase tracking-widest text-white/40 hover:text-[#D4AF37] transition-colors">
          <ChevronLeft size={16} /> Change judge
        </button>
        <div className="flex items-center justify-center py-20 text-white/40 text-sm">Loading comparison...</div>
      </div>
    );
  }

  if (!profile1 || !profile2 || !comparison) return null;

  const sp1 = profile1.style_preference || {};
  const sp2 = profile2.style_preference || {};
  const ab1 = profile1.agreement_breakdown || {};
  const ab2 = profile2.agreement_breakdown || {};

  // Build merged by_class comparison
  const classMap = {};
  (profile1.by_class || []).forEach(r => { classMap[r.weight_class_clean] = { c1: r }; });
  (profile2.by_class || []).forEach(r => {
    if (!classMap[r.weight_class_clean]) classMap[r.weight_class_clean] = {};
    classMap[r.weight_class_clean].c2 = r;
  });
  const sharedClasses = Object.entries(classMap)
    .filter(([, v]) => v.c1 && v.c2)
    .sort((a, b) => (b[1].c1.rounds + b[1].c2.rounds) - (a[1].c1.rounds + a[1].c2.rounds))
    .slice(0, 8);

  const disagreePct = comparison.disagreement_rate;

  return (
    <div className="pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Back + change */}
      <div className="flex items-center justify-between mb-6">
        <button onClick={onBack} className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/40 hover:text-[#D4AF37] transition-colors">
          <ChevronLeft size={16} /> Back
        </button>
        <button onClick={() => setJudge2Name(null)} className="text-xs text-white/30 hover:text-white/60 transition-colors underline">
          Change judge
        </button>
      </div>

      {/* Header */}
      <div className="text-center mb-6">
        <div className="flex items-center justify-center gap-3 mb-1">
          <button onClick={() => onViewProfile(judge1Name)} className="text-blue-400 font-black text-lg hover:underline">{judge1Name}</button>
          <span className="text-white/30 font-bold">vs</span>
          <button onClick={() => onViewProfile(judge2Name)} className="text-amber-400 font-black text-lg hover:underline">{judge2Name}</button>
        </div>
        <p className="text-xs text-white/30">
          {(comparison.shared_rounds || 0).toLocaleString()} shared rounds · {(comparison.shared_fights || 0).toLocaleString()} fights together
        </p>
      </div>

      {/* Disagreement rate — hero stat */}
      <div className={`${currentTheme.card} p-5 rounded-xl mb-4 text-center`}>
        <p className="text-xs text-white/40 uppercase tracking-widest mb-1">Disagreement Rate</p>
        <p className={`text-4xl font-black mb-1 ${
          disagreePct >= 0.15 ? 'text-red-400' : disagreePct >= 0.10 ? 'text-yellow-400' : 'text-green-400'
        }`}>{pct(disagreePct)}</p>
        <p className="text-xs text-white/30">of shared rounds they scored differently</p>
      </div>

      {/* Side-by-side stats */}
      <div className={`${currentTheme.card} p-5 rounded-xl mb-4`}>
        <div className="grid grid-cols-3 text-xs text-center mb-3">
          <span className="text-blue-400 font-bold truncate">{judge1Name.split(' ').pop()}</span>
          <span className="text-white/30 uppercase tracking-widest">Metric</span>
          <span className="text-amber-400 font-bold truncate">{judge2Name.split(' ').pop()}</span>
        </div>
        {[
          { label: 'Rounds judged', v1: profile1.rounds_judged?.toLocaleString(), v2: profile2.rounds_judged?.toLocaleString(), raw: true },
          { label: 'Outlier rate',  v1: pct(profile1.outlier_rate),   v2: pct(profile2.outlier_rate),   c1: outlierColor(profile1.outlier_rate), c2: outlierColor(profile2.outlier_rate) },
          { label: '10-8 rate',     v1: pct(profile1.ten_eight_rate), v2: pct(profile2.ten_eight_rate) },
          { label: 'Unanimous %',   v1: pct(ab1.unanimous_pct),       v2: pct(ab2.unanimous_pct) },
          { label: 'Lone dissenter',v1: pct(ab1.lone_pct),            v2: pct(ab2.lone_pct),            c1: outlierColor(profile1.outlier_rate), c2: outlierColor(profile2.outlier_rate) },
        ].map(row => (
          <div key={row.label} className="grid grid-cols-3 text-sm py-2 border-b border-white/5 last:border-0 items-center">
            <span className={`font-bold text-right pr-3 ${row.c1 || 'text-white/80'}`}>{row.v1}</span>
            <span className="text-white/30 text-xs text-center">{row.label}</span>
            <span className={`font-bold text-left pl-3 ${row.c2 || 'text-white/80'}`}>{row.v2}</span>
          </div>
        ))}
      </div>

      {/* Scoring Tendencies overlay */}
      {(sp1.rounds > 0 || sp2.rounds > 0) && (
        <div className={`${currentTheme.card} p-5 rounded-xl mb-4`}>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-white/50">Scoring Tendencies</h3>
            <div className="flex gap-3 text-xs">
              <span className="text-blue-400 font-bold">{judge1Name.split(' ').pop()}</span>
              <span className="text-amber-400 font-bold">{judge2Name.split(' ').pop()}</span>
            </div>
          </div>
          <DualBar label="Striking winner (more sig strikes landed)" v1={sp1.striking_pct}  v2={sp2.striking_pct} />
          <DualBar label="Grappling winner (more TD + ctrl time)"   v1={sp1.grappling_pct} v2={sp2.grappling_pct} />
          <DualBar label="Volume aggressor (more attempts)"         v1={sp1.aggressor_pct} v2={sp2.aggressor_pct} />
          <DualBar label="Knockdown scorer rewarded"                v1={sp1.kd_pct}        v2={sp2.kd_pct} />
        </div>
      )}

      {/* By Division overlay */}
      {sharedClasses.length > 0 && (
        <div className={`${currentTheme.card} p-5 rounded-xl mb-4`}>
          <h3 className="text-xs font-bold uppercase tracking-widest text-white/50 mb-3">Outlier Rate by Division</h3>
          <div className="grid grid-cols-3 text-xs text-center text-white/30 mb-2">
            <span className="text-blue-400">{judge1Name.split(' ').pop()}</span>
            <span>Division</span>
            <span className="text-amber-400">{judge2Name.split(' ').pop()}</span>
          </div>
          {sharedClasses.map(([cls, { c1, c2 }]) => (
            <div key={cls} className="grid grid-cols-3 text-sm py-2 border-b border-white/5 last:border-0 items-center">
              <span className={`font-bold text-right pr-3 ${outlierColor(c1.outlier_rate)}`}>{pct(c1.outlier_rate)}</span>
              <span className="text-white/50 text-xs text-center">{cls}</span>
              <span className={`font-bold text-left pl-3 ${outlierColor(c2.outlier_rate)}`}>{pct(c2.outlier_rate)}</span>
            </div>
          ))}
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
                onClick={async () => {
                  if (!onFightClick) return;
                  const reversed = fight.bout.split(' vs ').reverse().join(' vs ');
                  const { data } = await supabase
                    .from('fights')
                    .select('*')
                    .or(`fight_url.is.null,fight_url.neq.placeholder`)
                    .or(`bout.eq.${fight.bout},bout.eq.${reversed}`)
                    .limit(1);
                  if (data?.[0]) {
                    onFightClick({ ...data[0], event_date: fight.fight_date });
                  }
                }}
                className={`flex items-center justify-between py-1 border-b border-white/5 last:border-0 ${onFightClick ? 'cursor-pointer hover:bg-white/5 rounded-lg px-2 -mx-2 transition-colors' : ''}`}
              >
                <div>
                  <p className="text-sm font-semibold text-white/90">{fight.bout}</p>
                  <p className="text-xs text-white/30">
                    {new Date(fight.fight_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <div className="text-right">
                    <p className="text-yellow-400 font-bold text-sm">{fight.disagreement_rounds} / {fight.scored_rounds}</p>
                    <p className="text-white/30 text-xs">rounds disagreed</p>
                  </div>
                  {onFightClick && <ChevronRight size={14} className="text-white/20" />}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
