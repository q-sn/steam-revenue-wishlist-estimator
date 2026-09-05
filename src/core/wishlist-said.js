import { WISHLIST_SAID } from './constants.js';

/**
 * Wishlists from a figure the studio published about its own game.
 *
 * Two corrections, both from the fit in OURS_WISHLIST_MODEL: the figure was a
 * milestone crossing rather than a reading, and it was true on the day it was
 * posted. `lo` never falls below the announced figure, because a studio's own
 * count is a hard floor at that date and wishlists only grow before release.
 *
 * There is no age cutoff. An old announcement is weaker evidence, not absent
 * evidence, and the band widens with age to say so.
 *
 * @param {object|null} said      { wishlists, announcedAt } from the daily feed
 * @param {object} [opts]
 * @param {number} [opts.now]
 */
export function wishlistsFromAnnouncement(said, opts = {}) {
  if (!said || !Number.isFinite(said.wishlists) || said.wishlists <= 0) {
    return { ok: false, reason: 'nothing-announced' };
  }

  const at = Date.parse(said.announcedAt);
  if (!Number.isFinite(at)) return { ok: false, reason: 'undated-announcement' };

  const now = opts.now ?? Date.now();
  const ageDays = Math.max(0, (now - at) / 86_400_000);
  const { tau, alpha, floor, loFloor, loAlpha, hiFloor, hiAlpha } = WISHLIST_SAID;

  const w = said.wishlists;
  const t = 1 + ageDays / tau;
  const grown = floor * Math.pow(t, alpha);

  return {
    ok: true,
    announced: w,
    announcedAt: said.announcedAt,
    ageDays,
    growth: grown,
    range: {
      lo: Math.max(w, w * loFloor * Math.pow(t, loAlpha)),
      mid: w * grown,
      hi: w * hiFloor * Math.pow(t, hiAlpha)
    }
  };
}
