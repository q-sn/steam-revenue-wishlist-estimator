import { ENSEMBLE, CONFIDENCE } from './constants.js';

/**
 * User-facing strings leave the core as message descriptors, never as finished
 * sentences. `text` carries the English wording so Node tooling and tests stay
 * readable; the overlay resolves `key` through chrome.i18n instead.
 */
function msg(key, params, text) {
  return { key, params, text };
}

/**
 * Combining estimators.
 *
 * The published benchmark that motivated this whole project found that no
 * single method beats a combination: a flat review multiple lands within 30%
 * on 42.7% of games, adjusted multiples on 50.4%, and an ensemble on 76.9%.
 * We cannot run the profile-polling leg of that ensemble from a browser, and
 * of the three that are reachable only two have inputs we can specify: the
 * adjusted review multiple and the SteamSpy owner band. Combining those two
 * still beats either alone. Player-hours over playtime measures the same
 * quantity and is kept outside the average, because its divisor is an average
 * playtime nothing public reports — see PLAYTIME.
 *
 * Two rules keep this honest:
 *
 *  1. Only estimators of the same quantity are averaged, and only when their
 *     inputs can be specified. The peak-CCU rule fails the first test and the
 *     player-hours route fails the second; both stay cross-checks that can
 *     widen a band and lower confidence without moving a midpoint.
 *
 *  2. Disagreement is never averaged away. When estimators diverge the band
 *     grows to cover both and the confidence drops, so the reader sees the
 *     uncertainty instead of a tidy midpoint that hides it.
 */

/**
 * Weighted geometric mean. Sales estimates are multiplicative quantities with
 * a roughly log-normal spread, so averaging in log space avoids the upward
 * bias an arithmetic mean would introduce.
 */
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
 * Nothing here is specific to units. Wishlists reach it too, through the same
 * two rules: the follower ratio and the store's wishlist ranking estimate the
 * same quantity from different signals, so they may be combined, and when
 * they leave no figure both admit the band grows to cover the disagreement.
 *
 * @param {Array<{method:string, range:{lo:number,mid:number,hi:number}, weight:number, label:string}>} estimators
 */
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

  // Do the bands share any figure at all? Every estimator here reports an
  // interval, so this is the question that decides whether they conflict.
  const highestLow = Math.max(...usable.map((e) => e.range.lo));
  const lowestHigh = Math.min(...usable.map((e) => e.range.hi));
  const overlaps = highestLow <= lowestHigh;
  // How far apart the nearest edges are, once nothing is admitted by all.
  const gap = overlaps ? 1 : highestLow / Math.max(lowestHigh, 1);

  // Kept for the record and for display: how far the point estimates sit
  // apart. It is not what decides anything, because on a source that answers
  // in buckets a midpoint is the centre of a bucket rather than a reading.
  const disagreement = Math.max(...mids) / Math.max(Math.min(...mids), 1);

  // Only widen when no figure satisfies every method. Then the average is
  // genuinely hiding something and the band has to cover what it is hiding.
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
 * One step down the scale, floored at 'low'.
 *
 * 'none' means there is no estimate to talk about. Letting a downgrade reach
 * it would turn "we are not confident in this number" into "there is no
 * number", which are different statements and only one of them is true.
 */
const WORST_SCORED = 'low';
function downgraded(level) {
  if (level === 'none') return 'none';
  const i = LEVEL_ORDER.indexOf(level);
  if (i < 0) return WORST_SCORED;
  return LEVEL_ORDER[Math.min(i + 1, LEVEL_ORDER.indexOf(WORST_SCORED))];
}


/**
 * Revenue confidence.
 *
 * Revenue is the unit band pushed through the waterfall, so it can never be
 * better than the units it came from — and it is meaningfully worse, because
 * every step of that waterfall is an assumption with a real range of its own.
 * The regional factor alone spans 0.60 to 0.88 depending on where a game's
 * buyers are. One step down is the honest floor.
 *
 * Those ranges widen the band as well as this verdict, so the two say the
 * same thing: the width on screen carries the same uncertainty this word
 * does, rather than the word being marked down for uncertainty the band
 * never shows.
 */
