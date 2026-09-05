import { ENSEMBLE, CONFIDENCE, WISHLIST } from './constants.js';

/** A descriptor: `key` resolves through chrome.i18n, `text` is the fallback. */
function msg(key, params, text) {
  return { key, params, text };
}

/** Weighted geometric mean. Sales figures are log-normally spread. */
function weightedMean(values, weights) {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return null;

  if (!ENSEMBLE.useGeometricMean) {
    return values.reduce((a, v, i) => a + v * weights[i], 0) / totalWeight;
  }
  const logSum = values.reduce((a, v, i) => a + Math.log(Math.max(v, 1)) * weights[i], 0);
  return Math.exp(logSum / totalWeight);
}

/**
 * Weighted combination of estimators of the same quantity. Used for units and
 * for wishlists.
 *
 * @param {Array<{method:string, range:{lo:number,mid:number,hi:number}, weight:number, label:string}>} estimators
 */
/**
 * Inverse-variance weight from a band's own width, in logs.
 *
 * A leg earns its say by being precise, not by existing. This replaces three
 * hand-set constants that assumed every leg's width was fixed: the
 * announcement leg's band runs from 1.4x on a fresh figure to 9.5x on a
 * four-year-old one, and a constant weight gave a stale figure the same vote
 * as a fresh one.
 */
const MIN_LOG_WIDTH = 0.05;

export function precisionWeight(range) {
  if (!range || !(range.hi > 0) || !(range.lo > 0)) return 0;
  const width = Math.max(Math.log(range.hi / range.lo), MIN_LOG_WIDTH);
  return 1 / (width * width);
}

export function combineEstimators(estimators) {
  const usable = estimators.filter((e) => e && e.range && e.weight > 0);

  if (!usable.length) return { ok: false, reason: 'no-estimators' };
  if (usable.length === 1) {
    const only = usable[0];
    return {
      ok: true,
      range: only.range,
      contributors: [{ ...only, share: 1 }],
      disagreement: 1,
      widened: false
    };
  }

  const mids = usable.map((e) => e.range.mid);
  const weights = usable.map((e) => e.weight);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  const mid = weightedMean(mids, weights);
  let lo = weightedMean(usable.map((e) => e.range.lo), weights);
  let hi = weightedMean(usable.map((e) => e.range.hi), weights);

  // Do the bands share any figure at all?
  const highestLow = Math.max(...usable.map((e) => e.range.lo));
  const lowestHigh = Math.min(...usable.map((e) => e.range.hi));
  const overlaps = highestLow <= lowestHigh;
  // How far apart the nearest edges are, once nothing is admitted by all.
  const gap = overlaps ? 1 : highestLow / Math.max(lowestHigh, 1);

  // How far the point estimates sit apart. Reported, never used to decide.
  const disagreement = Math.max(...mids) / Math.max(Math.min(...mids), 1);

  // Widen only when no figure satisfies every method.
  let widened = false;
  if (!overlaps) {
    lo = Math.min(lo, ...usable.map((e) => e.range.lo));
    hi = Math.max(hi, ...usable.map((e) => e.range.hi));
    widened = true;
  }

  return {
    ok: true,
    range: { lo, mid, hi },
    overlaps,
    gap,
    // Where every method agrees a figure could sit, when such a place exists.
    common: overlaps ? { lo: highestLow, hi: lowestHigh } : null,
    disagreement,
    widened,
    contributors: usable.map((e, i) => ({ ...e, share: weights[i] / totalWeight }))
  };
}

const LEVEL_ORDER = ['good', 'fair', 'low', 'none'];

/** Worst of a set of levels, for a surface that shows several figures at once. */
export function worstLevel(levels) {
  const present = levels.filter(Boolean);
  if (!present.length) return 'none';
  return present.reduce((a, b) => (LEVEL_ORDER.indexOf(b) > LEVEL_ORDER.indexOf(a) ? b : a));
}

/**
 * One step down the scale, floored at 'low'. 'none' means there is no estimate
 * at all, so it never changes.
 */
const WORST_SCORED = 'low';
function downgraded(level) {
  if (level === 'none') return 'none';
  const i = LEVEL_ORDER.indexOf(level);
  if (i < 0) return WORST_SCORED;
  return LEVEL_ORDER[Math.min(i + 1, LEVEL_ORDER.indexOf(WORST_SCORED))];
}


