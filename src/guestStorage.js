const GUEST_MODE_KEY = 'ufc_guest_mode';
const VOTES_KEY      = 'ufc_guest_votes';            // { [fightId]: 'like'|'dislike'|'favorite'|null }
const SCORES_KEY     = 'ufc_guest_scores';           // { [fightId]: { [round]: { f1_score, f2_score } } }
const STATE_KEY      = 'ufc_guest_scorecard_state';  // { [fightId]: { scored_blind, forfeited, ... } }

export const isGuest  = () => localStorage.getItem(GUEST_MODE_KEY) === 'true';
export const setGuest = (val) => val
  ? localStorage.setItem(GUEST_MODE_KEY, 'true')
  : localStorage.removeItem(GUEST_MODE_KEY);

export const getVotes = () => JSON.parse(localStorage.getItem(VOTES_KEY) || '{}');
export const setVote  = (fightId, voteType) => {
  const v = getVotes();
  if (voteType === null) delete v[String(fightId)]; else v[String(fightId)] = voteType;
  localStorage.setItem(VOTES_KEY, JSON.stringify(v));
};

export const getFightScores = (fightId) => {
  const all = JSON.parse(localStorage.getItem(SCORES_KEY) || '{}');
  return all[String(fightId)] || {};
};
export const setScore = (fightId, round, f1Score, f2Score) => {
  const all = JSON.parse(localStorage.getItem(SCORES_KEY) || '{}');
  const k = String(fightId);
  if (!all[k]) all[k] = {};
  all[k][String(round)] = { f1_score: f1Score, f2_score: f2Score };
  localStorage.setItem(SCORES_KEY, JSON.stringify(all));
};

export const getScorecardState = (fightId) =>
  (JSON.parse(localStorage.getItem(STATE_KEY) || '{}'))[String(fightId)] || null;
export const setScorecardState = (fightId, updates) => {
  const all = JSON.parse(localStorage.getItem(STATE_KEY) || '{}');
  const k = String(fightId);
  all[k] = { ...(all[k] || {}), ...updates };
  localStorage.setItem(STATE_KEY, JSON.stringify(all));
};
