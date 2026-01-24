import { supabase } from './supabaseClient';

export const dataService = {
  async castVote(fightId, newVote) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Login required");

    if (newVote === null) {
      // Deleting automatically tells the Trigger to subtract 1
      const { error } = await supabase
        .from('user_votes')
        .delete()
        .match({ user_id: user.id, fight_id: fightId });
      if (error) throw error;
    } else {
      // Upserting automatically tells the Trigger to add/update
      const { error } = await supabase
        .from('user_votes')
        .upsert({ 
          user_id: user.id, 
          fight_id: fightId, 
          vote_type: newVote 
        });
      if (error) throw error;
    }
  }
};