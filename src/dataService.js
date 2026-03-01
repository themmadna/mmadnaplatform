import { supabase } from './supabaseClient';

export const dataService = {
  // --- VOTING LOGIC ---
  // Works for 'like', 'dislike', or 'favorite' automatically
  async castVote(fightId, newVote) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Login required");

    if (newVote === null) {
      // If un-toggling, remove the vote entirely
      const { error } = await supabase.from('user_votes').delete().match({ user_id: user.id, fight_id: fightId });
      if (error) throw error;
    } else {
      // Upsert handles inserting OR updating (e.g. changing 'like' to 'favorite')
      const { error } = await supabase.from('user_votes').upsert({ user_id: user.id, fight_id: fightId, vote_type: newVote });
      if (error) throw error;
    }
  },

  // --- COMBAT DNA + SCATTER PLOT DATA (single query) ---
  // Fetches fight_dna_metrics once and returns both the DNA averages and per-fight chart data.
  async getDNAAndChartData(fightList) {
    if (!fightList || fightList.length === 0) return { dna: null, chartData: [] };

    const fightIds = fightList.map(f => f.id);

    const { data, error } = await supabase
      .from('fight_dna_metrics')
      .select('*')
      .in('fight_id', fightIds)
      .eq('status', 'completed');

    if (error || !data || data.length === 0) {
      if (error) console.error("Error fetching DNA metrics:", error);
      return { dna: null, chartData: [] };
    }

    const total = data.length;
    const sums = data.reduce((acc, curr) => ({
      pace: acc.pace + (curr.metric_pace || 0),
      intensity: acc.intensity + (curr.metric_intensity || 0),
      violence: acc.violence + (curr.metric_violence || 0),
      control: acc.control + (curr.metric_control || 0),
      finish: acc.finish + (curr.metric_finish || 0),
      duration: acc.duration + (curr.metric_duration || 0),
      head: acc.head + (curr.raw_head_strikes || 0),
      body: acc.body + (curr.raw_body_strikes || 0),
      leg: acc.leg + (curr.raw_leg_strikes || 0),
    }), { pace: 0, intensity: 0, violence: 0, control: 0, finish: 0, duration: 0, head: 0, body: 0, leg: 0 });

    const dna = {
      strikePace: parseFloat((sums.pace / total).toFixed(2)),
      intensityScore: parseFloat((sums.intensity / total).toFixed(2)),
      violenceIndex: parseFloat((sums.violence / total).toFixed(2)),
      engagementStyle: Math.round(sums.control / total),
      finishRate: Math.round(sums.finish / total),
      avgFightTime: parseFloat((sums.duration / total).toFixed(1)),
      avgHeadStrikes: Math.round(sums.head / total),
      avgBodyStrikes: Math.round(sums.body / total),
      avgLegStrikes: Math.round(sums.leg / total)
    };

    const chartData = data.map(metric => {
      const originalFight = fightList.find(f => f.id === metric.fight_id);
      return {
        id: metric.fight_id,
        fullName: originalFight ? originalFight.bout : 'Unknown Fight',
        pace: metric.metric_pace,
        intensity: metric.metric_intensity || 0,
        violence: metric.metric_violence,
        control: metric.metric_control
      };
    });

    return { dna, chartData };
  },

  // --- GLOBAL BASELINES (Grey Polygon) ---
  async getGlobalBaselines() {
    const { data, error } = await supabase.from('ufc_baselines').select('*').single();
    if (error) { console.warn("Baselines fetch error", error); return null; }
    return data;
  },

  // --- RECOMMENDATIONS (Using SQL Function) ---
  async getRecommendations(userId, combatDNA) {
    const { data, error } = await supabase.rpc('get_fight_recommendations', {
      p_user_id: userId,
      p_pace: combatDNA?.strikePace ?? 0,
      p_violence: combatDNA?.violenceIndex ?? 0,
      p_intensity: combatDNA?.intensityScore ?? 0,
      p_control: combatDNA?.engagementStyle ?? 0,
      p_finish: combatDNA?.finishRate ?? 0,
      p_duration: combatDNA?.avgFightTime ?? 0,
    });
    
    // Robust error handling to prevent UI crashes
    if (error) {
      console.error("Recommendations error:", error);
      return [];
    }

    return data || [];
  },

  // --- COMMUNITY FAVORITES (Fallback for new users) ---
  // UPDATED: Now fetches and sorts by 'favorites_count' as the highest priority
  async getCommunityFavorites() {
    const { data, error } = await supabase
      .from('fights')
      .select(`
        *,
        fight_ratings!inner (
          likes_count,
          dislikes_count,
          favorites_count
        )
      `)
      // Sort: Most Favorited -> Most Liked -> Least Disliked
      .order('favorites_count', { foreignTable: 'fight_ratings', ascending: false })
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
    }));
  }
};