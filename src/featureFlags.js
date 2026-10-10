/**
 * featureFlags.js — features that ship to production before they ship to the public.
 *
 * PREDICTIONS (swipe-to-predict + the profile Picks tab) is live in production code but
 * shown only to the accounts below. Everyone else gets the pre-predictions behaviour:
 * vote row on every card, no Picks tab, no prediction queries.
 *
 * To launch to everyone: make predictionsEnabled return !!session (and delete the list).
 *
 * This is a UI gate, not a security boundary — RLS on user_fight_predictions still lets
 * any signed-in user write their own picks through the API. Acceptable for a soft launch:
 * nobody can read or touch anyone else's rows.
 */

// Supabase auth user ids (not emails — this file ships in the public bundle).
const PREDICTIONS_USERS = new Set([
  '92ece4d5-d62d-48e3-988d-6d25c22152f2',   // Bastian
]);

export function predictionsEnabled(session) {
  return !!session?.user?.id && PREDICTIONS_USERS.has(session.user.id);
}
