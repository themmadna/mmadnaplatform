// calculates strike pace with sig strikes
// stats are now based on fight total


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

  // --- NEW COMBAT DNA ANALYTICS (Bout Totals) ---
  async getCombatDNA(likedFights) {
    if (!likedFights || likedFights.length === 0) return null;

    const uniqueEvents = [...new Set(likedFights.map(f => f.event_name))];

    // Fetch stats and meta for all relevant events
    const [statsResponse, metaResponse] = await Promise.all([
      supabase.from('round_fight_stats').select('*').in('event_name', uniqueEvents),
      supabase.from('fight_meta_details').select('event_name, bout, round, time, method').in('event_name', uniqueEvents)
    ]);

    const rawStats = statsResponse.data || [];
    const rawMeta = metaResponse.data || [];

    const fightAggregates = likedFights.map(likedFight => {
      // 1. Filter for ALL rows belonging to this bout (User likes the FIGHT, not just one fighter)
      const boutStats = rawStats.filter(r => r.event_name === likedFight.event_name && r.bout === likedFight.bout);
      const matchMeta = rawMeta.find(m => m.event_name === likedFight.event_name && m.bout === likedFight.bout);

      // 2. Safety Checks
      if (boutStats.length === 0 || !matchMeta || !matchMeta.time) return null;

      // 3. Calculate Exact Duration
      const endRound = parseInt(matchMeta.round) || 1;
      const timeParts = matchMeta.time.split(':');
      if (timeParts.length !== 2) return null;
      
      const mins = parseInt(timeParts[0]);
      const secs = parseInt(timeParts[1]);
      const totalMinutes = ((endRound - 1) * 5) + mins + (secs / 60);
      const totalSeconds = totalMinutes * 60;
      
      if (totalMinutes <= 0) return null;

      // 4. Aggregate Totals (Summing both fighters together)
      const combinedSigStrikes = boutStats.reduce((sum, r) => sum + (r.sig_strikes_attempted || 0), 0);
      const combinedTakedowns = boutStats.reduce((sum, r) => sum + (r.takedowns_attempted || 0), 0);
      
      // Violence: Combined Knockdowns + Sub Attempts
      const combinedViolenceEvents = boutStats.reduce((sum, r) => sum + (r.kd || 0) + (r.sub_attempts || 0), 0);
      
      // Engagement: Combined Control Time
      const combinedControlSec = boutStats.reduce((sum, r) => sum + (r.control_time_sec || 0), 0);

      // Finish: Did it end via KO/TKO or Submission?
      const isFinish = ['KO/TKO', 'Submission'].includes(matchMeta.method) ? 1 : 0;

      return {
        combinedSigStrikes,
        combinedTakedowns,
        combinedViolenceEvents,
        combinedControlSec,
        isFinish,
        totalMinutes,
        totalSeconds
      };
    }).filter(Boolean);

    if (fightAggregates.length === 0) return null;

    // --- FINAL AVERAGES ---
    const totalMinutesAnalyzed = fightAggregates.reduce((sum, f) => sum + f.totalMinutes, 0);
    const count = fightAggregates.length;

    return {
      // 1. Strike Pace (Combined per Minute)
      strikePace: (fightAggregates.reduce((sum, f) => sum + f.combinedSigStrikes, 0) / totalMinutesAnalyzed).toFixed(1),
      
      // 2. Grappling Intensity (Combined per Fight)
      grapplingIntensity: (fightAggregates.reduce((sum, f) => sum + f.combinedTakedowns, 0) / count).toFixed(1),
      
      // 3. Violence Index (Events per Minute)
      violenceIndex: (fightAggregates.reduce((sum, f) => sum + f.combinedViolenceEvents, 0) / totalMinutesAnalyzed).toFixed(2),
      
      // 4. Engagement Style (% of time spent in control)
      engagementStyle: Math.round((fightAggregates.reduce((sum, f) => sum + f.combinedControlSec, 0) / fightAggregates.reduce((sum, f) => sum + f.totalSeconds, 0)) * 100),
      
      // 5. Finish Profile (Rate % and Avg Duration)
      finishRate: Math.round((fightAggregates.reduce((sum, f) => sum + f.isFinish, 0) / count) * 100),
      avgFightTime: (totalMinutesAnalyzed / count).toFixed(1)
    };
  },

  // --- NEW: Global Baseline Fetcher ---
  async getGlobalBaselines() {
    const { data, error } = await supabase
      .from('ufc_baselines')
      .select('*')
      .single();

    if (error) {
      console.warn("Could not fetch baselines, using defaults", error);
      return null;
    }
    return data;
  }
};