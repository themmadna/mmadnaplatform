import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { dataService } from '../dataService';
import { Trophy, ChevronLeft } from 'lucide-react';

export default function Leaderboard({ currentTheme, onBack }) {
  const [rows, setRows]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [currentUserId, setCurrentUserId] = useState(null);

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
        Fight winner accuracy — blind-scored only
      </p>

      {/* Loading skeleton */}
      {loading && (
        <div className="bg-pulse-surface border border-white/[0.06] rounded-fight overflow-hidden">
          {/* Column headers skeleton */}
          <div className="grid grid-cols-[40px_1fr_56px_56px_64px] gap-2 px-4 py-3 border-b border-white/[0.06]">
            {['w-4','w-20','w-8','w-8','w-10'].map((w, i) => (
              <div key={i} className={`h-3 ${w} bg-white/[0.06] rounded animate-pulse`} />
            ))}
          </div>
          {[1, 2, 3].map(i => (
            <div key={i} className="grid grid-cols-[40px_1fr_56px_56px_64px] gap-2 items-center px-4 py-3.5 border-b border-white/[0.04] last:border-0">
              <div className="h-4 w-5 bg-white/[0.06] rounded animate-pulse" />
              <div className="h-4 w-28 bg-white/[0.06] rounded animate-pulse" />
              <div className="h-4 w-8 bg-white/[0.06] rounded animate-pulse mx-auto" />
              <div className="h-4 w-8 bg-white/[0.06] rounded animate-pulse mx-auto" />
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
          <div className="grid grid-cols-[40px_1fr_56px_56px_64px] gap-2 px-4 py-3 border-b border-white/[0.06]">
            <span className="text-[10px] font-bold uppercase tracking-wider text-pulse-text-3">#</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-pulse-text-3">Scorer</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-pulse-text-3 text-center">Fights</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-pulse-text-3 text-center">Correct</span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-pulse-text-3 text-right">Accuracy</span>
          </div>

          {rows.map((row) => {
            const isMe = row.user_id === currentUserId;
            return (
              <div
                key={row.user_id}
                className={`grid grid-cols-[40px_1fr_56px_56px_64px] gap-2 items-center px-4 py-3.5 border-b border-white/[0.04] last:border-0 transition-colors
                  ${isMe ? 'bg-pulse-red/[0.06] border-l-2 border-l-pulse-red' : ''}`}
              >
                {/* Rank */}
                <span className={`font-heading font-extrabold text-base ${rankColor(row.rank)}`}>
                  {row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : row.rank === 3 ? '🥉' : `#${row.rank}`}
                </span>

                {/* Name */}
                <div className="min-w-0">
                  <span className={`font-heading font-bold text-sm truncate block ${isMe ? 'text-pulse-text' : 'text-pulse-text-2'}`}>
                    {displayName(row)}
                  </span>
                  {isMe && (
                    <span className="text-[10px] text-pulse-red font-semibold uppercase tracking-wider">You</span>
                  )}
                </div>

                {/* Fights scored */}
                <span className="font-heading font-bold text-sm text-pulse-text-2 text-center">
                  {row.fights_scored}
                </span>

                {/* Correct picks */}
                <span className="font-heading font-bold text-sm text-pulse-text-2 text-center">
                  {row.correct_picks}
                </span>

                {/* Accuracy badge */}
                <div className="flex justify-end">
                  <span className={`font-heading font-extrabold text-sm px-2.5 py-1 rounded-full
                    ${row.accuracy_pct >= 70
                      ? 'bg-pulse-green/[0.12] text-pulse-green'
                      : row.accuracy_pct >= 55
                        ? 'bg-yellow-500/[0.12] text-yellow-400'
                        : 'bg-white/[0.06] text-pulse-text-3'}`}>
                    {row.accuracy_pct}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Eligibility note */}
      {!loading && (
        <p className="text-[10px] text-pulse-text-3 text-center mt-4 leading-relaxed">
          Only scorecards submitted before judges were revealed count.
          Minimum 3 eligible fights required to appear.
        </p>
      )}
    </div>
  );
}
