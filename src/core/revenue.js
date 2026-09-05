import {
  REVENUE_DEFAULTS, REGIONAL_PROFILES, REGIONAL_ORDER, REVENUE_UNCERTAINTY,
  LANGUAGE_REGIONS, STEAM_TIERS
} from './constants.js';

/**
 * Valve's royalty, marginal and per app.
 *
 * The order matters and is the single most common mistake in every free Steam
 * revenue tool: the 30% is charged on adjusted gross, i.e. after VAT, refunds
 * and chargebacks — not on the sticker price.
 */
export function steamRoyalty(adjustedGross) {
  let remaining = Math.max(adjustedGross, 0);
  let previousCap = 0;
  let royalty = 0;

  for (const tier of STEAM_TIERS) {
    const bandWidth = tier.upTo - previousCap;
    const inBand = Math.min(remaining, bandWidth);
    if (inBand <= 0) break;
    royalty += inBand * tier.rate;
    remaining -= inBand;
    previousCap = tier.upTo;
  }
  return royalty;
}

/**
 * Which regional profile a game's audience looks like, from the languages its
 * reviewers write in.
 *
 * @param {{discounted:number, total:number}} mix review counts: the low-price
 *   markets from LANGUAGE_REGIONS, and every language together
 */
export function regionalFromLanguages(mix) {
  const discounted = Number(mix?.discounted);
  const total = Number(mix?.total);
  if (!Number.isFinite(discounted) || !Number.isFinite(total) || total <= 0) return null;

  if (total < LANGUAGE_REGIONS.minReviews) {
    return { ok: false, reason: 'thin-sample', total };
  }

  const share = Math.min(Math.max(discounted / total, 0), 1);
  const profile = share >= LANGUAGE_REGIONS.thresholds.emerging
    ? 'emerging'
    : share >= LANGUAGE_REGIONS.thresholds.mixed
      ? 'mixed'
      : 'us-eu';

  return { ok: true, profile, discountedShare: share, total };
}

/** Step to a neighbouring profile, clamped at both ends of the published list. */
function neighbourProfile(key, step) {
  const at = REGIONAL_ORDER.indexOf(key);
  if (at === -1) return key;
  const next = Math.min(Math.max(at + step, 0), REGIONAL_ORDER.length - 1);
  return REGIONAL_ORDER[next];
}

/**
 * Resolve the settings a waterfall runs on.
 *
 * `regionalProfile: 'auto'` means "read it off the language mix", which is the
 * default: asking someone to declare their own audience split is asking them
 * to guess, and the reviews API measures the same thing. An explicit choice
 * always wins, because a developer looking at their own game knows better
 * than a proxy does.
 */
export function resolveSettings(partial = {}, { languageMix = null } = {}) {
  const merged = { ...REVENUE_DEFAULTS, ...partial };

  let regionalKey = merged.regionalProfile;
  let derivedFrom = null;

  if (regionalKey === 'auto' || !REGIONAL_PROFILES[regionalKey]) {
    const read = regionalFromLanguages(languageMix);
    if (read?.ok) {
      regionalKey = read.profile;
      derivedFrom = read;
    } else {
      regionalKey = 'mixed';
    }
  }

  const profile = REGIONAL_PROFILES[regionalKey];
  return {
    ...merged,
    regionalFactor: profile.factor,
    regionalKey,
    regionalLabel: profile.label,
    // Both survive a second pass over already-resolved settings, so the panel
    // can still say the profile was read off the language mix even after the
    // envelope has pinned it to a concrete key.
    regionalAuto: merged.regionalAuto ?? merged.regionalProfile === 'auto',
    regionalDerivedFrom: derivedFrom ?? merged.regionalDerivedFrom ?? null
  };
}

/**
 * Turn a unit count into money, one deduction at a time.
 *
 * Returns the whole waterfall rather than just the total, because the steps
 * are the useful part: most developers are surprised by which line hurts most,
 * and a single "net revenue" figure hides that entirely.
 *
 * `listPrice` is the list price, not the price on the page today. Feeding it
 * a sale price double-counts the discount, once in the price and again in the
 * average-discount step below it.
 */
