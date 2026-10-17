/**
 * eventStatus.js — when is a card over?
 *
 * Shared by the event view (hides never-started bouts once the card is done) and the
 * profile's pick record (voids picks on those same bouts). One rule, so a bout can't be
 * hidden from the card yet still read "pending" on the profile.
 */

// An event is definitely over this many hours after start_time. Safety net for the
// rare case where ended_at was never stamped (e.g. the main event was itself an
// unmatchable opponent swap, so the poller never saw it finalize). UFC cards run
// ~5-6h; 8h covers overruns.
export const EVENT_MAX_LIVE_HOURS = 8;

export function isPastEventWindow(event, now = Date.now()) {
  if (!event?.start_time) return false;
  return now > new Date(event.start_time).getTime() + EVENT_MAX_LIVE_HOURS * 3600 * 1000;
}

/**
 * ended_at is stamped by poll-live-fights when the main event goes FINAL. The main
 * event's own fight_ended_at is the same signal, for callers that have that row.
 */
export function isEventConcluded(event, mainEventFight = null, now = Date.now()) {
  return !!event?.ended_at || !!mainEventFight?.fight_ended_at || isPastEventWindow(event, now);
}
