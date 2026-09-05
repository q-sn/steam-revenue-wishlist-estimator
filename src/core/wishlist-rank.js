import { WISHLIST_RANK } from './constants.js';

/**
 * Wishlists from a game's place in Steam's Top Wishlists ordering.
 *
 * The store ranks unreleased games by wishlists and prints no numbers, so on
 * its own this is an ordinal signal: it says a game is ahead of another one
 * without saying by how much, and there is no arithmetic that turns a
 * position into a count. What turns it into one is a distribution — if we
 * know what share of games launch above 100,000 wishlists, then a game in the
 * top 6% of announced titles is a game near that line.
 *
 * That distribution is published (VGI_WISHLISTS_2025) and this file inverts
 * it. Two consequences worth being explicit about, because they are the whole
 * character of the estimate:
 *
 *  - The band is the published band. The source distinguishes five levels;
 *    a game landing between two of its edges is reported as sitting between
 *    them. The midpoint inside that band is interpolated, the edges are not.
 *
 *  - The ordering covers only the top third of announced games, so a game
 *    absent from it is not unmeasurable — it is below the bottom of the list,
 *    which is a ceiling and is reported as one. A ceiling is not an estimate
 *    and never joins the average; it can only disagree with one.
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Log-space interpolation between two (share, wishlists) points. */
function between(q, qHi, wHi, qLo, wLo) {
  const span = Math.log(qLo) - Math.log(qHi);
  if (!Number.isFinite(span) || span === 0) return wHi;
  const t = Math.min(1, Math.max(0, (Math.log(q) - Math.log(qHi)) / span));
  return Math.exp(Math.log(wHi) + t * (Math.log(wLo) - Math.log(wHi)));
}

/**
 * Wishlists for a game that `share` of announced games sit above.
 *
 * Walks the published bands from the top. `topShare` is where the ceiling
 * sits — the share of games above the largest count the source observed,
 * which is one game out of the whole announced population. Without it the
 * first band has no upper corner and the game at rank 1 has no answer.
 */
export function invertDistribution(share, topShare) {
  const bands = WISHLIST_RANK.distribution;
  const first = bands[0];

  if (share <= first.shareAbove) {
    return {
      lo: first.above,
      hi: WISHLIST_RANK.ceiling,
      mid: between(Math.max(share, topShare), topShare, WISHLIST_RANK.ceiling, first.shareAbove, first.above),
      band: { lo: first.above, hi: WISHLIST_RANK.ceiling, open: 'top' }
    };
  }

  for (let i = 1; i < bands.length; i++) {
    const upper = bands[i - 1];
    const lower = bands[i];
    if (share <= lower.shareAbove) {
      return {
        lo: lower.above,
        hi: upper.above,
        mid: between(share, upper.shareAbove, upper.above, lower.shareAbove, lower.above),
        band: { lo: lower.above, hi: upper.above }
      };
    }
  }

  // Past the last published edge. The source stops distinguishing here, so we
  // stop too: everything below is "under the smallest edge it names".
  const last = bands[bands.length - 1];
  return { lo: 0, hi: last.above, mid: null, band: { lo: 0, hi: last.above, open: 'bottom' } };
}

/**
 * How much of its launch wishlist total a game is likely to be holding today.
 *
 * Returns a factor when the release date lands inside the published curve,
 * and the curve's whole span when it does not — which is most of the time,
 * because an unreleased store page usually carries a quarter or a year rather
 * than a date. Refusing to extrapolate past 17 weeks is deliberate: the shape
 * of accumulation before that is not in the source, and inventing it would
 * put the largest uncertainty in this chain behind a confident-looking number.
 */
export function accumulationFactor(releaseDate, now = Date.now()) {
  const { curve, span } = WISHLIST_RANK.accumulation;
  const spanMid = Math.sqrt(span.lo * span.hi);

  if (!Number.isFinite(releaseDate)) {
    return { ok: false, reason: 'no-date', span, factor: spanMid };
  }

  const weeksOut = (releaseDate - now) / WEEK_MS;
  if (weeksOut < 0) return { ok: false, reason: 'past-date', span, factor: spanMid };

  const furthest = curve[0];
  if (weeksOut > furthest.weeksOut) {
    return { ok: false, reason: 'outside-window', weeksOut, span, factor: spanMid };
  }

  // Curve runs furthest-out first, so walk until the pair straddling weeksOut.
  for (let i = 1; i < curve.length; i++) {
    const outer = curve[i - 1];
    const inner = curve[i];
    if (weeksOut >= inner.weeksOut) {
      const t = (weeksOut - inner.weeksOut) / (outer.weeksOut - inner.weeksOut);
      return {
        ok: true,
        weeksOut,
        factor: inner.fraction + t * (outer.fraction - inner.fraction)
      };
    }
  }
  return { ok: true, weeksOut, factor: curve[curve.length - 1].fraction };
}

/**
 * @param {number|null} rank         1-based position, or null if not on the list
 * @param {object} listing           { listed, upcoming, at } from the daily snapshot
 * @param {object} [opts]
 * @param {number} [opts.releaseDate] epoch ms, for the accumulation correction
 * @param {number} [opts.now]
 */
export function wishlistsFromRank(rank, listing, opts = {}) {
  if (!listing || !Number.isFinite(listing.listed) || !Number.isFinite(listing.upcoming)
      || listing.listed <= 0 || listing.upcoming < listing.listed) {
    return { ok: false, reason: 'no-listing' };
  }

  const now = opts.now ?? Date.now();
  if (Number.isFinite(listing.at) && now - listing.at > WISHLIST_RANK.maxAgeMs) {
    return { ok: false, reason: 'stale-listing', ageMs: now - listing.at };
  }

  const accumulation = accumulationFactor(opts.releaseDate ?? null, now);
  const topShare = 1 / listing.upcoming;

  // Not on the list. That is a fact about the game, not a gap in our data:
  // it sits below every ranked position, so the count at the bottom of the
  // ordering is a ceiling on it. Reported as a bound, never as an estimate —
  // a bound has no midpoint and does not belong in an average.
  if (!Number.isFinite(rank) || rank <= 0) {
    const floor = invertDistribution(listing.listed / listing.upcoming, topShare);
    return {
      ok: false,
      reason: 'below-list',
      listed: listing.listed,
      upcoming: listing.upcoming,
      // Deflated the same way an estimate would be, so the ceiling is
      // comparable with the figure it is a ceiling on.
      ceiling: floor.hi * (accumulation.ok ? accumulation.factor : accumulation.span.hi)
    };
  }

  const share = rank / listing.upcoming;
  const raw = invertDistribution(share, topShare);
  if (raw.mid == null) return { ok: false, reason: 'below-published-bands', rank };

  const lo = raw.lo * (accumulation.ok ? accumulation.factor : accumulation.span.lo);
  const hi = raw.hi * (accumulation.ok ? accumulation.factor : accumulation.span.hi);
  const mid = raw.mid * accumulation.factor;

  return {
    ok: true,
    rank,
    listed: listing.listed,
    upcoming: listing.upcoming,
    /** Share of announced games ranked above this one, for display. */
    percentile: share,
    band: raw.band,
    accumulation,
    range: { lo, mid: Math.min(Math.max(mid, lo), hi), hi }
  };
}
