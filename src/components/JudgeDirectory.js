import { useState, useEffect } from 'react';
import { ChevronUp, ChevronDown, Scale } from 'lucide-react';
import { dataService } from '../dataService';

const SORT_OPTIONS = [
  { key: 'rounds_judged', label: 'Rounds' },
  { key: 'outlier_rate',  label: 'Outlier %' },
  { key: 'ten_eight_rate', label: '10-8 %' },
  { key: 'last_active',  label: 'Last Active' },
];

export default function JudgeDirectory({ currentTheme, onSelectJudge }) {
  const [judges, setJudges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState('rounds_judged');
  const [sortAsc, setSortAsc] = useState(false);

  useEffect(() => {
    dataService.getJudgeDirectory().then(data => {
      setJudges(data);
      setLoading(false);
    });
  }, []);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortAsc(a => !a);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sorted = [...judges].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (av == null) return 1;
    if (bv == null) return -1;
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return sortAsc ? cmp : -cmp;
  });

  const SortIcon = ({ col }) => {
    if (sortKey !== col) return null;
    return sortAsc
      ? <ChevronUp size={12} className="inline ml-1" />
      : <ChevronDown size={12} className="inline ml-1" />;
  };

  const outlierColor = (rate) => {
    if (rate == null) return 'text-white/40';
    if (rate >= 0.10) return 'text-red-400';
    if (rate >= 0.07) return 'text-yellow-400';
    return 'text-green-400';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-white/40 text-sm">
        Loading judges...
      </div>
    );
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3 mb-6">
        <Scale size={20} className="text-[#D4AF37]" />
        <div>
          <h2 className="text-lg font-black uppercase tracking-widest">Judge Directory</h2>
          <p className="text-xs text-white/40">{judges.length} judges · 50+ rounds minimum</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-white/40 text-xs uppercase tracking-widest border-b border-white/10">
              <th className="text-left pb-3 pr-4 font-semibold">Judge</th>
              {SORT_OPTIONS.map(opt => (
                <th
                  key={opt.key}
                  className="text-right pb-3 px-3 font-semibold cursor-pointer hover:text-[#D4AF37] transition-colors select-none whitespace-nowrap"
                  onClick={() => handleSort(opt.key)}
                >
                  {opt.label}<SortIcon col={opt.key} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((judge, i) => (
              <tr
                key={judge.name}
                className="border-b border-white/5 hover:bg-white/5 cursor-pointer transition-colors"
                onClick={() => onSelectJudge(judge.name)}
              >
                <td className="py-3 pr-4 font-semibold text-white/90">
                  <span className="text-white/20 text-xs mr-2">{i + 1}</span>
                  {judge.name}
                </td>
                <td className="py-3 px-3 text-right text-white/70">
                  {judge.rounds_judged.toLocaleString()}
                  <span className="text-white/30 text-xs ml-1">({judge.fights_judged})</span>
                </td>
                <td className={`py-3 px-3 text-right font-bold ${outlierColor(judge.outlier_rate)}`}>
                  {judge.outlier_rate != null ? `${(judge.outlier_rate * 100).toFixed(1)}%` : '—'}
                </td>
                <td className="py-3 px-3 text-right text-white/70">
                  {judge.ten_eight_rate != null ? `${(judge.ten_eight_rate * 100).toFixed(1)}%` : '—'}
                </td>
                <td className="py-3 px-3 text-right text-white/40 text-xs">
                  {judge.last_active
                    ? new Date(judge.last_active).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex gap-4 text-xs text-white/30">
        <span><span className="text-green-400 font-bold">Green</span> outlier rate &lt; 7%</span>
        <span><span className="text-yellow-400 font-bold">Yellow</span> 7–10%</span>
        <span><span className="text-red-400 font-bold">Red</span> &gt; 10%</span>
      </div>
    </div>
  );
}
