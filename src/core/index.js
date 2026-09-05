import {
  estimateUnits,
  weekOneFromCcu,
  unitsFromOwners,
  unitsFromPlaytime,
  parseOwnersBand
} from './units.js';
import { estimateRevenueRange } from './revenue.js';
import { estimateWishlists, weekOneSales } from './wishlists.js';
import {
  combineEstimators, precisionWeight, scoreConfidence, scoreRevenueConfidence,
  scoreWishlistConfidence, worstLevel
} from './ensemble.js';
import { APP_TYPES, ENSEMBLE } from './constants.js';

export * from './constants.js';
export * from './history.js';
export { setLocale, compact, money, pct, integer } from './format.js';
export {
  estimateUnits, weekOneFromCcu, unitsFromOwners, unitsFromPlaytime,
  parseOwnersBand, parseAllTimePeak, parseChartsStats, parseMonthlyHistory,
  parseRecentTrend, parseReviewSummary, allTimePeakMonth, medianHours,
  collectAdjustments
} from './units.js';
export {
  estimateRevenue, estimateRevenueRange, steamRoyalty, resolveSettings,
  regionalFromLanguages, waterfallEnvelope
} from './revenue.js';
export { estimateWishlists, weekOneSales, wishlistMultiplierFor } from './wishlists.js';
export { wishlistsFromRank, curveAt } from './wishlist-rank.js';
export { wishlistsFromAnnouncement } from './wishlist-said.js';
export {
  combineEstimators, precisionWeight, scoreConfidence, scoreRevenueConfidence,
  scoreWishlistConfidence, worstLevel
} from './ensemble.js';
export { PILL_ITEMS, PILL_DEFAULTS, pillFigures } from './pill.js';

function buildConfidence(combined, flags, revenue, wishlists) {
  const units = scoreConfidence(combined, flags);
  const money = scoreRevenueConfidence(units, revenue.ok, revenue);
  const wl = scoreWishlistConfidence(wishlists);

  return {
    units,
    revenue: money,
    wishlists: wl,
    /** The weakest level among the named figures. */
    overallFor: (keys) => worstLevel(keys.map((k) => ({
      units: units.level, net: money.level, wishlists: wl.level
    })[k])),
    // Kept for callers that read only the headline.
    level: units.level,
    reasons: units.reasons
  };
}

/** A full refusal in the normal result shape, naming the page type. */
function declineByType(game, appType) {
  const decline = { ok: false, reason: 'unsupported-type', appType };
  return {
    appId: game.appId,
    game,
    units: decline,
    revenue: decline,
    wishlists: decline,
    weekOne: decline,
    crossChecks: { ccu: decline, owners: decline, playtime: decline },
    confidence: buildConfidence({ ok: false }, {}, decline, decline),
    generatedAt: Date.now()
  };
}

/**
 * Single entry point: a normalised game in, everything the overlay renders out.
 *
 * @param {object} game
 * @param {number} game.appId
 * @param {number} [game.reviews]         total reviews, all languages
 * @param {number} [game.positivePct]     0-100
 * @param {number} [game.listPrice]       list price in USD, before any discount
 * @param {number} [game.price]           price on the page today, in USD
 * @param {number} [game.discountPct]     current discount, 0-100
 * @param {number} [game.releaseDate]     epoch ms
 * @param {number} [game.allTimePeak]       highest concurrent count on record
 * @param {number} [game.allTimePeakAt]     epoch ms of the month it fell in
 * @param {Array} [game.monthlyHistory]     SteamCharts months, newest first
 * @param {number} [game.reviewerMedianHours] median playtime among reviewers
 * @param {number} [game.steamPurchaseShare] 0-1, bought on Steam vs key
 * @param {{discounted:number, total:number}} [game.languageMix] review counts
 * @param {string|{lo:number,hi:number}} [game.owners]  SteamSpy owner band
 * @param {string} [game.festivalContext]   none | unknown | nextFest | featured
 * @param {number} [game.wishlistRank]      1-based place in Steam's Top Wishlists
 * @param {{listed:number, upcoming:number, at:number}} [game.wishlistListing]
 *        size of that ordering, how many announced games it is drawn from, and
 *        when it was snapshotted
 */
