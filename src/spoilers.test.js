import { roundsToScore, allRoundsScored, isResultRevealed } from './spoilers';
import { enrichPick, tally } from './predictionStats';

describe('roundsToScore', () => {
  test('scheduled rounds from ESPN win', () => {
    expect(roundsToScore({ scheduled_rounds: 5 }, { time_format: '3 Rnd (5-5-5)' })).toBe(5);
  });
  test('falls back to the scraped time format', () => {
    expect(roundsToScore({}, { time_format: '3 Rnd (5-5-5)' })).toBe(3);
  });
  test('unknown → null', () => {
    expect(roundsToScore({}, null)).toBe(null);
  });
});

describe('allRoundsScored', () => {
  const f = { scheduled_rounds: 3 };
  test('partial scoring does not count', () => {
    expect(allRoundsScored(f, null, 0)).toBe(false);
    expect(allRoundsScored(f, null, 2)).toBe(false);
  });
  test('every scheduled round scored counts', () => {
    expect(allRoundsScored(f, null, 3)).toBe(true);
  });
  test('an early finish does not lower the bar — blind scorers cannot know it ended', () => {
    // Stopped in round 2: rounds 1 scored blind is NOT "watched it".
    expect(allRoundsScored(f, { time_format: '3 Rnd (5-5-5)' }, 1)).toBe(false);
  });
  test('unknown round count never auto-reveals', () => {
    expect(allRoundsScored({}, null, 5)).toBe(false);
  });
});

test('isResultRevealed: any one condition reveals', () => {
  expect(isResultRevealed({ spoilerProtection: true })).toBe(false);
  expect(isResultRevealed({ spoilerProtection: false })).toBe(true);
  expect(isResultRevealed({ spoilerProtection: true, revealedAt: '2026-10-03T00:00:00Z' })).toBe(true);
  expect(isResultRevealed({ spoilerProtection: true, allScored: true })).toBe(true);
});

describe('enrichPick under spoiler protection', () => {
  const p = { predicted_fighter: 'Ailin Perez', winner: 'Ailin Perez', status: 'completed',
    bout_snapshot: 'Ailin Perez vs Norma Dumont', bout: 'Ailin Perez vs Norma Dumont' };

  test('hidden: no grade, not pending, counted as hidden', () => {
    const e = enrichPick(p, { spoilerProtection: true });
    expect(e.hidden).toBe(true);
    expect(e.grade).toBe(null);
    expect(e.pending).toBe(false);
    expect(tally([e])).toMatchObject({ w: 0, l: 0, pending: 0, hidden: 1 });
  });
  test('revealed pick is graded', () => {
    expect(enrichPick({ ...p, revealed_at: '2026-10-03T00:00:00Z' }, { spoilerProtection: true }).grade).toBe('correct');
    expect(enrichPick({ ...p, all_scored: true }, { spoilerProtection: true }).grade).toBe('correct');
    expect(enrichPick(p, { spoilerProtection: false }).grade).toBe('correct');
  });
  test('ungraded pick is pending, not hidden', () => {
    const e = enrichPick({ ...p, winner: null, status: 'upcoming' }, { spoilerProtection: true });
    expect(e.hidden).toBe(false);
    expect(e.pending).toBe(true);
  });
});
