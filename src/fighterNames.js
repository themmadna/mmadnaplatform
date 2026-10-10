/**
 * fighterNames.js — canonical cross-source fighter name matching.
 *
 * CLAUDE.md convention #8: never exact-string-match a fighter name across sources.
 * ufcstats, mmadecisions and ESPN all spell the same fighter differently
 * ("Matthieu Letho Duclos" vs "Matthieu Duclos", "Rong Zhu" vs "Rongzhu",
 * "Josh Van" vs "Joshua Van").
 *
 * This module is the single JS source of truth. It was lifted verbatim out of
 * src/components/FightDetailView.js, which previously held the canonical copy.
 *
 * ONE other copy exists and cannot import this file:
 *   supabase/functions/poll-live-fights/index.ts  (Deno edge function)
 * If you change the logic here, change it there too.
 */

export function normName(name) {
  return (name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
}

export function matchesFighter(jsName, metaName) {
  const a = normName(jsName);
  const b = normName(metaName);
  if (!a || !b) return false;
  if (a === b) return true;

  // Handles "Rong Zhu" vs "Rongzhu" — same letters, different spacing
  const aCol = a.replace(/\s/g, '');
  const bCol = b.replace(/\s/g, '');
  if (aCol === bCol) return true;

  // Handles "Zha Yi" vs "Yizha", "Sulangrangbo" vs "Rangbo Sulang" —
  // same characters in different segment order (cross-source Chinese name transliterations)
  if (aCol.length >= 5 && aCol.length === bCol.length) {
    if ([...aCol].sort().join('') === [...bCol].sort().join('')) return true;
  }

  const aWords = a.split(' ');
  const bWords = b.split(' ');

  // Fallback 1: first-name prefix with same last name (handles "Josh Van" vs "Joshua Van",
  // "Alex Perez" vs "Alexander Perez", etc.)
  if (aWords.length >= 2 && bWords.length >= 2) {
    const aRest = aWords.slice(1).join(' ');
    const bRest = bWords.slice(1).join(' ');
    if (aRest === bRest && (aWords[0].startsWith(bWords[0]) || bWords[0].startsWith(aWords[0]))) return true;
  }

  // Fallback 2: same last name (handles nickname/middle-name differences)
  const aLast = aWords[aWords.length - 1];
  const bLast = bWords[bWords.length - 1];
  if (aLast === bLast && aLast.length > 3) return true;

  // Fallback 3: all words of the shorter name appear in the longer (handles Jr., suffixes, middle names)
  const shorter = aWords.length <= bWords.length ? aWords : bWords;
  const longer  = aWords.length <= bWords.length ? bWords : aWords;
  return shorter.filter(w => w.length > 1).every(w => longer.includes(w));
}

/**
 * Split a bout string ("Fighter1 vs Fighter2") into its two names.
 * Returns [] if the string doesn't read as a two-fighter bout.
 */
export function splitBout(bout) {
  const parts = (bout || '').split(/\s+vs\.?\s+/i).map(s => s.trim()).filter(Boolean);
  return parts.length === 2 ? parts : [];
}

/**
 * Do two bout strings describe the same matchup?
 *
 * Corner order is NOT meaningful: the post-event scraper routinely rewrites a bout
 * reversed relative to how it read pre-event (conventions #1/#9), so
 * "A vs B" and "B vs A" are the same fight. Names compare via matchesFighter so a
 * respelling between scrapes doesn't read as an opponent swap either.
 * Unparseable input falls back to exact equality.
 */
export function sameMatchup(boutA, boutB) {
  const a = splitBout(boutA);
  const b = splitBout(boutB);
  if (a.length !== 2 || b.length !== 2) return (boutA || '') === (boutB || '');
  return (matchesFighter(a[0], b[0]) && matchesFighter(a[1], b[1]))
      || (matchesFighter(a[0], b[1]) && matchesFighter(a[1], b[0]));
}

/**
 * Grade a prediction against a known winner.
 *
 * Returns 'correct' | 'wrong' | 'draw' | null (not yet gradeable).
 *
 * winner semantics:
 *   undefined / null  → not graded yet (scraper hasn't run, ESPN hasn't reported)
 *   ''                → FINAL with nobody flagged as winner, i.e. a draw or no contest
 *
 * That distinction is why the empty string is meaningful here: a nullable winner
 * column alone cannot tell "drew" apart from "not graded".
 */
export function gradePrediction(pick, winner) {
  if (!pick) return null;
  if (winner === undefined || winner === null) return null;
  if (winner === '') return 'draw';
  return matchesFighter(winner, pick) ? 'correct' : 'wrong';
}
