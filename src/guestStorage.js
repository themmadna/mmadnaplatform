// sessionStorage — data is automatically wiped when the tab/browser closes.
// This is intentional: guests are incentivised to sign up to keep their data.
const GUEST_MODE_KEY = 'ufc_guest_mode';
const VOTES_KEY      = 'ufc_guest_votes';            // { [fightId]: 'like'|'dislike'|'favorite'|null }
const SCORES_KEY     = 'ufc_guest_scores';           // { [fightId]: { [round]: { f1_score, f2_score } } }
const STATE_KEY      = 'ufc_guest_scorecard_state';  // { [fightId]: { scored_blind, forfeited, ... } }

export const isGuest  = () => sessionStorage.getItem(GUEST_MODE_KEY) === 'true';
export const setGuest = (val) => val
  ? sessionStorage.setItem(GUEST_MODE_KEY, 'true')
  : sessionStorage.removeItem(GUEST_MODE_KEY);

export const getVotes = () => JSON.parse(sessionStorage.getItem(VOTES_KEY) || '{}');
export const setVote  = (fightId, voteType) => {
  const v = getVotes();
  if (voteType === null) delete v[String(fightId)]; else v[String(fightId)] = voteType;
  sessionStorage.setItem(VOTES_KEY, JSON.stringify(v));
};

export const getFightScores = (fightId) => {
  const all = JSON.parse(sessionStorage.getItem(SCORES_KEY) || '{}');
  return all[String(fightId)] || {};
};
export const setScore = (fightId, round, f1Score, f2Score) => {
  const all = JSON.parse(sessionStorage.getItem(SCORES_KEY) || '{}');
  const k = String(fightId);
  if (!all[k]) all[k] = {};
  all[k][String(round)] = { f1_score: f1Score, f2_score: f2Score };
  sessionStorage.setItem(SCORES_KEY, JSON.stringify(all));
};

export const getScorecardState = (fightId) =>
  (JSON.parse(sessionStorage.getItem(STATE_KEY) || '{}'))[String(fightId)] || null;
export const setScorecardState = (fightId, updates) => {
  const all = JSON.parse(sessionStorage.getItem(STATE_KEY) || '{}');
  const k = String(fightId);
  all[k] = { ...(all[k] || {}), ...updates };
  sessionStorage.setItem(STATE_KEY, JSON.stringify(all));
};
