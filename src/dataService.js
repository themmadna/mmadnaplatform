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

    const fightIds = likedFights.map(f => f.id);

    const { data, error } = await supabase
      .from('fight_dna_metrics')
      .select('*')
      .in('fight_id', fightIds);

    if (error || !data) {
      console.error("Error fetching DNA metrics:", error);
      return null;
    }

    const total = data.length;
    
    // Sum up everything
    const sums = data.reduce((acc, curr) => ({
      pace: acc.pace + (curr.metric_pace || 0),
      intensity: acc.intensity + (curr.metric_intensity || 0),
      violence: acc.violence + (curr.metric_violence || 0),
      control: acc.control + (curr.metric_control || 0),
      finish: acc.finish + (curr.metric_finish || 0),
      duration: acc.duration + (curr.metric_duration || 0),
      // Sum the Raw Counts for the Body Map
      head: acc.head + (curr.raw_head_strikes || 0),
      body: acc.body + (curr.raw_body_strikes || 0),
      leg: acc.leg + (curr.raw_leg_strikes || 0),
    }), { pace: 0, intensity: 0, violence: 0, control: 0, finish: 0, duration: 0, head: 0, body: 0, leg: 0 });

    return {
      strikePace: parseFloat((sums.pace / total).toFixed(2)),
      intensityScore: parseFloat((sums.intensity / total).toFixed(2)),
      violenceIndex: parseFloat((sums.violence / total).toFixed(2)),
      engagementStyle: Math.round(sums.control / total),
      finishRate: Math.round(sums.finish / total),
      avgFightTime: parseFloat((sums.duration / total).toFixed(1)),
      
      // RETURN THE EXACT KEYS THE VISUALIZER WANTS:
      totalHeadStrikes: Math.round(sums.head / total),
      totalBodyStrikes: Math.round(sums.body / total),
      totalLegStrikes: Math.round(sums.leg / total)
    };
  },

  // NEW: Fetch individual fight metrics for the Scatter Plot
  async getComparisonData(likedFights) {
    if (!likedFights || likedFights.length === 0) return [];

    const fightIds = likedFights.map(f => f.id);

    // Fetch the pre-calculated metrics from your View
    const { data, error } = await supabase
      .from('fight_dna_metrics')
      .select('*')
      .in('fight_id', fightIds);

    if (error) {
      console.error("Error fetching comparison data:", error);
      return [];
    }

    // Merge the metrics with the fight names (so the chart has labels)
    return data.map(metric => {
      const originalFight = likedFights.find(f => f.id === metric.fight_id);
      return {
        id: metric.fight_id,
        fullName: originalFight ? originalFight.bout : 'Unknown Fight',
        pace: metric.metric_pace,
        intensity: metric.metric_intensity || 0,
        violence: metric.metric_violence,
        control: metric.metric_control
      };
    });
  },

  async getGlobalBaselines() {
    const { data, error } = await supabase.from('ufc_baselines').select('*').single();
    if (error) { console.warn("Baselines fetch error", error); return null; }
    return data;
  },

  async getRecommendations(userId) {
    const { data, error } = await supabase.rpc('get_fight_recommendations', {
      p_user_id: userId
    });
    
    if (error) {
      console.error("Recommendations error:", error);
      return [];
    }

    // Map the result to ensure the frontend always gets recommendationReason
    return data.map(fight => ({
      ...fight,
      recommendationReason: fight.recommendationReason || "Style Match"
    }));
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