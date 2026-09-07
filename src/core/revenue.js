import {
  REVENUE_DEFAULTS, REGIONAL_PROFILES, REGIONAL_ORDER, REVENUE_UNCERTAINTY,
  LANGUAGE_REGIONS, STEAM_TIERS
} from './constants.js';

/**
 * Valve's royalty, marginal and per app. Takes adjusted gross — i.e. after
 * VAT, refunds and chargebacks — not the sticker price.
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
 * Resolve the settings a waterfall runs on. `regionalProfile: 'auto'` reads
 * the profile off the language mix; an explicit choice wins.
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
    // Both survive a second pass over already-resolved settings, after the
    // envelope has pinned `regionalProfile` to a concrete key.
    regionalAuto: merged.regionalAuto ?? merged.regionalProfile === 'auto',
    regionalDerivedFrom: derivedFrom ?? merged.regionalDerivedFrom ?? null
  };
}

/**
 * Turn a unit count into money, returning every deduction step as well as the
 * total. `listPrice` must be the list price, not today's price: a sale price
 * double-counts the discount against the average-discount step below it.
 */
export function estimateRevenue(units, listPrice, settingsIn = {}, context = {}) {
  // Idempotent: everything producing settings pins a concrete
  // `regionalProfile`, so a second resolve cannot re-derive it.
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
    /**
     * What buyers actually paid, which is the figure a developer calls gross.
     *
     * It is neither end of the waterfall. `listGross` is a sticker price
     * nobody pays worldwide, and `adjustedGross` has already lost refunds. The
     * useful line is between them: list, less the discounts copies really sold
     * at, at the prices the game's regions really charge.
     *
     * Developers who publish both figures confirm the refund and royalty legs
     * exactly: Tiny Terraces said $26,790 gross and $17,363 net, which
     * back-solves to $26,522 here, inside 1%.
     *
     * They do not confirm the regional leg, and a previous version of this
     * comment claimed they did. It read The Ember Guardian's $16.55 on a
     * $19.99 list and TetherGeist's $11.33 on a $16.99 list as the same 0.83
     * of list after their discounts. Only the second is: TetherGeist's is
     * 0.834 of the $13.59 its 20% launch discount actually charged, while The
     * Ember Guardian ran 10% off for the two weeks its figure covers, making
     * its ratio 0.920 of the $17.99 charged — above every profile here. The
     * discount had been folded into the regional factor and the result then
     * read as evidence about the regional factor.
     *
     * Across the games where the discount is known exactly the regional
     * residual runs 0.73 to 0.92, wider than anything else in the chain.
     *
     * Steamworks names its own lines differently — its "Gross Steam Sales"
     * still carries VAT, which `regionalFactor` has already removed — so this
     * matches what developers say rather than what Valve's report prints.
     */
    gross: afterRegional,
    grossPerUnit: units > 0 ? afterRegional / units : 0,
    adjustedGross: afterRefunds,
    royalty,
    net,
    netPerUnit: units > 0 ? net / units : 0,
    // Fraction of list gross kept. Around 0.40 on the shipped defaults, 0.45
    // for a US/EU audience — the two scenarios in IMMUTABLE_NET_2026. Near
    // 0.70 means a deduction was skipped.
    takeHomeRatio: listGross > 0 ? net / listGross : 0,
    settings: s
  };
}

/**
 * The waterfall's own uncertainty, as a pessimistic and an optimistic variant
 * of the resolved settings.
 *
 * Spans are carried as offsets from the published figures, so a moved slider
 * keeps its own midpoint and still gets the published width around it. On the
 * defaults they land on the sourced 10-30% discount and 6-13% refund ranges.
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
      // Pinned rather than left on 'auto', so a second resolve is a no-op.
      regionalProfile: key,
      regionalKey: key,
      regionalFactor: REGIONAL_PROFILES[key].factor,
      regionalLabel: REGIONAL_PROFILES[key].label
    };
  };

  // +1 moves every assumption the wrong way at once: they are correlated, not
  // independent.
  return { low: shift(1), mid: shift(0), high: shift(-1) };
}

/**
 * Apply the waterfall across a unit range and its own assumption range: low
 * units under the pessimistic waterfall, high units under the optimistic one.
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
    // Both figures walk the same envelope, so the pessimistic gross and the
    // pessimistic net describe one scenario rather than two.
    gross: { lo: lo.gross, mid: mid.gross, hi: hi.gross },
    net: { lo: lo.net, mid: mid.net, hi: hi.net },
    steps: mid.steps,
    grossPerUnit: mid.grossPerUnit,
    netPerUnit: mid.netPerUnit,
    takeHomeRatio: mid.takeHomeRatio,
    takeHomeBand: { lo: lo.takeHomeRatio, mid: mid.takeHomeRatio, hi: hi.takeHomeRatio },
    // What the band is made of, for the panel's "why this wide" note.
    envelope: {
      avgDiscount: { lo: envelope.high.avgDiscount, hi: envelope.low.avgDiscount },
      refundRate: { lo: envelope.high.refundRate, hi: envelope.low.refundRate },
      regional: { best: envelope.high.regionalKey, worst: envelope.low.regionalKey }
    },
    settings: mid.settings
  };
}
