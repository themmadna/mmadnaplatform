import { sameMatchup, splitBout } from './fighterNames';
import { enrichPick } from './predictionStats';

// Regression: on UFC Fight Night: Rosas Jr. vs Barcelos (2026-09-26) the post-event scraper
// re-wrote 4 of 10 bouts reversed, and the exact-string void check voided all 4 picks.
describe('sameMatchup', () => {
  test('reversed bout is the same matchup', () => {
    expect(sameMatchup('Norma Dumont vs Ailin Perez', 'Ailin Perez vs Norma Dumont')).toBe(true);
    expect(sameMatchup('John Castaneda vs Alatengheili', 'Alatengheili vs John Castaneda')).toBe(true);
  });

  test('identical bout is the same matchup', () => {
    expect(sameMatchup('Raul Rosas Jr. vs Raoni Barcelos', 'Raul Rosas Jr. vs Raoni Barcelos')).toBe(true);
  });

  test('respelled name is the same matchup', () => {
    expect(sameMatchup('Josh Van vs Alexandre Pantoja', 'Alexandre Pantoja vs Joshua Van')).toBe(true);
  });

  test('replaced opponent is a different matchup, in either order', () => {
    expect(sameMatchup('Norma Dumont vs Ailin Perez', 'Norma Dumont vs Karol Rosa')).toBe(false);
    expect(sameMatchup('Norma Dumont vs Ailin Perez', 'Karol Rosa vs Norma Dumont')).toBe(false);
  });

  test('one fighter cannot satisfy both corners', () => {
    expect(sameMatchup('Ailin Perez vs Norma Dumont', 'Ailin Perez vs Ailin Perez')).toBe(false);
  });

  test('unparseable input falls back to exact equality', () => {
    expect(sameMatchup('TBA', 'TBA')).toBe(true);
    expect(sameMatchup('TBA', 'Ailin Perez vs Norma Dumont')).toBe(false);
  });

  test('splitBout tolerates "vs."', () => {
    expect(splitBout('A Fighter vs. B Fighter')).toEqual(['A Fighter', 'B Fighter']);
  });
});

describe('enrichPick void + grade', () => {
  const base = { weight_class: "Women's Bantamweight Bout", status: 'completed', fight_ended_at: '2026-09-27T03:00:00Z' };

  test('reversed bout is graded, not voided', () => {
    const p = enrichPick({ ...base, predicted_fighter: 'Ailin Perez', winner: 'Ailin Perez',
      bout_snapshot: 'Norma Dumont vs Ailin Perez', bout: 'Ailin Perez vs Norma Dumont' });
    expect(p.voided).toBe(false);
    expect(p.grade).toBe('correct');
  });

  test('pick on a deleted (cancelled) fight is void, not pending', () => {
    const p = enrichPick({ predicted_fighter: 'Ailin Perez', fight_deleted: true,
      bout_snapshot: 'Norma Dumont vs Ailin Perez', event_name: 'UFC Fight Night: Rosas Jr. vs Barcelos' });
    expect(p.voided).toBe(true);
    expect(p.pending).toBe(false);
    expect(p.grade).toBe(null);
  });

  test('opponent swap still voids', () => {
    const p = enrichPick({ ...base, predicted_fighter: 'Ailin Perez', winner: 'Ailin Perez',
      bout_snapshot: 'Norma Dumont vs Ailin Perez', bout: 'Ailin Perez vs Karol Rosa' });
    expect(p.voided).toBe(true);
    expect(p.grade).toBe(null);
  });
});
