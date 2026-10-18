/**
 * spoilers.js — when is a fight's result "revealed" for this user?
 *
 * One rule shared by fight detail, the event cards and the profile Picks tab, so a
 * result is never hidden in one place and visible in another. Revealed when ANY of:
 *   - spoiler protection is off
 *   - the user has scored EVERY round (they watched it)
 *   - the user explicitly revealed it (user_fight_predictions.revealed_at, if they picked)
 *
 * Revealing only shows the winner. It has no effect on scorecard eligibility — that is
 * the separate judges reveal (forfeit / judges_revealed_at) in RoundScoringPanel.
 */

/**
 * Rounds the blind scorecard asks for: the SCHEDULED count, exactly what fight detail's
 * spoiler shield passes to RoundScoringPanel. Deliberately not rounds fought — under
 * spoiler protection you can't know a fight ended early, so having scored rounds 1–2 of a
 * fight stopped in round 2 doesn't mean you saw the ending.
 * null when unknown (no ESPN scheduled_rounds and no scraped time_format).
 */
export function roundsToScore(fight, meta) {
  return Number(fight?.scheduled_rounds)
    || parseInt(meta?.time_format?.match(/^(\d+)\s*Rnd/)?.[1], 10)
    || null;
}

/** Has the user scored every round? Unknown round count → false: wait for an explicit reveal. */
export function allRoundsScored(fight, meta, scoredCount) {
  const need = roundsToScore(fight, meta);
  return need !== null && scoredCount >= need;
}

export function isResultRevealed({ spoilerProtection, revealedAt, allScored }) {
  return !spoilerProtection || !!revealedAt || !!allScored;
}