export function scoreRevenueConfidence(unitsConfidence, ok, revenue = null) {
  if (!ok) return { level: 'none', reasons: [msg('rNoEstimate', [], 'No usable estimate')] };

  const reasons = [msg('rRevenueAssumptions', [], 'Sales band plus the waterfall assumptions')];
  let level = downgraded(unitsConfidence.level);

  // One fact of its own, and it is the one that varies: was the regional
  // factor read off the game's review languages, or is it the fallback nobody
  // chose? That factor swings the answer from 0.60 to 0.88 of list price,
  // which is the widest single assumption in the chain, so knowing it from
  // data rather than defaulting is worth a step.
  //
  // Without this the verdict is `downgraded(units)` and nothing else, and
  // with the top of the units scale out of reach that makes this function a
  // constant: every paid game on Steam reading "unreliable", forever, which
  // is a label rather than a rating.
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
 * Wishlist confidence, scored on its own terms.
 *
 * Nothing about the sales estimate speaks to this number: it comes from a
 * different signal entirely, and it exists on pages where there is no sales
 * estimate at all.
 *
 * Two legs answer it — the follower ratio and the store's wishlist ranking —
 * so the same questions the units scale asks apply here: how many methods
 * answered, whether they agree, and whether anything contradicts them
 * outright.
 *
 * No downgrade for an unknown promotion history. It is unknown on every game
 * — nothing on a store page reveals it — so a penalty applied every time is
 * not a penalty, just a quieter baseline that says nothing.
 */
export function scoreWishlistConfidence(wishlists) {
  if (!wishlists?.ok) return { level: 'none', reasons: [msg('rNoEstimate', [], 'No usable estimate')] };

  const found = [];
  const note = (severity, key, params, text) => found.push({ severity, key, params, text });
  let level = 'good';
  const downgrade = () => { level = level === 'good' ? 'fair' : 'low'; };

  const legs = wishlists.contributors?.length ?? 1;
  if (legs > 1) {
    note(0, 'rMethodsCombined', [String(legs)], `${legs} independent methods combined`);
  } else {
    // Which leg is missing matters. "Not in the ranking" is a fact about the
    // game that bounds the answer; "the ranking has not been downloaded" is a
    // fact about this extension and bounds nothing.
    if (wishlists.rank) {
      note(1, 'rWishlistRankOnly', [],
        'No readable follower count, so the store ranking is the only method');
    } else if (wishlists.rankReason === 'below-list') {
      note(1, 'rWishlistBelowList', [],
        "Below Steam's wishlist ranking entirely, so only the follower ratio answers");
    } else {
      note(1, 'rWishlistRankPending', [],
        'The wishlist ranking is not available, so there is no second method');
    }
    downgrade();
  }

  // Two legs that leave no figure both admit. Same two tiers as the units
  // scale: a gap inside the alarm threshold is reported, one beyond it decides
  // the verdict.
  if (wishlists.widened) {
    const alarming = wishlists.gap > ENSEMBLE.alarmGap;
    note(alarming ? 2 : 1, 'rNoCommonFigure', [wishlists.gap.toFixed(1)],
      `No figure fits every method; the nearest bands are ${wishlists.gap.toFixed(1)}x apart`);
    if (alarming) level = 'low';
  }

  // A bound broken is not a wide band, it is a contradiction: the follower
  // ratio claims more wishlists than the last game on a list this one did not
  // make. One of the two inputs is wrong and neither can be repaired here.
  if (wishlists.ceilingBreached) {
    note(2, 'rWishlistCeiling', [],
      "Follower ratio implies more wishlists than the bottom of a ranking this game is not on");
    level = 'low';
  }

  // What differs between games on the follower leg is whether the midpoint is
  // a figure the survey measured for this kind of game or the median across
  // every kind. A tag the survey covers is real information; the all-games
  // median is the answer for a game we can say nothing specific about.
  if (wishlists.genre) {
    note(0, 'rWishlistGenre', [wishlists.genre.label],
      `Genre multiplier for ${wishlists.genre.label}, within the survey's 7x to 20x range`);
  } else if (wishlists.followerRange) {
    note(1, 'rFollowerRatio', [], 'All-games median multiplier; the follower ratio spans 7x to 20x');
    downgrade();
  }

  // Reported, not charged for. Not knowing how far into its accumulation a
  // game is already widened the band by the full published span a few steps
  // back, and marking the level down as well would count one fact twice.
  if (wishlists.rank && !wishlists.rank.accumulation.ok) {
    note(1, 'rWishlistAccumulation', [],
      'No readable release date, so how far this game is into its wishlist accumulation is unknown');
  }

  const { lo, hi } = wishlists.range;
  const spread = hi / Math.max(lo, 1);
  if (spread > CONFIDENCE.fair) {
    note(2, 'rBandSpans', [spread.toFixed(1)], `Band spans ${spread.toFixed(1)}x`);
    level = 'low';
  } else if (spread > CONFIDENCE.good) {
    note(0, 'rBandSpans', [spread.toFixed(1)], `Band spans ${spread.toFixed(1)}x`);
  }

  const reasons = found
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => b.severity - a.severity || a.i - b.i)
    .map(({ key, params, text, severity }) => ({ key, params, text, severity }));

  return { level, spread, reasons };
}

