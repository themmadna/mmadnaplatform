import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { dataService } from '../dataService';
import { Trophy, ChevronLeft, ChevronDown, ChevronUp } from 'lucide-react';

const lastName = (name) => name ? name.split(' ').slice(-1)[0] : '?';

const ResultDot = ({ correct }) => {
  if (correct === true)  return <div className="w-2 h-2 rounded-full bg-pulse-green flex-shrink-0 mt-0.5" />;
  if (correct === false) return <div className="w-2 h-2 rounded-full bg-pulse-red flex-shrink-0 mt-0.5" />;
  return <div className="w-2 h-2 rounded-full bg-white/20 flex-shrink-0 mt-0.5" />;
};

export default function Leaderboard({ currentTheme, onBack, onFightClick }) {
  const [rows, setRows]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);

  // Expand state
  const [expandedRow, setExpandedRow] = useState(null);   // user_id | null
  const [expandedTab, setExpandedTab] = useState('fights'); // 'fights' | 'rounds'
  const [detailCache, setDetailCache] = useState({});      // { [user_id]: { fights, rounds, loading, error } }

  useEffect(() => {
    async function load() {
      try {
        const [{ data: { user } }, data] = await Promise.all([
          supabase.auth.getUser(),
          dataService.getLeaderboard(),
        ]);
        setCurrentUserId(user?.id ?? null);
        setRows(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('[Leaderboard] load error:', err);
        setRows([]);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleRowClick = async (userId) => {
    if (expandedRow === userId) {
      setExpandedRow(null);
      return;
    }
    setExpandedRow(userId);
    setExpandedTab('fights');

    // Return early if already cached
    if (detailCache[userId] && !detailCache[userId].loading) return;

    setDetailCache(prev => ({ ...prev, [userId]: { fights: [], rounds: [], loading: true, error: false } }));
    try {
      const detail = await dataService.getLeaderboardUserDetail(userId);
      setDetailCache(prev => ({ ...prev, [userId]: { fights: detail.fights ?? [], rounds: detail.rounds ?? [], loading: false, error: false } }));
    } catch (err) {
      console.error('[Leaderboard] detail fetch error:', err);
      setDetailCache(prev => ({ ...prev, [userId]: { fights: [], rounds: [], loading: false, error: true } }));
    }
  };

  const displayName = (row) => {
    if (row.display_name) return row.display_name;
    const suffix = (row.user_id || '').slice(-4).toUpperCase();
    return `Scorer #${suffix}`;
  };

  const rankColor = (rank) => {
    if (rank === 1) return 'text-yellow-400';
    if (rank === 2) return 'text-slate-300';
    if (rank === 3) return 'text-amber-600';
    return 'text-pulse-text-3';
  };

  const accBadgeClass = (pct) =>
    pct >= 70 ? 'bg-pulse-green/[0.12] text-pulse-green'
    : pct >= 55 ? 'bg-yellow-500/[0.12] text-yellow-400'
    : 'bg-white/[0.06] text-pulse-text-3';

  // ── Expand panel ──────────────────────────────────────────────────────────

  const ExpandPanel = ({ userId }) => {
    const cache = detailCache[userId] ?? { fights: [], rounds: [], loading: true, error: false };

    if (cache.loading) {
      return (
        <div className="px-4 pb-4 pt-2 space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-white/[0.08] flex-shrink-0 animate-pulse" />
              <div className="h-3 bg-white/[0.06] rounded animate-pulse flex-1" />
            </div>
          ))}
        </div>
      );
    }

    if (cache.error) {
      return (
        <div className="px-4 pb-4 pt-2">
          <p className="text-xs text-pulse-text-3">Could not load details.</p>
        </div>
      );
    }

    const fights = cache.fights ?? [];
    const rounds = cache.rounds ?? [];
    const activeList = expandedTab === 'fights' ? fights : rounds;
    const isEmpty = activeList.length === 0;

    return (
      <div className="px-4 pb-4 pt-2 border-t border-white/[0.04]">
        {/* Tab pills */}
        <div className="flex gap-2 mb-3">
          {['fights', 'rounds'].map(tab => (
            <button
              key={tab}
              onClick={(e) => { e.stopPropagation(); setExpandedTab(tab); }}
              className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors
                ${expandedTab === tab
                  ? 'bg-pulse-red/[0.15] text-pulse-red'
                  : 'bg-white/[0.06] text-pulse-text-3 hover:bg-white/[0.10]'}`}
            >
              {tab === 'fights' ? `Fights (${fights.length})` : `Rounds (${rounds.length})`}
            </button>
          ))}
        </div>

        {/* List */}
        {isEmpty ? (
          <p className="text-xs text-pulse-text-3 py-1">
            {expandedTab === 'fights' ? 'No eligible decision fights yet.' : 'No matched rounds yet.'}
          </p>
        ) : (
          <div className="space-y-2">
            {expandedTab === 'fights' && fights.map((f, i) => {
              const fightObj = onFightClick ? {
                fight_url: f.fight_url,
                bout: `${f.fighter1_name} vs ${f.fighter2_name}`,
                event_name: f.event_name,
                event_date: f.event_date,
              } : null;
              return (
                <div
                  key={i}
                  onClick={fightObj ? (e) => { e.stopPropagation(); onFightClick(fightObj); } : undefined}
                  className={`flex items-start gap-2 ${fightObj ? 'cursor-pointer active:opacity-70' : ''}`}
                >
                  <ResultDot correct={f.correct} />
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-pulse-text-2 truncate block">
                      {lastName(f.fighter1_name)} vs {lastName(f.fighter2_name)}
                    </span>
                    <span className="text-[10px] text-pulse-text-3 truncate block">{f.event_name}</span>
                  </div>
                </div>
              );
            })}

            {expandedTab === 'rounds' && rounds.map((r, i) => {
              const fightObj = onFightClick ? {
                fight_url: r.fight_url,
                bout: `${r.fighter1_name} vs ${r.fighter2_name}`,
                event_name: r.event_name,
                event_date: r.event_date,
              } : null;
              return (
                <div
                  key={i}
                  onClick={fightObj ? (e) => { e.stopPropagation(); onFightClick(fightObj); } : undefined}
                  className={`flex items-start gap-2 ${fightObj ? 'cursor-pointer active:opacity-70' : ''}`}
                >
                  <ResultDot correct={r.matched} />
                  <div className="min-w-0">
                    <span className="text-xs font-semibold text-pulse-text-2 truncate block">
                      {lastName(r.fighter1_name)} vs {lastName(r.fighter2_name)}
                      <span className="text-pulse-text-3 font-normal"> · Rd {r.round}</span>
                    </span>
                    <span className="text-[10px] text-pulse-text-3 truncate block">{r.event_name}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="animate-in slide-in-from-right pb-20">
      {/* Header */}
      <div className="flex items-center gap-3 mb-1">
        <button
          onClick={onBack}
          aria-label="Back"
          className="w-9 h-9 flex items-center justify-center rounded-full bg-pulse-surface-2 border border-white/[0.06] active:scale-90 transition-transform"
        >
          <ChevronLeft size={18} className="text-pulse-text-2" />
        </button>
        <div className="flex items-center gap-2 opacity-60">
          <Trophy size={20} />
          <span className="font-bold tracking-wide">LEADERBOARD</span>
        </div>
      </div>
      <p className="text-xs text-pulse-text-3 mb-6 ml-12">
        Decision accuracy — blind-scored only · tap a row to expand
      </p>

      {/* Loading skeleton */}
      {loading && (
        <div className="bg-pulse-surface border border-white/[0.06] rounded-fight overflow-hidden">
          <div className="grid grid-cols-[36px_1fr_40px_56px_40px_64px] gap-2 px-4 py-3 border-b border-white/[0.06]">
            {['w-4','w-20','w-6','w-10','w-6','w-10'].map((w, i) => (
              <div key={i} className={`h-3 ${w} bg-white/[0.06] rounded animate-pulse`} />
            ))}
          </div>
          {[1, 2, 3].map(i => (
            <div key={i} className="grid grid-cols-[36px_1fr_40px_56px_40px_64px] gap-2 items-center px-4 py-3.5 border-b border-white/[0.04] last:border-0">
              <div className="h-4 w-5 bg-white/[0.06] rounded animate-pulse" />
              <div className="h-4 w-28 bg-white/[0.06] rounded animate-pulse" />
              <div className="h-4 w-6 bg-white/[0.06] rounded animate-pulse mx-auto" />
              <div className="h-5 w-12 bg-white/[0.06] rounded-full animate-pulse mx-auto" />
              <div className="h-4 w-6 bg-white/[0.06] rounded animate-pulse mx-auto" />
              <div className="h-5 w-12 bg-white/[0.06] rounded-full animate-pulse ml-auto" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && rows?.length === 0 && (
        <div className="bg-pulse-surface border border-white/[0.06] rounded-fight p-10 text-center">
          <Trophy size={36} className="mx-auto text-pulse-text-3 mb-3 opacity-40" />
          <p className="text-sm text-pulse-text-2 font-semibold mb-1">No leaderboard data yet</p>
          <p className="text-xs text-pulse-text-3">Score more fights blind to appear here</p>
        </div>
      )}

      {/* Leaderboard table */}
      {!loading && rows?.length > 0 && (
        <div className="bg-pulse-surface border border-white/[0.06] rounded-fight overflow-hidden">
          {/* Column headers */}
          <div className="grid grid-cols-[36px_1fr_40px_56px_40px_64px] gap-2 px-4 py-3 border-b border-white/[0.06]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-pulse-text-3">#</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-pulse-text-3">Scorer</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-pulse-text-3 text-center">Dec</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-pulse-text-3 text-center">Fight%</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-pulse-text-3 text-center">Rnds</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-pulse-text-3 text-right">Round%</span>
          </div>

          {rows.map((row) => {
            const isMe = row.user_id === currentUserId;
            const isExpanded = expandedRow === row.user_id;

            return (
              <div
                key={row.user_id}
                className={`border-b border-white/[0.04] last:border-0
                  ${isMe ? 'border-l-2 border-l-pulse-red' : ''}`}
              >
                {/* Clickable row */}
                <div
                  onClick={() => handleRowClick(row.user_id)}
                  className={`grid grid-cols-[36px_1fr_40px_56px_40px_64px] gap-2 items-center px-4 py-3.5 cursor-pointer transition-colors
                    ${isMe ? 'bg-pulse-red/[0.06]' : ''}
                    ${isExpanded ? 'bg-white/[0.03]' : 'active:bg-white/[0.04]'}`}
                >
                  {/* Rank */}
                  <span className={`font-heading font-extrabold text-base ${rankColor(row.rank)}`}>
                    {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `#${row.rank}`}
                  </span>

                  {/* Name + chevron */}
                  <div className="min-w-0 flex items-center gap-1">
                    <div className="min-w-0 flex-1">
                      <span className={`font-heading font-bold text-sm truncate block ${isMe ? 'text-pulse-text' : 'text-pulse-text-2'}`}>
                        {displayName(row)}
                      </span>
                      {isMe && (
                        <span className="text-[10px] text-pulse-red font-semibold uppercase tracking-wider">You</span>
                      )}
                    </div>
                    {isExpanded
                      ? <ChevronUp size={12} className="text-pulse-text-3 flex-shrink-0" />
                      : <ChevronDown size={12} className="text-pulse-text-3 flex-shrink-0" />
                    }
                  </div>

                  {/* Decision fights scored */}
                  <span className="font-heading font-bold text-sm text-pulse-text-2 text-center">
                    {row.fights_scored}
                  </span>

                  {/* Fight accuracy badge */}
                  <div className="flex justify-center">
                    <span className={`font-heading font-extrabold text-sm px-2 py-1 rounded-full ${accBadgeClass(row.fight_acc_pct)}`}>
                      {row.fight_acc_pct}%
                    </span>
                  </div>

                  {/* Rounds matched */}
                  <span className="font-heading font-bold text-sm text-pulse-text-2 text-center">
                    {row.rounds_matched > 0 ? row.rounds_matched : '—'}
                  </span>

                  {/* Round accuracy badge */}
                  <div className="flex justify-end">
                    {row.round_acc_pct != null ? (
                      <span className={`font-heading font-extrabold text-sm px-2 py-1 rounded-full ${accBadgeClass(row.round_acc_pct)}`}>
                        {row.round_acc_pct}%
                      </span>
                    ) : (
                      <span className="text-sm text-pulse-text-3 pr-1">—</span>
                    )}
                  </div>
                </div>

                {/* Expand panel */}
                {isExpanded && <ExpandPanel userId={row.user_id} />}
              </div>
            );
          })}
        </div>
      )}

      {/* Eligibility note */}
      {!loading && (
        <p className="text-[10px] text-pulse-text-3 text-center mt-4 leading-relaxed">
          Decision fights only · blind-scored · min 3 to appear.<br/>
          Round% = agreement with judge majority.
        </p>
      )}
    </div>
  );
}
