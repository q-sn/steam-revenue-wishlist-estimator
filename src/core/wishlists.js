import { WISHLIST, WISHLIST_CURVE, WEEK_ONE } from './constants.js';
import { wishlistsFromAnnouncement } from './wishlist-said.js';
import { matchTagRule } from './tags.js';
import { wishlistsFromRank } from './wishlist-rank.js';
import { combineEstimators, precisionWeight } from './ensemble.js';

/**
 * The follower-to-wishlist multiplier for a game's most-applied surveyed
 * genre, or null. The surveyed figures are a shape, not a level: each carries
 * over as its distance from the survey's own median. See GDC_FOLLOWERS_2023.
 */
export function wishlistMultiplierFor(tags) {
  const rule = matchTagRule(tags, WISHLIST.genres);
  if (!rule) return null;
  return {
    multiplier: (rule.multiplier / WISHLIST.surveyMedian) * WISHLIST.median,
    /** What the survey itself printed. */
    surveyed: rule.multiplier,
    label: rule.label,
    source: rule.source
  };
}

/** Wishlists from follower count. */
function fromFollowers(game, followers) {
  // The key actually applied, so the caption cannot name a multiplier the
  // maths never used.
  const contextKey = WISHLIST.contexts[game.festivalContext] ? game.festivalContext : 'unknown';
  const context = WISHLIST.contexts[contextKey];

  const genre = wishlistMultiplierFor(game.tags);
  const base = genre ? genre.multiplier : WISHLIST.median;

  // Clamped into the measured range: a low genre with a context factor below
  // 1 can otherwise put the midpoint under the low end of its own band.
  const multiplier = Math.min(Math.max(base * context.factor, WISHLIST.lo), WISHLIST.hi);

  return {
    followers,
    contextKey,
    context,
    genre,
    multiplier,
    range: {
      lo: followers * WISHLIST.lo,
      mid: followers * multiplier,
      hi: followers * WISHLIST.hi
    }
  };
}

/**
 * Wishlists, from up to three marks on the same quantity: what the studio
 * said, rank through the curve, and followers x ratio. Pre-release only.
 */
export function estimateWishlists(game, opts = {}) {
  const followers = Number.isFinite(game.followers) && game.followers > 0 ? game.followers : null;

  // Checked before the follower count: for a released game, "it shipped" is
  // the accurate reason to report.
  if (game.released) {
    return {
      ok: false,
      reason: 'released',
      followers,
      noteKey: 'wReleased',
      note: 'Wishlists are consumed by purchases at launch while followers persist, so the ratio no longer holds. The balance typically peaks at 2-4x the pre-launch count shortly after release, then decays.'
    };
  }

  const rank = Number.isFinite(game.wishlistRank) ? game.wishlistRank : null;
  const listing = game.wishlistListing ?? null;

  const saidLeg = wishlistsFromAnnouncement(game.wishlistSaid ?? null, { now: opts.now });
  const followerLeg = followers != null ? fromFollowers(game, followers) : null;
  const rankLeg = wishlistsFromRank(rank, listing, { now: opts.now });

  const estimators = [];
  if (saidLeg.ok) {
    estimators.push({
      method: 'said',
      label: { key: 'mWishlistSaid', text: 'The developer said so' },
      origin: {
        key: 'oSaidOn',
        params: [saidLeg.announcedAt],
        text: `announced ${saidLeg.announcedAt}, carried forward at the measured growth rate`
      },
      range: saidLeg.range,
      weight: precisionWeight(saidLeg.range)
    });
  }
  if (followerLeg) {
    estimators.push({
      method: 'followers',
      label: { key: 'mFollowerRatio', text: 'Followers x published ratio' },
      origin: {
        key: WISHLIST.level.originKey,
        params: WISHLIST.level.originParams,
        text: WISHLIST.level.originText
      },
      range: followerLeg.range,
      weight: precisionWeight(followerLeg.range)
    });
  }
  if (rankLeg.ok) {
    estimators.push({
      method: 'rank',
      label: { key: 'mWishlistRank', text: "Steam wishlist ranking" },
      origin: { key: 'oRankCurve', params: [String(WISHLIST_CURVE.fittedOn)], text: `curve measured here on ${WISHLIST_CURVE.fittedOn} announcements` },
      range: rankLeg.range,
      weight: precisionWeight(rankLeg.range)
    });
  }

  // A bound, not an estimate: it never joins the average, only contradicts one.
  const ceiling = rankLeg.reason === 'below-list' ? rankLeg.ceiling : null;

  if (!estimators.length) {
    return {
      ok: false,
      reason: 'no-followers',
      followers,
      rank: null,
      rankReason: rankLeg.reason,
      ceiling
    };
  }

  const combined = combineEstimators(estimators);

  // The estimate claims more wishlists than the bottom of a list the game is
  // not on. Reported as a conflict, never averaged away.
  const ceilingBreached = ceiling != null && combined.range.lo > ceiling;

  return {
    ok: true,
    followers,
    // Follower-leg detail, kept flat: the overlay caption and the history
    // delta read these fields directly.
    contextKey: followerLeg?.contextKey ?? null,
    context: followerLeg?.context ?? null,
    genre: followerLeg?.genre ?? null,
    multiplier: followerLeg?.multiplier ?? null,
    followerRange: followerLeg?.range ?? null,
    rank: rankLeg.ok ? rankLeg : null,
    rankReason: rankLeg.ok ? null : rankLeg.reason,
    said: saidLeg.ok ? saidLeg : null,
    ceiling,
    ceilingBreached,
    range: combined.range,
    contributors: combined.contributors,
    widened: combined.widened,
    gap: combined.gap,
    common: combined.common,
    disagreement: combined.disagreement
  };
}

/**
 * Two published routes to week-one sales, shown side by side; they disagree by
 * roughly 2x. `span` is where the two answers sit, not a range with a centre —
 * there is deliberately no midpoint.
 */
export function weekOneSales(game, wishlistRange) {
  const out = [];

  if (wishlistRange?.mid) {
    out.push({
      key: 'via-wishlists',
      labelKey: 'pathWishlists',
      label: WEEK_ONE.fromWishlists.label,
      source: WEEK_ONE.fromWishlists.source,
      value: wishlistRange.mid * WEEK_ONE.fromWishlists.factor
    });
  }

  if (Number.isFinite(game.followers) && game.followers > 0) {
    out.push({
      key: 'via-followers',
      labelKey: 'pathFollowers',
      label: WEEK_ONE.fromFollowers.label,
      source: WEEK_ONE.fromFollowers.source,
      value: game.followers * WEEK_ONE.fromFollowers.factor
    });
  }

  if (out.length < 2) return { ok: out.length > 0, paths: out };

  const values = out.map((p) => p.value);

  return {
    ok: true,
    paths: out,
    disagreement: Math.max(...values) / Math.min(...values),
    span: { lo: Math.min(...values), hi: Math.max(...values) }
  };
}
