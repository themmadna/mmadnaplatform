import { isEventConcluded, isPastEventWindow } from './eventStatus';

describe('isEventConcluded', () => {
  const start = '2026-10-10T21:00:00Z';
  const at = (h) => new Date(start).getTime() + h * 3600 * 1000;

  test('ended_at stamped → concluded, even mid-window', () => {
    expect(isEventConcluded({ start_time: start, ended_at: '2026-10-11T02:48:01Z' }, null, at(6))).toBe(true);
  });

  test('main event fight ended → concluded', () => {
    expect(isEventConcluded({ start_time: start }, { fight_ended_at: '2026-10-11T02:48:01Z' }, at(6))).toBe(true);
  });

  test('running card, no stamps → not concluded', () => {
    expect(isEventConcluded({ start_time: start }, { fight_ended_at: null }, at(6))).toBe(false);
  });

  test('past the 8h window → concluded without stamps', () => {
    expect(isEventConcluded({ start_time: start }, null, at(8.1))).toBe(true);
  });

  test('no start_time and no stamps → never assumed over', () => {
    expect(isEventConcluded({ event_date: '2026-10-10' }, null, at(100))).toBe(false);
    expect(isPastEventWindow(null)).toBe(false);
  });
});
