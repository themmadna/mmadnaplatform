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

  // --- NEW COMBAT DNA ANALYTICS ---
  async getCombatDNA(likedFights) {
    // 1. Safety Check
    if (!likedFights || likedFights.length === 0) return null;

    // 2. Extract identifiers to optimize the query
    const uniqueEvents = [...new Set(likedFights.map(f => f.event_name))];

    // 3. Parallel Fetch: Get Volume Stats AND Meta Details (for Time)
    const [statsResponse, metaResponse] = await Promise.all([
      supabase.from('round_fight_stats').select('*').in('event_name', uniqueEvents),
      supabase.from('fight_meta_details').select('event_name, bout, round, time').in('event_name', uniqueEvents)
    ]);

    const rawStats = statsResponse.data || [];
    const rawMeta = metaResponse.data || [];

    // 4. Aggregate Stats for Each Fight
    const fightAggregates = likedFights.map(likedFight => {
      // Filter stats rows for this specific bout (matches multiple rounds)
      const matchStats = rawStats.filter(r => 
        r.event_name === likedFight.event_name && 
        r.bout === likedFight.bout
      );

      // Find the single meta row for this bout
      const matchMeta = rawMeta.find(m => 
        m.event_name === likedFight.event_name && 
        m.bout === likedFight.bout
      );

      if (matchStats.length === 0 || !matchMeta) return null;

      // --- CALCULATE PRECISE DURATION ---
      // Meta 'round' is the ending round. 'time' is clock reading at end.
      const endRound = parseInt(matchMeta.round) || 1;
      const [mins, secs] = matchMeta.time.split(':').map(Number);
      
      // Math: (Full Rounds * 5) + (Minutes of Final Round) + (Seconds / 60)
      const fullRoundsMinutes = (endRound - 1) * 5;
      const currentRoundMinutes = mins + (secs / 60);
      const exactFightMinutes = fullRoundsMinutes + currentRoundMinutes;

      // --- SUM UP TOTAL VOLUME ---
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
    }).filter(Boolean); // Remove empty results

    if (fightAggregates.length === 0) return null;

    // 5. Calculate Final "DNA" Averages
    const totalMinutesAnalyzed = fightAggregates.reduce((sum, f) => sum + f.exactFightMinutes, 0);
    const totalStrikesAnalyzed = fightAggregates.reduce((sum, f) => sum + f.totalStrikes, 0);
    const count = fightAggregates.length;

    return {
      // The Core Stat: Strikes Per Minute
      strikePace: totalMinutesAnalyzed > 0 ? Math.round(totalStrikesAnalyzed / totalMinutesAnalyzed) : 0,
      
      // Grappling: Average Takedowns per Fight
      grapplingIntensity: (fightAggregates.reduce((sum, f) => sum + f.totalTakedowns, 0) / count).toFixed(1),
      
      // Subs: Average Attempts per Fight
      submissionDanger: (fightAggregates.reduce((sum, f) => sum + f.totalSubAttempts, 0) / count).toFixed(1),
      
      // Biases: Percentage of offense devoted to specific areas
      legKickBias: Math.round((fightAggregates.reduce((sum, f) => sum + f.totalLegStrikes, 0) / fightAggregates.reduce((sum, f) => sum + f.totalSigStrikes, 0) || 1) * 100),
      
      groundWarBias: Math.round((fightAggregates.reduce((sum, f) => sum + f.totalGroundStrikes, 0) / fightAggregates.reduce((sum, f) => sum + f.totalSigStrikes, 0) || 1) * 100),
    };
  }
};