export function estimateAll(game, settings = {}) {
  // Absent type means game, so a caller that never read the type still gets
  // an estimate. See APP_TYPES for what else Steam serves from /app/.
  const appType = game.appType ?? APP_TYPES.estimable;
  if (appType !== APP_TYPES.estimable) return declineByType(game, appType);

  // Lifetime-unit estimators. Only methods measuring this same quantity may
  // be averaged; everything else stays a cross-check.
  const boxleiter = estimateUnits(game);

  const ownersBand = typeof game.owners === 'string' ? parseOwnersBand(game.owners) : game.owners;
  // SteamSpy answers for app ids it never processed with its own review tally
  // at zero while Steam reports a real one. That mismatch is the tell.
  const recordEmpty = game.ownerRecordReviews === 0 && boxleiter.ok;
  const owners = unitsFromOwners(ownersBand, {
    steamPurchaseShare: game.steamPurchaseShare,
    recordEmpty
  });

  const playtime = unitsFromPlaytime(game.monthlyHistory, game.reviewerMedianHours, {
    sampleSize: game.reviewerSampleSize
  });

  const estimators = [];
  if (boxleiter.ok) {
    estimators.push({
      method: 'boxleiter',
      label: { key: 'mBoxleiter', text: 'Reviews x adjusted multiplier' },
      range: boxleiter.range,
      weight: boxleiter.lowSample
        ? ENSEMBLE.boxleiter.base * ENSEMBLE.boxleiter.lowSamplePenalty
        : ENSEMBLE.boxleiter.base
    });
  }
  if (owners.ok && owners.weight > 0) {
    estimators.push({
      method: 'owners',
      label: { key: 'mOwnersBand', text: 'SteamSpy owner band' },
      range: owners.range,
      weight: owners.weight
    });
  }

  const combined = combineEstimators(estimators);
  const unitRange = combined.ok ? combined.range : null;

  // Cross-checks only widen the band and lower confidence; they never move
  // the number.
  const flags = {
    lowSample: boxleiter.lowSample,
    // Why there is no owner band, when there is not one.
    ownersMissing: owners.ok ? null : owners.reason,
    ownersUntrusted: owners.ok && owners.weight === 0
  };

  const ccu = weekOneFromCcu(game.allTimePeak, {
    hadPreorders: game.hadPreorders ?? null,
    peakAt: game.allTimePeakAt ?? null,
    releaseDate: game.releaseDate ?? null
  });
  if (ccu.ok && unitRange && ccu.range.mid > unitRange.hi) {
    flags.ccuDisagrees = true;
  }

  // Cross-check only: its divisor is an average playtime no public source
  // reports. See PLAYTIME.
  if (playtime.ok && unitRange
      && (playtime.range.lo > unitRange.hi || playtime.range.hi < unitRange.lo)) {
    flags.playtimeDisagrees = true;
  }

  const revenue = unitRange && !game.isFree
    ? estimateRevenueRange(unitRange, game.listPrice ?? game.price, settings, {
        languageMix: game.languageMix
      })
    : { ok: false, reason: game.isFree ? 'free-to-play' : 'no-units' };

  const wishlists = estimateWishlists(game);
  const weekOne = weekOneSales(game, wishlists.ok ? wishlists.range : null);

  return {
    appId: game.appId,
    game,
    units: combined.ok
      ? {
          ok: true,
          range: combined.range,
          contributors: combined.contributors,
          disagreement: combined.disagreement,
          widened: combined.widened,
          // Overlap of every method's range, or null when there is none.
          common: combined.common,
          gap: combined.gap,
          // Kept so the "why this number" panel can show the multiplier chain.
          boxleiter: boxleiter.ok ? boxleiter : null,
          owners: owners.ok ? owners : null,
          playtime: playtime.ok ? playtime : null,
          lowSample: Boolean(boxleiter.lowSample)
        }
      : {
          ok: false,
          reason: boxleiter.ok ? combined.reason : boxleiter.reason,
          reviews: boxleiter.reviews
        },
    revenue,
    wishlists,
    weekOne,
    crossChecks: { ccu, owners, playtime },
    // Per figure, not one verdict: the three rest on different evidence.
    confidence: buildConfidence(combined, flags, revenue, wishlists),
    generatedAt: Date.now()
  };
}
