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
  combineEstimators, scoreConfidence, scoreRevenueConfidence,
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
export { wishlistsFromRank, invertDistribution, accumulationFactor } from './wishlist-rank.js';
export {
  combineEstimators, scoreConfidence, scoreRevenueConfidence,
  scoreWishlistConfidence, worstLevel
} from './ensemble.js';
export { PILL_ITEMS, PILL_DEFAULTS, pillFigures } from './pill.js';

/**
 * Single entry point. Takes a normalised game object, returns everything the
 * overlay needs to render.
 *
 * @param {object} game
 * @param {number} game.appId
 * @param {number} [game.reviews]         total reviews, all languages
 * @param {number} [game.positivePct]     0-100
 * @param {number} [game.listPrice]       list price in USD, before any discount
 * @param {number} [game.price]           price on the page today, in USD
 * @param {number} [game.discountPct]     current discount, 0-100
 * @param {boolean} [game.isFree]
 * @param {boolean} [game.released]
 * @param {number} [game.releaseYear]
 * @param {number} [game.releaseDate]     epoch ms
 * @param {string[]} [game.tags]
 * @param {number} [game.followers]
 * @param {number} [game.allTimePeak]       highest concurrent count on record
 * @param {number} [game.allTimePeakAt]     epoch ms of the month it fell in
 * @param {Array} [game.monthlyHistory]     SteamCharts months, newest first
 * @param {number} [game.reviewerMedianHours] median playtime among reviewers
 * @param {number} [game.reviewerSampleSize]
 * @param {number} [game.steamPurchaseShare] 0-1, bought on Steam vs key
 * @param {{discounted:number, total:number}} [game.languageMix] review counts
 * @param {string|{lo:number,hi:number}} [game.owners]  SteamSpy owner band
 * @param {string} [game.festivalContext]   none | unknown | nextFest | featured
 * @param {number} [game.wishlistRank]      1-based place in Steam's Top Wishlists
 * @param {{listed:number, upcoming:number, at:number}} [game.wishlistListing]
 *        size of that ordering, how many announced games it is drawn from, and
 *        when it was snapshotted
 */
function buildConfidence(combined, flags, revenue, wishlists) {
  const units = scoreConfidence(combined, flags);
  const money = scoreRevenueConfidence(units, revenue.ok, revenue);
  const wl = scoreWishlistConfidence(wishlists);

  return {
    units,
    revenue: money,
    wishlists: wl,
    /** For surfaces that show several figures at once: the weakest of them. */
    overallFor: (keys) => worstLevel(keys.map((k) => ({
      units: units.level, net: money.level, wishlists: wl.level
    })[k])),
    // Retained so callers that only care about the headline keep working.
    level: units.level,
    reasons: units.reasons
  };
}

/**
 * Everything refuses, and says which kind of page this is.
 *
 * Built through buildConfidence rather than as a hand-written result shape:
 * the refusal has to look exactly like every other refusal to the overlay,
 * and a parallel literal here would drift the first time the real shape gains
 * a field.
 */
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

export function estimateAll(game, settings = {}) {
  // Only base games get numbers; see APP_TYPES for what else Steam serves
  // from /app/ and why each of those is declined. Absent means game, so a
  // caller that never looked at the type still gets an estimate.
  const appType = game.appType ?? APP_TYPES.estimable;
  if (appType !== APP_TYPES.estimable) return declineByType(game, appType);

  // Lifetime-unit estimators. Both measure the same quantity, so both may be
  // combined; anything measuring something else stays out of the average and
  // becomes a cross-check.
  const boxleiter = estimateUnits(game);

  const ownersBand = typeof game.owners === 'string' ? parseOwnersBand(game.owners) : game.owners;
  // SteamSpy answers for app ids it has never processed, with its own review
  // tally at zero while Steam reports a real one. That mismatch is the tell,
  // and it is not a small-game phenomenon: PEAK carried an empty record at
  // 367,000 Steam reviews, Escape from Tarkov at 63,000.
  //
  // The condition is "we have a Steam review count worth estimating from",
  // which is the test estimateUnits just applied — spelling it out again as a
  // review threshold made it a second copy of the display gate, which then
  // moved when that gate moved.
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

  // Cross-checks never move the number silently. They only widen the band and
  // lower confidence, so a disagreement stays visible.
  const flags = {
    lowSample: boxleiter.lowSample,
    // Why there is no owner band, when there is not one. "Single method" on
    // its own leaves the reader to guess whether the game is small, the
    // source is missing, or we simply did not look.
    ownersMissing: owners.ok ? null : owners.reason,
    ownersUntrusted: owners.ok && owners.weight === 0
  };

  // Owners are not treated as a ceiling on units, and the reason is worth
  // stating where the check would otherwise go.
  //
  // Owners bound units in principle, so an estimate above the top of the
  // SteamSpy band looks like a nameable inconsistency. It is not one.
  // SteamSpy publishes a bucket spanning 2x or more from a profile sample that
  // collapsed in 2018 and reads low, so its upper edge is the boundary of a
  // wide guess, not a fact about how many copies exist — and the likeliest
  // explanation for a breach is that the bucket is low, which the modest
  // weight it carries already accounts for.
  //
  // Such a check would also be redundant. The owner band is one of the
  // estimators being averaged, so whenever the others clear its top,
  // `disagreement` has already noticed and said so in a sentence that names
  // both figures. A ceiling flag would add a second, vaguer sentence about
  // the same fact, and by forcing the level rather than nudging it would let
  // that fact decide the verdict twice.
  const ccu = weekOneFromCcu(game.allTimePeak, {
    hadPreorders: game.hadPreorders ?? null,
    peakAt: game.allTimePeakAt ?? null,
    releaseDate: game.releaseDate ?? null
  });
  if (ccu.ok && unitRange && ccu.range.mid > unitRange.hi) {
    flags.ccuDisagrees = true;
  }

  // The player-hours route measures lifetime units, the same quantity the
  // ensemble does, and still stays out of the average: its divisor is an
  // average playtime no public source reports, and the reviewer sample that
  // stands in for it samples whoever bought the game most recently. See
  // PLAYTIME. So it can say the band looks wrong and never move it.
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
          // Where every method admits the figure could sit, or null when no
          // such place exists. This is what agreement means for interval
          // estimates, and what the panel reports.
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
    // Confidence is per figure, not one verdict for the panel. The three
    // numbers rest on different evidence: units on the ensemble, revenue on
    // those units plus a chain of assumptions, wishlists on a separate signal
    // that exists even when there is no sales estimate at all. A single word
    // covering all three would be wrong about at least one of them.
    confidence: buildConfidence(combined, flags, revenue, wishlists),
    generatedAt: Date.now()
  };
}
