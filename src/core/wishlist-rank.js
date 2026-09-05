import { WISHLIST_CURVE, WISHLIST_RANK } from './constants.js';

/** The fitted curve. One expression for every position, no boundaries. */
export function curveAt(rank) {
  return WISHLIST_CURVE.a / Math.pow(Math.max(1, rank) + WISHLIST_CURVE.q, WISHLIST_CURVE.b);
}

/**
 * @param {number|null} rank      1-based position, or null if not on the list
 * @param {object} listing        { listed, upcoming, at } from the daily snapshot
 * @param {object} [opts]
 * @param {number} [opts.now]
 */
export function wishlistsFromRank(rank, listing, opts = {}) {
  if (!listing || !Number.isFinite(listing.listed) || listing.listed <= 0) {
    return { ok: false, reason: 'no-listing' };
  }

  const now = opts.now ?? Date.now();
  if (Number.isFinite(listing.at) && now - listing.at > WISHLIST_RANK.maxAgeMs) {
    return { ok: false, reason: 'stale-listing', ageMs: now - listing.at };
  }

  const { band } = WISHLIST_CURVE;

  // Absent from the ordering, so the game sits below every ranked position and
  // the curve's value at the last one bounds it. A bound, never an estimate: it
  // has no midpoint and does not belong in an average.
  if (!Number.isFinite(rank) || rank <= 0) {
    return {
      ok: false,
      reason: 'below-list',
      listed: listing.listed,
      upcoming: listing.upcoming ?? null,
      ceiling: curveAt(listing.listed) * band.hi
    };
  }

  const mid = curveAt(rank);

  return {
    ok: true,
    rank,
    listed: listing.listed,
    upcoming: listing.upcoming ?? null,
    /**
     * Share of every announced game sitting above this one, for display only.
     * Null when the snapshot did not carry the announced count — the ordering
     * is 37% of that population, so the two denominators are not swappable.
     */
    announcedShare: Number.isFinite(listing.upcoming) && listing.upcoming > 0
      ? rank / listing.upcoming
      : null,
    range: { lo: mid * band.lo, mid, hi: mid * band.hi }
  };
}
