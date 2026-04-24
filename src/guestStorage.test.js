import * as gs from './guestStorage';

beforeEach(() => sessionStorage.clear());

// ── isGuest / setGuest ────────────────────────────────────────────────────────

describe('isGuest / setGuest', () => {
  test('defaults to false when nothing is set', () => {
    expect(gs.isGuest()).toBe(false);
  });

  test('setGuest(true) makes isGuest() return true', () => {
    gs.setGuest(true);
    expect(gs.isGuest()).toBe(true);
  });

  test('setGuest(false) removes the key so isGuest() returns false', () => {
    gs.setGuest(true);
    gs.setGuest(false);
    expect(gs.isGuest()).toBe(false);
  });
});

// ── getVotes / setVote ────────────────────────────────────────────────────────

describe('getVotes / setVote', () => {
  test('returns empty object when no votes exist', () => {
    expect(gs.getVotes()).toEqual({});
  });

  test('stores a vote for a fight', () => {
    gs.setVote(1, 'like');
    expect(gs.getVotes()).toEqual({ '1': 'like' });
  });

  test('coerces fightId to string key', () => {
    gs.setVote(42, 'favorite');
    expect(gs.getVotes()['42']).toBe('favorite');
  });

  test('overwrites a previous vote', () => {
    gs.setVote(1, 'like');
    gs.setVote(1, 'dislike');
    expect(gs.getVotes()['1']).toBe('dislike');
  });

  test('setVote(id, null) removes the entry', () => {
    gs.setVote(1, 'like');
    gs.setVote(1, null);
    expect(gs.getVotes()['1']).toBeUndefined();
  });

  test('multiple fights stored independently', () => {
    gs.setVote(1, 'like');
    gs.setVote(2, 'favorite');
    const votes = gs.getVotes();
    expect(votes['1']).toBe('like');
    expect(votes['2']).toBe('favorite');
  });
});

// ── getFightScores / setScore ─────────────────────────────────────────────────

describe('getFightScores / setScore', () => {
  test('returns empty object for unknown fight', () => {
    expect(gs.getFightScores(99)).toEqual({});
  });

  test('stores a round score', () => {
    gs.setScore(1, 1, 10, 9);
    expect(gs.getFightScores(1)).toEqual({ '1': { f1_score: 10, f2_score: 9 } });
  });

  test('stores multiple rounds for the same fight', () => {
    gs.setScore(1, 1, 10, 9);
    gs.setScore(1, 2, 9, 10);
    const scores = gs.getFightScores(1);
    expect(scores['1']).toEqual({ f1_score: 10, f2_score: 9 });
    expect(scores['2']).toEqual({ f1_score: 9, f2_score: 10 });
  });

  test('overwrites an existing round score', () => {
    gs.setScore(1, 1, 10, 9);
    gs.setScore(1, 1, 9, 10);
    expect(gs.getFightScores(1)['1']).toEqual({ f1_score: 9, f2_score: 10 });
  });

  test('scores for different fights are isolated', () => {
    gs.setScore(1, 1, 10, 9);
    gs.setScore(2, 1, 8, 10);
    expect(gs.getFightScores(1)['1'].f1_score).toBe(10);
    expect(gs.getFightScores(2)['1'].f1_score).toBe(8);
  });
});

// ── getScorecardState / setScorecardState ─────────────────────────────────────

describe('getScorecardState / setScorecardState', () => {
  test('returns null for unknown fight', () => {
    expect(gs.getScorecardState(99)).toBeNull();
  });

  test('stores and retrieves scorecard state', () => {
    gs.setScorecardState(1, { scored_blind: true, forfeited: false });
    expect(gs.getScorecardState(1)).toEqual({ scored_blind: true, forfeited: false });
  });

  test('merges updates into existing state', () => {
    gs.setScorecardState(1, { scored_blind: true });
    gs.setScorecardState(1, { forfeited: true });
    expect(gs.getScorecardState(1)).toEqual({ scored_blind: true, forfeited: true });
  });

  test('states for different fights are isolated', () => {
    gs.setScorecardState(1, { forfeited: false });
    gs.setScorecardState(2, { forfeited: true });
    expect(gs.getScorecardState(1).forfeited).toBe(false);
    expect(gs.getScorecardState(2).forfeited).toBe(true);
  });
});

// ── getSpoilerDefault / setSpoilerDefault ─────────────────────────────────────

describe('getSpoilerDefault / setSpoilerDefault', () => {
  test('defaults to true when nothing is set', () => {
    expect(gs.getSpoilerDefault()).toBe(true);
  });

  test('setSpoilerDefault(false) makes getSpoilerDefault() return false', () => {
    gs.setSpoilerDefault(false);
    expect(gs.getSpoilerDefault()).toBe(false);
  });

  test('setSpoilerDefault(true) restores the default', () => {
    gs.setSpoilerDefault(false);
    gs.setSpoilerDefault(true);
    expect(gs.getSpoilerDefault()).toBe(true);
  });
});
