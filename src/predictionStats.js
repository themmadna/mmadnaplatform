/**
 * predictionStats.js — turns raw picks into the profile's record and breakdowns.
 *
 * Kept out of App.js because the rules here are the kind that go quietly wrong:
 * which column each cut comes from, what counts toward a record, and when a
 * percentage is honest enough to show.
 */

import { gradePrediction } from './fighterNames';

/** Below this many graded picks, a row shows its raw count instead of a percentage. */
export const MIN_FOR_PCT = 5;

/**
 * Attach everything the cuts and the record need to one pick.
 *
 * The three cuts straddle two columns and no single one carries all of them:
 *   division / sex → fight_meta_details.weight_class_clean
 *   title          → fights.weight_class (RAW) — the clean column strips title wording,
 *                    verified against six real title fights, none of which retained it.
 * Build the stakes cut off the clean column and every title fight silently lands in the
 * non-title bucket: a breakdown that looks plausible and is wrong.
 */
/**
 * Division from the RAW weight class, for fights that have no fight_meta_details row yet.
 *
 * fight_meta_details is written by the post-event scraper, so weight_class_clean is null
 * for every upcoming and just-finished fight — exactly the ones a user has live picks on.
 * Without this fallback the division cut silently drops them, and worse, every women's
 * bout gets counted as men's, because the sex test runs off a null string.
 *
 * Validated against all 989 fights in the DB that have both columns: this reproduces
 * weight_class_clean exactly, 989/989. Note "UFC" and "Interim" are stripped only as a
 * LEADING prefix — "Road to UFC 4 Bantamweight Tournament" keeps its UFC.
 */
export function divisionFromRaw(raw) {
  if (!raw) return null;
  const s = String(raw)
    .replace(/^\s*UFC\s+/i, '')
    .replace(/^\s*Interim\s+/i, '')
    .replace(/\s*\bTitle\b/ig, '')
    .replace(/\s*\bChampionship\b/ig, '')
    .replace(/\s*\bBout\b\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s || null;
}

export function enrichPick(p) {
  const raw = p.weight_class || '';
  // Prefer the analytics column; fall back to the raw one until the scraper has run.
  const clean = p.weight_class_clean || divisionFromRaw(raw);

  // A pick refers to a specific MATCHUP. If the bout no longer reads the way it did when
  // picked — opponent swap, withdrawal, scratch — the pick is void and counts neither way.
  const voided = !!p.bout_snapshot && !!p.bout && p.bout_snapshot !== p.bout;

  const ended = !!p.fight_ended_at || p.status === 'completed';
  // gradePrediction distinguishes '' (draw / no contest) from null (not graded yet),
  // so only pass a winner through once the fight has actually ended.
  const grade = voided ? null : gradePrediction(p.predicted_fighter, ended ? (p.winner ?? null) : undefined);

  return {
    ...p,
    voided,
    ended,
    grade,                                           // 'correct' | 'wrong' | 'draw' | null
    pending: !voided && !grade,                      // picked, no verdict yet
    division: clean,
    isWomens: !!clean && /^women'?s\b/i.test(clean),
    isTitle: /\btitle\b/i.test(raw),
    isInterim: /\binterim\b/i.test(raw),
    year: p.event_date ? String(p.event_date).slice(0, 4) : null,
  };
}

/**
 * Count a set of picks.
 *
 * Draws and voids are deliberately outside the win/loss denominator: a draw counts
 * neither way, and a void is a fight the user never really picked. Folding either in
 * would quietly distort the record.
 */
export function tally(picks) {
  let w = 0, l = 0, draw = 0, pending = 0, voided = 0;
  for (const p of picks) {
    if (p.voided) voided++;
    else if (p.grade === 'correct') w++;
    else if (p.grade === 'wrong') l++;
    else if (p.grade === 'draw') draw++;
    else pending++;
  }
  const graded = w + l;
  return {
    w, l, draw, pending, voided, graded,
    pct: graded ? Math.round((w / graded) * 100) : null,
    /** Percentages below MIN_FOR_PCT graded picks are noise — the UI shows the count instead. */
    showPct: graded >= MIN_FOR_PCT,
  };
}

/**
 * Group picks and tally each group.
 *
 * Sorted by VOLUME, never by accuracy. Sorting by percentage puts the noisiest rows on
 * top by construction — one lucky pick outranks a record built on forty.
 */
export function groupBy(picks, keyFn) {
  const buckets = new Map();
  for (const p of picks) {
    const k = keyFn(p);
    if (k === null || k === undefined) continue;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(p);
  }
  return [...buckets.entries()]
    .map(([key, list]) => ({ key, picks: list, ...tally(list) }))
    .sort((a, b) => (b.graded + b.pending) - (a.graded + a.pending) || String(a.key).localeCompare(String(b.key)));
}

/** Per-event rows for the Event scope, newest card first. */
export function byEvent(picks) {
  const rows = groupBy(picks, p => p.event_name);
  return rows.sort((a, b) => String(b.picks[0]?.event_date || '').localeCompare(String(a.picks[0]?.event_date || '')));
}

/** Years the user actually has picks in, newest first. */
export function availableYears(picks) {
  return [...new Set(picks.map(p => p.year).filter(Boolean))].sort().reverse();
}