/**
 * Confidence reflects how wide the band is and how well the signals agree.
 * It says nothing about the game itself.
 *
 * Reasons come back sorted by severity, worst first. The overlay shows the
 * leading one next to the dot, so whatever made the dot change colour has to
 * be the thing the reader sees — an alarming dot beside a reassuring sentence
 * is worse than no dot at all.
 */
export function scoreConfidence(combined, flags = {}) {
  if (!combined?.ok) {
    return { level: 'none', spread: null, reasons: [msg('rNoEstimate', [], 'No usable estimate')] };
  }

  const { lo, hi } = combined.range;
  const spread = hi / Math.max(lo, 1);
  const found = [];

  /**
   * The level starts from the evidence, not from the width of the band.
   *
   * Width does not vary. Every band here is dominated by a fixed published
   * range — the review multiplier spans 20-55x on its own — so a combination
   * of two overlapping bands lands between 2.2x and 2.7x on almost every game
   * in the store. Measured across 22 real games the spreads are bimodal:
   * eighteen inside that sliver, four above 7x, nothing between. Reading the
   * level off that quantity gives `good` to nobody, and makes the revenue
   * verdict — one step below units — a constant that says "unreliable" on
   * every paid game ever released.
   *
   * What does vary, and what a reader can act on: how many independent
   * methods contributed, whether they agree, whether the review sample is
   * thick enough to mean anything, and whether a cross-check objects.
   *
   * Width has a say, but as a ceiling rather than the driver: a band
   * wider than the `fair` threshold cannot be called anything but low, however
   * good the evidence behind it looks. The band itself is on screen, so the
   * word is free to describe confidence *in* that band rather than restating
   * how wide it is.
   */
  let level = 'good';

  // 2 = this is why the level dropped, 1 = caution, 0 = context.
  const note = (severity, key, params, text) => found.push({ severity, key, params, text });
  const downgrade = () => { level = level === 'good' ? 'fair' : 'low'; };

  if (combined.contributors.length > 1) {
    note(0, 'rMethodsCombined', [String(combined.contributors.length)],
      `${combined.contributors.length} independent methods combined`);
  } else {
    // Caps at fair rather than dropping to low. Having one source is the
    // normal case for unreleased games and small titles; red should mean
    // something is wrong, not merely that a second opinion was unavailable.
    //
    // And it says which kind of unavailable, because they are not the same
    // problem and only one of them is about the game. "SteamSpy has never
    // processed this app" is a fact about SteamSpy; "the owner band is too
    // small to trust" is a fact about the game's size; a bare "single method"
    // left the reader unable to tell those apart, or to tell either from a
    // request that simply failed.
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

  // Two tiers, because "these two methods are 1.9x apart" and "these two
  // methods are 4x apart" are different findings. The first means one of them
  // is outside its published 30% error; the second means one is outside 50%,
  // which the published methods almost never are.
  // Below the alarm tier this only reports; it does not also mark the level
  // down. Widening the band is *how* a conflict shows up, and the spread was
  // measured on the widened band a few lines above — so charging for it again
  // counted one fact twice, which is what kept dropping healthy estimates to
  // the bottom of the scale.
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

  // The width ceiling, applied last so nothing can talk its way past it. A
  // band this wide is not something to be confident about no matter how many
  // methods produced it.
  if (spread > CONFIDENCE.fair) {
    note(2, 'rBandSpans', [spread.toFixed(1)], `Band spans ${spread.toFixed(1)}x`);
    level = 'low';
  } else if (spread > CONFIDENCE.good) {
    note(0, 'rBandSpans', [spread.toFixed(1)], `Band spans ${spread.toFixed(1)}x`);
  }

  // Only when nothing else has been said. With two methods the "N methods
  // combined" line already carries this, and printing both puts two sentences
  // that mean the same thing beside one figure.
  if (level === 'good' && !found.length) {
    note(0, 'rAgree', [], 'Sources agree within the expected band');
  }

  // Stable sort by severity: the reason that set the level leads.
  const reasons = found
    .map((r, i) => ({ ...r, i }))
    .sort((a, b) => b.severity - a.severity || a.i - b.i)
    // Severity travels with the reason: the interface emphasises the number
    // only when that number is the cause of an alarm, not when it is merely
    // describing the shape of a healthy estimate.
    .map(({ key, params, text, severity }) => ({ key, params, text, severity }));

  return { level, spread, reasons };
}
