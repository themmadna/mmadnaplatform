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

  // Regression: UFC 332 (2026-10-03) — McGhee's opponent changed Sopaj → Romero, the scraper
  // added the new bout as a new row and left McGhee vs Sopaj untouched, so the pick read
  // pending until auto-delete removed the old row.
  test('never-started bout on a concluded event is void', () => {
    const p = enrichPick({ predicted_fighter: 'Marcus McGhee', status: 'upcoming', winner: null,
      bout_snapshot: 'Marcus McGhee vs Sopaj', bout: 'Marcus McGhee vs Sopaj',
      fight_started_at: null, fight_ended_at: null, event_concluded: true });
    expect(p.voided).toBe(true);
    expect(p.scratched).toBe(true);
    expect(p.pending).toBe(false);
  });

  test('never-started bout on a card still running stays pending', () => {
    const p = enrichPick({ predicted_fighter: 'Marcus McGhee', status: 'upcoming', winner: null,
      bout_snapshot: 'Marcus McGhee vs Sopaj', bout: 'Marcus McGhee vs Sopaj',
      fight_started_at: null, fight_ended_at: null, event_concluded: false });
    expect(p.voided).toBe(false);
    expect(p.pending).toBe(true);
  });

  test('scraped bout the poller never stamped is graded, not voided', () => {
    const p = enrichPick({ ...base, predicted_fighter: 'Ailin Perez', winner: 'Ailin Perez',
      bout_snapshot: 'Norma Dumont vs Ailin Perez', bout: 'Norma Dumont vs Ailin Perez',
      fight_started_at: null, fight_ended_at: null, event_concluded: true });
    expect(p.voided).toBe(false);
    expect(p.grade).toBe('correct');
  });

  test('opponent swap still voids', () => {
    const p = enrichPick({ ...base, predicted_fighter: 'Ailin Perez', winner: 'Ailin Perez',
      bout_snapshot: 'Norma Dumont vs Ailin Perez', bout: 'Ailin Perez vs Karol Rosa' });
    expect(p.voided).toBe(true);
    expect(p.grade).toBe(null);
  });
});
