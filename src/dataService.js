import { supabase } from './supabaseClient';

export const dataService = {
  // --- VOTING LOGIC ---
  async castVote(fightId, newVote) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Login required");

    if (newVote === null) {
      const { error } = await supabase.from('user_votes').delete().match({ user_id: user.id, fight_id: fightId });
      if (error) throw error;
    } else {
      const { error } = await supabase.from('user_votes').upsert({ user_id: user.id, fight_id: fightId, vote_type: newVote });
      if (error) throw error;
    }
  },

  // --- COMBAT DNA (Bout Totals + Visual Data) ---
  async getCombatDNA(likedFights) {
    if (!likedFights || likedFights.length === 0) return null;

    const uniqueEvents = [...new Set(likedFights.map(f => f.event_name))];
    const fightIds = likedFights.map(f => f.id);

    // Fetch RAW stats, META details, and PRE-CALCULATED Intensity
    const [statsResponse, metaResponse, intensityResponse] = await Promise.all([
      supabase.from('round_fight_stats').select('*').in('event_name', uniqueEvents),
      supabase.from('fight_meta_details').select('event_name, bout, round, time, method').in('event_name', uniqueEvents),
      supabase.from('fight_dna_metrics').select('fight_id, metric_intensity').in('fight_id', fightIds)
    ]);

    const rawStats = statsResponse.data || [];
    const rawMeta = metaResponse.data || [];
    const rawIntensity = intensityResponse.data || [];

    const fightAggregates = likedFights.map(likedFight => {
      const boutStats = rawStats.filter(r => r.event_name === likedFight.event_name && r.bout === likedFight.bout);
      const matchMeta = rawMeta.find(m => m.event_name === likedFight.event_name && m.bout === likedFight.bout);

      if (boutStats.length === 0 || !matchMeta || !matchMeta.time) return null;

      const endRound = parseInt(matchMeta.round) || 1;
      const [mins, secs] = matchMeta.time.split(':').map(Number);
      const totalMinutes = ((endRound - 1) * 5) + mins + (secs / 60);
      const totalSeconds = totalMinutes * 60;
      
      if (totalMinutes <= 0) return null;

      // Aggregates
      const combinedSigStrikes = boutStats.reduce((sum, r) => sum + (r.sig_strikes_attempted || 0), 0);
      const combinedTakedowns = boutStats.reduce((sum, r) => sum + (r.takedowns_attempted || 0), 0);
      const combinedViolence = boutStats.reduce((sum, r) => sum + (r.kd || 0) + (r.sub_attempts || 0), 0);
      const combinedControl = boutStats.reduce((sum, r) => sum + (r.control_time_sec || 0), 0);
      
      // VISUAL DATA
      const totalHead = boutStats.reduce((sum, r) => sum + (r.sig_strikes_head_attempted || 0), 0);
      const totalBody = boutStats.reduce((sum, r) => sum + (r.sig_strikes_body_attempted || 0), 0);
      const totalLeg = boutStats.reduce((sum, r) => sum + (r.sig_strikes_leg_attempted || 0), 0);

      const isFinish = ['KO/TKO', 'Submission'].includes(matchMeta.method) ? 1 : 0;

      return {
        combinedSigStrikes, combinedTakedowns, combinedViolence, combinedControl,
        totalHead, totalBody, totalLeg,
        isFinish, totalMinutes, totalSeconds
      };
    }).filter(Boolean);

    if (fightAggregates.length === 0) return null;

    const totalMin = fightAggregates.reduce((sum, f) => sum + f.totalMinutes, 0);
    const count = fightAggregates.length;

    // Calculate Average Intensity
    const validIntensities = rawIntensity.map(r => r.metric_intensity).filter(n => n !== null);
    const avgIntensity = validIntensities.length > 0 
        ? (validIntensities.reduce((a, b) => a + b, 0) / validIntensities.length).toFixed(2) 
        : 0;

    return {
      // 5 Core Metrics
      strikePace: (fightAggregates.reduce((sum, f) => sum + f.combinedSigStrikes, 0) / totalMin).toFixed(1),
      grapplingIntensity: (fightAggregates.reduce((sum, f) => sum + f.combinedTakedowns, 0) / count).toFixed(1),
      violenceIndex: (fightAggregates.reduce((sum, f) => sum + f.combinedViolence, 0) / totalMin).toFixed(2),
      engagementStyle: Math.round((fightAggregates.reduce((sum, f) => sum + f.combinedControl, 0) / fightAggregates.reduce((sum, f) => sum + f.totalSeconds, 0)) * 100),
      finishRate: Math.round((fightAggregates.reduce((sum, f) => sum + f.isFinish, 0) / count) * 100),
      avgFightTime: (totalMin / count).toFixed(1),
      
      // NEW: INTENSITY SCORE (Passed to UI and Recommendations)
      intensityScore: avgIntensity,

      // Visual Data
      totalHeadStrikes: fightAggregates.reduce((sum, f) => sum + f.totalHead, 0),
      totalBodyStrikes: fightAggregates.reduce((sum, f) => sum + f.totalBody, 0),
      totalLegStrikes: fightAggregates.reduce((sum, f) => sum + f.totalLeg, 0),
    };
  },

  async getGlobalBaselines() {
    const { data, error } = await supabase.from('ufc_baselines').select('*').single();
    if (error) { console.warn("Baselines fetch error", error); return null; }
    return data;
  },

  async getRecommendations(userId, dna) {
    // Call the updated RPC function with the new parameter
    const { data, error } = await supabase.rpc('get_fight_recommendations', {
      p_user_id: userId,
      p_pace: parseFloat(dna.strikePace),
      p_violence: parseFloat(dna.violenceIndex),
      p_control: parseFloat(dna.engagementStyle),
      p_finish: parseFloat(dna.finishRate),
      p_duration: parseFloat(dna.avgFightTime),
      p_intensity: parseFloat(dna.intensityScore || 0) // <--- NEW PARAMETER
    });
    
    if (error) console.error("Recs error", error);
    return data;
  },

  // NEW: Get Community Favorites (Fallback for new users)
  async getCommunityFavorites() {
    const { data, error } = await supabase
      .from('fights')
      .select(`
        *,
        fight_ratings!inner (
          likes_count,
          dislikes_count
        )
      `)
      .order('likes_count', { foreignTable: 'fight_ratings', ascending: false })
      .order('dislikes_count', { foreignTable: 'fight_ratings', ascending: true })
      .limit(10);

    if (error) {
      console.error("Error fetching top rated:", error);
      return [];
    }
    
    return data.map(f => ({
        ...f,
        ratings: f.fight_ratings,
        match_reason: "Community Favorite"
    }));
  }
};