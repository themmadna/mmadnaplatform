import { supabase } from './supabaseClient';

export const dataService = {
  // --- EXISTING VOTING LOGIC ---
  async castVote(fightId, newVote) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Login required");

    if (newVote === null) {
      const { error } = await supabase
        .from('user_votes')
        .delete()
        .match({ user_id: user.id, fight_id: fightId });
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('user_votes')
        .upsert({ 
          user_id: user.id, 
          fight_id: fightId, 
          vote_type: newVote 
        });
      if (error) throw error;
    }
  },

  // --- NEW COMBAT DNA ANALYTICS (With Median Logic) ---
  async getCombatDNA(likedFights) {
    if (!likedFights || likedFights.length === 0) return null;

    const uniqueEvents = [...new Set(likedFights.map(f => f.event_name))];

    const [statsResponse, metaResponse] = await Promise.all([
      supabase.from('round_fight_stats').select('*').in('event_name', uniqueEvents),
      supabase.from('fight_meta_details').select('event_name, bout, round, time').in('event_name', uniqueEvents)
    ]);

    const rawStats = statsResponse.data || [];
    const rawMeta = metaResponse.data || [];

    // Helper to calculate Median
    const calculateMedian = (arr) => {
      if (arr.length === 0) return 0;
      const sorted = [...arr].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    };

    const fightAggregates = likedFights.map(likedFight => {
      const matchStats = rawStats.filter(r => r.event_name === likedFight.event_name && r.bout === likedFight.bout);
      const matchMeta = rawMeta.find(m => m.event_name === likedFight.event_name && m.bout === likedFight.bout);

      if (matchStats.length === 0 || !matchMeta) return null;

      const endRound = parseInt(matchMeta.round) || 1;
      const [mins, secs] = matchMeta.time.split(':').map(Number);
      const exactFightMinutes = ((endRound - 1) * 5) + mins + (secs / 60);

      const totalStrikes = matchStats.reduce((sum, r) => sum + (r.total_strikes_attempted || 0), 0);
      const totalSigStrikes = matchStats.reduce((sum, r) => sum + (r.sig_strikes_attempted || 0), 0);
      const totalTakedowns = matchStats.reduce((sum, r) => sum + (r.takedowns_attempted || 0), 0);
      const totalSubAttempts = matchStats.reduce((sum, r) => sum + (r.sub_attempts || 0), 0);
      const totalLegStrikes = matchStats.reduce((sum, r) => sum + (r.sig_strikes_leg_attempted || 0), 0);
      const totalGroundStrikes = matchStats.reduce((sum, r) => sum + (r.sig_strikes_ground_attempted || 0), 0);

      return {
        totalStrikes,
        totalSigStrikes,
        totalTakedowns,
        totalSubAttempts,
        totalLegStrikes,
        totalGroundStrikes,
        exactFightMinutes
      };
    }).filter(Boolean);

    if (fightAggregates.length === 0) return null;

    // --- AGGREGATION LOGIC ---
    const totalMinutesAnalyzed = fightAggregates.reduce((sum, f) => sum + f.exactFightMinutes, 0);
    const totalStrikesAnalyzed = fightAggregates.reduce((sum, f) => sum + f.totalStrikes, 0);
    
    // Arrays for Median Calculation
    const takedownCounts = fightAggregates.map(f => f.totalTakedowns);
    const subCounts = fightAggregates.map(f => f.totalSubAttempts);

    // Bias Ratios (Keep as weighted averages for overall profile)
    const totalLegs = fightAggregates.reduce((sum, f) => sum + f.totalLegStrikes, 0);
    const totalGround = fightAggregates.reduce((sum, f) => sum + f.totalGroundStrikes, 0);
    const totalSig = fightAggregates.reduce((sum, f) => sum + f.totalSigStrikes, 0);

    return {
      // Pace: Keep as Mean (Total Volume / Total Time)
      strikePace: totalMinutesAnalyzed > 0 ? Math.round(totalStrikesAnalyzed / totalMinutesAnalyzed) : 0,
      
      // Grappling: Median (Resistant to outliers)
      grapplingIntensity: calculateMedian(takedownCounts).toFixed(1),
      
      // Subs: Median
      submissionDanger: calculateMedian(subCounts).toFixed(1),
      
      // Biases: Weighted Average
      legKickBias: Math.round((totalLegs / totalSig || 0) * 100),
      groundWarBias: Math.round((totalGround / totalSig || 0) * 100),
    };
  }
};