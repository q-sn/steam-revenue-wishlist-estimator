import { ENSEMBLE, CONFIDENCE, WISHLIST } from './constants.js';
import { compact } from './format.js';

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

/**
 * How a band opens when the marks admit no common figure.
 *
 *   envelope  cover every mark's own band, edge to edge
 *   gap       keep the weighted band and stretch it by how far apart the
 *             nearest edges are
 *
 * Envelope lets a mark set an edge regardless of its weight, so a wide,
 * lightly weighted mark decides the answer's width. On a wishlist estimate
 * that turned a 1.36x disagreement into a 6.1x band, with the top edge coming
 * from a leg holding 5% of the weight.
 */
export function combineEstimators(estimators, { widenBy = 'envelope' } = {}) {
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
    if (widenBy === 'gap') {
      const stretch = Math.sqrt(gap);
      lo /= stretch;
      hi *= stretch;
    } else {
      lo = Math.min(lo, ...usable.map((e) => e.range.lo));
      hi = Math.max(hi, ...usable.map((e) => e.range.hi));
    }
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
 * Revenue confidence: exactly the units level, for gross and for net alike.
 *
 * It used to be the units level one step down, and another step down when the
 * regional factor was a default rather than read from review languages. That
 * double-counted, and visibly: a game with two methods agreeing inside 2.4x
 * read `good` on units and `low` on revenue, which is not a statement anyone
 * can act on.
 *
 * The waterfall's own uncertainty is already in the figure. `estimateRevenueRange`
 * walks every assumption to its published edge — discount 10-30%, refunds
 * 6-13%, the regional profile one either side — so the revenue band is wider
 * than the unit band it came from, by exactly the amount those assumptions are
 * worth. Marking the level down as well charges for the same uncertainty
 * twice. That is the rule `scoreConfidence` already states for a widened
 * ensemble band, and METHODOLOGY says the revenue band was drawn wide rather
 * than narrow for this precise reason.
 *
 * What is left is what the unit estimate is worth, which is what sets the
 * width of both figures. The waterfall still gets its say, as reasons: whether
 * the audience mix was read or assumed is worth knowing and does not change
 * how much to trust the number.
 */
export function scoreRevenueConfidence(unitsConfidence, ok, revenue = null) {
  if (!ok) return { level: 'none', reasons: [msg('rNoEstimate', [], 'No usable estimate')] };

  const reasons = [msg('rRevenueAssumptions', [], 'Sales band plus the waterfall assumptions')];

  const derived = revenue?.settings?.regionalDerivedFrom?.ok === true;
  reasons.push(derived
    ? msg('rRegionalMeasured', [], 'Audience mix read from review languages, not assumed')
    : msg('rRegionalAssumed', [], 'Audience mix is a default; the regional factor spans 0.60 to 0.88'));

  return { level: unitsConfidence.level, reasons };
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
    // Absence and staleness are different facts, and the caption must not
    // report one as the other.
    if (wishlists.said) {
      note(1, 'rWishlistSaidStale', [wishlists.said.announcedAt],
        `The figure the developer published dates from ${wishlists.said.announcedAt}, so the ranking carries most of the estimate`);
    } else {
      note(1, 'rWishlistRankCurve', [],
        "No published figure for this game, so the estimate is read from its place in Steam's wishlist ranking");
    }
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
 * Unit confidence.
 *
 * Two questions, and nothing else:
 *
 *   1. How many independent methods answered, do their bands admit a common
 *      figure, and does either cross-check object? This is the only dimension
 *      with a published reason to predict accuracy — GAMALYTIC_METHOD_2023
 *      puts the adjusted multiple alone at 50.4% of games within 30% error and
 *      a weighted ensemble at 76.9% — and it is the dimension the fixtures
 *      cannot test, because a frozen snapshot carries no owner band.
 *      Unvalidated, and labelled as such in docs/METHODOLOGY.md rather than
 *      quietly assumed.
 *   2. Is this the kind of game the multiple's sources measured? Both edges of
 *      CONFIDENCE.measuredRange are published: Gamalytic excluded games under
 *      1,000 copies from the benchmark, and nobody publishes a median for
 *      games with hundreds of thousands of reviews.
 *
 * Band width is not one of the questions any more. It was, as a ceiling, and
 * over the 62 fixtures it is the only rule that ever fired: the 16 games it
 * condemned land within 30% error less often (31.3% against 50.0%, p = 0.25)
 * but have the truth inside their band MORE often (68.8% against 54.3%,
 * p = 0.39). A rule that grades a band down for being wide, on a product whose
 * whole promise is the band, was pointing the wrong way. See
 * OURS_CONFIDENCE_CHECK and CONFIDENCE.measuredRange.
 *
 * Says nothing about the game itself. Reasons come back worst first.
 *
 * @param {object} combined output of combineEstimators
 * @param {object} flags    lowSample, ownersMissing, ownersUntrusted,
 *                          ccuDisagrees, playtimeDisagrees, and `reviews` —
 *                          the sample the multiple was applied to, which
 *                          `measuredRange` needs and `combined` does not carry
 */
export function scoreConfidence(combined, flags = {}) {
  if (!combined?.ok) {
    return { level: 'none', spread: null, reasons: [msg('rNoEstimate', [], 'No usable estimate')] };
  }

  const { lo, mid, hi } = combined.range;
  const spread = hi / Math.max(lo, 1);
  const found = [];

  // Reads the evidence only: how many methods answered, whether they agree,
  // whether a cross-check objects, and whether the sources ever measured a
  // game like this one.
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

  // Two tiers, and both of them now cost something. Past the alarm gap the
  // methods contradict each other and the level goes to the bottom; short of
  // it they still admit no common figure, which is a near miss and worth one
  // step.
  //
  // The step is new. It used to be reported and not charged, on the grounds
  // that the widening had already paid for it — but the thing that read the
  // widening was the width ceiling, and with the ceiling gone the near miss
  // was free. Two bands with no figure between them then graded `good`
  // whenever the envelope happened to stay under 3.5x, which contradicted the
  // scale this file's own documentation publishes.
  if (combined.widened) {
    const alarming = combined.gap > ENSEMBLE.alarmGap;
    note(alarming ? 2 : 1, 'rNoCommonFigure', [combined.gap.toFixed(1)],
      `No figure fits every method; the nearest bands are ${combined.gap.toFixed(1)}x apart`);
    if (alarming) level = 'low';
    else downgrade();
  }
  // Reported, not charged for. A game under 200 reviews already had its band
  // widened by x0.75 and x1.4, and over the fixtures that widening is if
  // anything too generous — the truth lands inside the widened band 68.8% of
  // the time against 54.3% for thicker samples — so a grade docked here bills
  // the same uncertainty twice and bills it against the evidence.
  if (flags.lowSample) {
    note(1, 'rFewReviews', [], 'Few reviews, so the band is widened');
  }
  if (flags.ccuDisagrees) {
    note(1, 'rCcuDisagree', [], 'Player-count cross-check implies a larger launch than the review estimate');
    downgrade();
  }
  if (flags.playtimeDisagrees) {
    note(1, 'rPlaytimeDisagree', [], 'Player-hours imply a figure outside this band, on an average playtime nobody publishes');
    downgrade();
  }

  // Outside the range the multiple's own sources measured, applied last so
  // nothing can talk its way past it. Both edges are the sources' own, and
  // this is the one rule here that the fixtures can check: the four games
  // above `maxReviews` are Valheim, Stardew Valley, Rust and Garry's Mod, and
  // on three of them the disclosed figure falls below the entire band.
  const { minUnits, maxReviews } = CONFIDENCE.measuredRange;
  if (Number.isFinite(flags.reviews) && flags.reviews > maxReviews) {
    note(2, 'rBeyondMeasured', [compact(maxReviews)],
      `Larger than any game the sales-per-review ratio has a published median for; above about ${compact(maxReviews)} reviews it is known to fall and the decline is not modelled`);
    level = 'low';
  } else if (Number.isFinite(mid) && mid < minUnits) {
    note(2, 'rBelowMeasured', [compact(minUnits)],
      `Under ${compact(minUnits)} copies, which the benchmark behind this method excluded, so its published accuracy does not cover a game this small`);
    level = 'low';
  }

  // Only when nothing has been charged for.
  if (level === 'good' && !found.some((r) => r.severity > 0)) {
    note(0, 'rAgree', [], 'Sources agree within the expected band');
  }

  // Width is context and goes last, because it is never a level. The band is
  // already on screen; naming it here tells the reader what they are looking
  // at without pretending the number measures how much to trust the figure.
  note(0, 'rBandSpans', [spread.toFixed(1)], `Band spans ${spread.toFixed(1)}x`);

  // Stable sort by severity: the reason that set the level leads.
  const reasons = found
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => b.severity - a.severity || a.i - b.i)
    // Severity travels with the reason so the interface can emphasise alarms.
    .map(({ key, params, text, severity }) => ({ key, params, text, severity }));

  return { level, spread, reasons };
}