/**
 * Revenue confidence: the units level one step down, because every waterfall
 * step adds an assumption with a range of its own.
 */
export function scoreRevenueConfidence(unitsConfidence, ok, revenue = null) {
  if (!ok) return { level: 'none', reasons: [msg('rNoEstimate', [], 'No usable estimate')] };

  const reasons = [msg('rRevenueAssumptions', [], 'Sales band plus the waterfall assumptions')];
  let level = downgraded(unitsConfidence.level);

  // The one waterfall assumption that varies per game: the regional factor
  // spans 0.60 to 0.88 of list price, so reading it from the review languages
  // rather than defaulting is worth a step.
  const derived = revenue?.settings?.regionalDerivedFrom?.ok === true;
  if (derived) {
    reasons.push(msg('rRegionalMeasured', [], 'Audience mix read from review languages, not assumed'));
  } else {
    reasons.push(msg('rRegionalAssumed', [], 'Audience mix is a default; the regional factor spans 0.60 to 0.88'));
    level = downgraded(level);
  }

  return { level, reasons };
}

/**
 * Wishlist confidence, scored on its own terms: how many methods answered,
 * whether they agree, and whether anything contradicts them.
 */
/**
 * How much to trust a wishlist figure.
 *
 * Graded on what kind of number it is, not on how many methods answered. The
 * band width no longer carries that information: it is 2.11x for almost every
 * ranked game, because the curve's and the follower ratio's widths are fixed,
 * so width says which legs spoke rather than how good the evidence was. It is
 * kept only as a ceiling on the grade.
 *
 *   good  most of the answer is a figure the developer published, which
 *         happens while that figure is under about a month old
 *   fair  the answer is read off the store ranking; held out, the curve lands
 *         within 25% for 73% of games and within 50% for 95%
 *   low   the methods contradict, a bound is broken, or the ranking cannot
 *         answer and only the follower ratio is left
 */
export function scoreWishlistConfidence(wishlists) {
  if (!wishlists?.ok) return { level: 'none', reasons: [msg('rNoEstimate', [], 'No usable estimate')] };

  const found = [];
  const note = (severity, key, params, text) => found.push({ severity, key, params, text });

  const saidShare = wishlists.contributors?.find((c) => c.method === 'said')?.share ?? 0;
  let level = saidShare > 0.5 ? 'good' : 'fair';

  if (wishlists.said) {
    note(0, 'rWishlistSaid', [],
      'The developer published a figure for this game, so the estimate is mostly that number');
  }
  if (wishlists.rank && saidShare <= 0.5) {
    note(1, 'rWishlistRankCurve', [],
      "No published figure for this game, so the estimate is read from its place in Steam's wishlist ranking");
  } else if (!wishlists.rank && wishlists.rankReason === 'below-list') {
    note(2, 'rWishlistBelowList', [],
      "Below Steam's wishlist ranking entirely, so only the follower ratio answers");
    level = 'low';
  } else if (!wishlists.rank) {
    note(2, 'rWishlistRankPending', [],
      'The wishlist ranking has not arrived, so only the follower ratio answers');
    level = 'low';
  }

  // Two tiers: a gap inside the alarm threshold is reported, one beyond it
  // sets the level.
  if (wishlists.widened) {
    const alarming = wishlists.gap > ENSEMBLE.alarmGap;
    note(alarming ? 2 : 1, 'rNoCommonFigure', [wishlists.gap.toFixed(1)],
      `No figure fits every method; the nearest bands are ${wishlists.gap.toFixed(1)}x apart`);
    if (alarming) level = 'low';
  }

  // A broken bound is a contradiction, not a wide band.
  if (wishlists.ceilingBreached) {
    note(2, 'rWishlistCeiling', [],
      'The follower ratio implies more wishlists than the bottom of a ranking this game is not in');
    level = 'low';
  }

  // Which multiplier the follower leg used, as context only.
  if (wishlists.genre) {
    note(0, 'rWishlistGenre',
      [wishlists.genre.label, String(WISHLIST.lo), String(WISHLIST.hi)],
      `Genre multiplier for ${wishlists.genre.label}, inside the measured ${WISHLIST.lo}x to ${WISHLIST.hi}x range`);
  } else if (wishlists.followerRange) {
    note(0, 'rFollowerRatio', [String(WISHLIST.lo), String(WISHLIST.hi)],
      `All-games median multiplier; the follower ratio spans ${WISHLIST.lo}x to ${WISHLIST.hi}x`);
  }

  // Width is a ceiling on the grade, never the driver.
  const { lo, hi } = wishlists.range;
  const spread = hi / Math.max(lo, 1);
  if (spread > CONFIDENCE.wishlists.fair) {
    note(2, 'rBandSpans', [spread.toFixed(1)], `Band spans ${spread.toFixed(1)}x`);
    level = 'low';
  } else if (spread > CONFIDENCE.wishlists.good && level === 'good') {
    note(1, 'rBandSpans', [spread.toFixed(1)], `Band spans ${spread.toFixed(1)}x`);
    level = 'fair';
  }

  const reasons = found
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => b.severity - a.severity || a.i - b.i)
    .map(({ key, params, text, severity }) => ({ key, params, text, severity }));

  return { level, spread, reasons };
}