export function estimateRevenue(units, listPrice, settingsIn = {}, context = {}) {
  // `resolveSettings` is idempotent: everything that produces settings pins a
  // concrete `regionalProfile`, so resolving twice cannot quietly re-derive
  // the profile from a language mix this call was never given.
  const s = resolveSettings(settingsIn, context);

  if (!Number.isFinite(units) || !Number.isFinite(listPrice) || listPrice <= 0) {
    return { ok: false, reason: 'no-price' };
  }

  const listGross = units * listPrice;
  const afterDiscount = listGross * (1 - s.avgDiscount);
  const afterRegional = afterDiscount * s.regionalFactor;
  const afterRefunds = afterRegional * (1 - s.refundRate);
  const royalty = steamRoyalty(afterRefunds);
  const net = afterRefunds - royalty;

  const pctOf = (v, digits = 0) => (v * 100).toFixed(digits);

  const steps = [
    {
      key: 'list',
      labelKey: 'wfList', labelParams: [],
      label: 'Units at list price',
      value: listGross, delta: 0
    },
    {
      key: 'discount',
      labelKey: 'wfDiscount', labelParams: [pctOf(s.avgDiscount)],
      label: `Average lifetime discount (${pctOf(s.avgDiscount)}%)`,
      value: afterDiscount, delta: afterDiscount - listGross
    },
    {
      key: 'regional',
      labelKey: 'wfRegional', labelParams: [s.regionalKey],
      label: `Regional pricing and VAT (${s.regionalLabel})`,
      value: afterRegional, delta: afterRegional - afterDiscount
    },
    {
      key: 'refunds',
      labelKey: 'wfRefunds', labelParams: [pctOf(s.refundRate, 1)],
      label: `Refunds (${pctOf(s.refundRate, 1)}%)`,
      value: afterRefunds, delta: afterRefunds - afterRegional
    },
    {
      key: 'royalty',
      labelKey: 'wfRoyalty', labelParams: [],
      label: 'Valve royalty (30/25/20, tiered)',
      value: net, delta: -royalty
    }
  ];

  return {
    ok: true,
    steps,
    adjustedGross: afterRefunds,
    royalty,
    net,
    netPerUnit: units > 0 ? net / units : 0,
    // Around 0.40 on the shipped defaults and 0.45 for a US/EU-weighted
    // audience, which are the two scenarios IMMUTABLE_NET_2026 works through.
    // Drifting toward 0.70 means a deduction was skipped somewhere.
    takeHomeRatio: listGross > 0 ? net / listGross : 0,
    settings: s
  };
}

/**
 * The waterfall's own uncertainty, as a pessimistic and an optimistic variant
 * of the resolved settings.
 *
 * The sliders on the options page say where the midpoint of each assumption
 * sits. They do not make it certain, and until this existed the revenue band
 * was the unit band wearing a different unit — exactly as wide as the sales
 * estimate, when it rests on that estimate plus a chain of assumptions with
 * ranges of their own.
 *
 * The spans are anchored on the published figures and carried as offsets from
 * them, so a developer who moves a slider keeps their own midpoint and still
 * gets the published width around it. On the defaults these land exactly on
 * the sourced 10-30% discount and 6-13% refund ranges.
 */
export function waterfallEnvelope(settings) {
  const dSpan = (REVENUE_UNCERTAINTY.avgDiscount.hi - REVENUE_UNCERTAINTY.avgDiscount.lo) / 2;
  const rSpan = (REVENUE_UNCERTAINTY.refundRate.hi - REVENUE_UNCERTAINTY.refundRate.lo) / 2;
  const step = REVENUE_UNCERTAINTY.regionalNeighbourStep;

  const shift = (direction) => {
    const key = neighbourProfile(settings.regionalKey, direction * step);
    return {
      ...settings,
      avgDiscount: Math.min(Math.max(settings.avgDiscount + direction * dSpan, 0), 0.9),
      refundRate: Math.min(Math.max(settings.refundRate + direction * rSpan, 0), 0.5),
      // Pinned, not left on 'auto', so resolving these settings again is a
      // no-op rather than a second read of the language mix.
      regionalProfile: key,
      regionalKey: key,
      regionalFactor: REGIONAL_PROFILES[key].factor,
      regionalLabel: REGIONAL_PROFILES[key].label
    };
  };

  // +1 walks every assumption the wrong way at once, which is the honest read
  // of a low end: these are correlated, not independent. A game selling
  // heavily into low-price markets discounts harder and refunds more.
  return { low: shift(1), mid: shift(0), high: shift(-1) };
}

/**
 * Apply the waterfall across a unit range and its own assumption range.
 *
 * The low end is the low unit count under the pessimistic waterfall and the
 * high end is the high count under the optimistic one, so the band the reader
 * sees covers both sources of doubt rather than just the one that happens to
 * be easier to compute.
 */
export function estimateRevenueRange(unitRange, listPrice, settingsIn = {}, context = {}) {
  if (!unitRange) return { ok: false, reason: 'no-units' };

  const settings = resolveSettings(settingsIn, context);
  const envelope = waterfallEnvelope(settings);

  const mid = estimateRevenue(unitRange.mid, listPrice, envelope.mid);
  if (!mid.ok) return mid;

  const lo = estimateRevenue(unitRange.lo, listPrice, envelope.low);
  const hi = estimateRevenue(unitRange.hi, listPrice, envelope.high);

  return {
    ok: true,
    net: { lo: lo.net, mid: mid.net, hi: hi.net },
    steps: mid.steps,
    netPerUnit: mid.netPerUnit,
    takeHomeRatio: mid.takeHomeRatio,
    takeHomeBand: { lo: lo.takeHomeRatio, mid: mid.takeHomeRatio, hi: hi.takeHomeRatio },
    // What the band is made of, so the panel can say why it is this wide
    // instead of leaving the reader to assume it came from the sales estimate.
    envelope: {
      avgDiscount: { lo: envelope.high.avgDiscount, hi: envelope.low.avgDiscount },
      refundRate: { lo: envelope.high.refundRate, hi: envelope.low.refundRate },
      regional: { best: envelope.high.regionalKey, worst: envelope.low.regionalKey }
    },
    settings: mid.settings
  };
}