/**
 * Unit confidence: how well the signals agree and how wide the band is. Says
 * nothing about the game itself. Reasons come back worst first.
 */
export function scoreConfidence(combined, flags = {}) {
  if (!combined?.ok) {
    return { level: 'none', spread: null, reasons: [msg('rNoEstimate', [], 'No usable estimate')] };
  }

  const { lo, hi } = combined.range;
  const spread = hi / Math.max(lo, 1);
  const found = [];

  // Starts from the evidence — how many methods answered, whether they agree,
  // whether a cross-check objects. Width applies at the end, as a ceiling.
  let level = 'good';

  // 2 = this is why the level dropped, 1 = caution, 0 = context.
  const note = (severity, key, params, text) => found.push({ severity, key, params, text });
  const downgrade = () => { level = level === 'good' ? 'fair' : 'low'; };

  if (combined.contributors.length > 1) {
    note(0, 'rMethodsCombined', [String(combined.contributors.length)],
      `${combined.contributors.length} independent methods combined`);
  } else {
    // Caps at fair rather than low: one source is the normal case for
    // unreleased and small titles. The branches name which leg is missing.
    if (flags.ownersMissing === 'owner-record-empty') {
      note(1, 'rOwnersNoRecord', [],
        'SteamSpy has no data on file for this game, so there is no second method');
    } else if (flags.ownersUntrusted) {
      note(1, 'rOwnersTooSmall', [],
        "SteamSpy's owner band is too small to trust, so there is no second method");
    } else {
      note(1, 'rSingleMethod', [], 'Single method, no cross-check available');
    }
    downgrade();
  }

  // Two tiers: 1.9x apart puts one method outside its published 30% error, 4x
  // outside 50%. Below the alarm tier this only reports — `spread` was already
  // measured on the widened band, so downgrading here would count it twice.
  if (combined.widened) {
    const alarming = combined.gap > ENSEMBLE.alarmGap;
    note(alarming ? 2 : 1, 'rNoCommonFigure', [combined.gap.toFixed(1)],
      `No figure fits every method; the nearest bands are ${combined.gap.toFixed(1)}x apart`);
    if (alarming) level = 'low';
  }
  if (flags.lowSample) {
    note(1, 'rFewReviews', [], 'Few reviews, so the band is widened');
    downgrade();
  }
  if (flags.ccuDisagrees) {
    note(1, 'rCcuDisagree', [], 'Player-count cross-check implies a larger launch than the review estimate');
    downgrade();
  }
  if (flags.playtimeDisagrees) {
    note(1, 'rPlaytimeDisagree', [], 'Player-hours imply a figure outside this band, on an average playtime nobody publishes');
    downgrade();
  }

  // The width ceiling, applied last so nothing can talk its way past it.
  if (spread > CONFIDENCE.fair) {
    note(2, 'rBandSpans', [spread.toFixed(1)], `Band spans ${spread.toFixed(1)}x`);
    level = 'low';
  } else if (spread > CONFIDENCE.good) {
    note(0, 'rBandSpans', [spread.toFixed(1)], `Band spans ${spread.toFixed(1)}x`);
  }

  // Only when nothing else has been said.
  if (level === 'good' && !found.length) {
    note(0, 'rAgree', [], 'Sources agree within the expected band');
  }

  // Stable sort by severity: the reason that set the level leads.
  const reasons = found
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => b.severity - a.severity || a.i - b.i)
    // Severity travels with the reason so the interface can emphasise alarms.
    .map(({ key, params, text, severity }) => ({ key, params, text, severity }));

  return { level, spread, reasons };
}
