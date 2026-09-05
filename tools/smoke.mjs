#!/usr/bin/env node
/** Offline sanity checks. No network. Run before every commit. */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  pillFigures, PILL_DEFAULTS,
  estimateAll, estimateRevenue, estimateRevenueRange, steamRoyalty,
  parseOwnersBand, parseAllTimePeak, parseChartsStats, parseMonthlyHistory,
  parseRecentTrend, parseReviewSummary, allTimePeakMonth, medianHours,
  unitsFromOwners, unitsFromPlaytime, combineEstimators, precisionWeight, collectAdjustments,
  regionalFromLanguages, wishlistMultiplierFor,
  wishlistsFromRank, curveAt, wishlistsFromAnnouncement,
  makeSnapshot, appendSnapshot, diffSince, sparklinePoints,
  WISHLIST, WISHLIST_RANK, WISHLIST_CURVE, CCU, OWNERS_TO_UNITS, PLAYTIME, REGIONAL_PROFILES, REGIONAL_ORDER, REFUNDS, HISTORY,
  CONFIDENCE, ENSEMBLE, APP_TYPES, REVIEW_GATES, scoreConfidence
} from '../src/core/index.js';
import { compact, money, setLocale } from '../src/core/format.js';
import { comparableScopes } from '../src/content/scrape.js';

setLocale('en');

let failures = 0;
const LEVELS = ['good', 'fair', 'low', 'none'];
const group = (name) => console.log(`\n  ${name}\n`);
const check = (name, condition, detail = '') => {
  const ok = Boolean(condition);
  if (!ok) failures++;
  console.log(`  ${ok ? '\u2713' : '\u2717'} ${name}${detail ? `  ${detail}` : ''}`);
};

group('Core estimators');

// A plausible mid-size indie: released 2023, $24.99, 2400 reviews, 92% positive.
const indie = estimateAll({
  appId: 1, name: 'Test Indie', reviews: 2400, positivePct: 92,
  price: 24.99, discountPct: 0, isFree: false, released: true,
  releaseYear: 2023, tags: ['Roguelike', 'Indie']
});

check('units estimated', indie.units.ok);
check('band is ordered',
  indie.units.range.lo < indie.units.range.mid && indie.units.range.mid < indie.units.range.hi,
  `${compact(indie.units.range.lo)} \u2013 ${compact(indie.units.range.mid)} \u2013 ${compact(indie.units.range.hi)}`);
check('multiplier lands in the published 20-55x band for 2023',
  indie.units.boxleiter.multiplier.mid >= 18 && indie.units.boxleiter.multiplier.mid <= 58,
  `${indie.units.boxleiter.multiplier.mid.toFixed(1)}x`);
check('revenue computed', indie.revenue.ok, money(indie.revenue.net.mid));
// The bounds are the two worked scenarios in the source behind the waterfall,
// not a loose sanity window: 39.5% for a mixed audience and 45.3% for a
// US/EU-weighted one. Anything outside means a deduction changed.
check('take-home lands between the two published scenarios',
  indie.revenue.takeHomeRatio > 0.35 && indie.revenue.takeHomeRatio < 0.46,
  `${(indie.revenue.takeHomeRatio * 100).toFixed(1)}% of list`);
check('confidence scored', ['good', 'fair', 'low'].includes(indie.confidence.level), indie.confidence.level);

group('Gating');

const tiny = estimateAll({ appId: 2, reviews: 9, price: 9.99, released: true, releaseYear: 2025 });
check('refuses a number under 10 reviews', !tiny.units.ok && tiny.units.reason === 'too-few-reviews');

// The floor sits where Steam's own scoring does, so the first scored review
// count has to be the first estimated one.
const atGate = estimateAll({ appId: 2, reviews: 11, price: 9.99, released: true, releaseYear: 2025 });
check('estimates at the gate itself', atGate.units.ok,
  `${compact(atGate.units.range.lo)} \u2013 ${compact(atGate.units.range.hi)}`);
check('a sample that thin is called unreliable', atGate.confidence.units.level !== 'good',
  `${atGate.confidence.units.level}, band ${(atGate.units.range.hi / atGate.units.range.lo).toFixed(1)}x wide`);
check('the thin sample is named as the reason',
  (atGate.confidence.units.reasons ?? []).some((r) => r.key === 'rFewReviews'));

const f2p = estimateAll({ appId: 3, reviews: 5000, price: 0, isFree: true, released: true, releaseYear: 2024 });
check('free-to-play skips the revenue waterfall', !f2p.revenue.ok && f2p.revenue.reason === 'free-to-play');
check('free-to-play doubles the review multiplier',
  f2p.units.boxleiter.applied.some((a) => a.label === 'Free to play'));

group('Steam royalty tiers');

check('flat 30% below $10M', Math.abs(steamRoyalty(1_000_000) - 300_000) < 1);
check('marginal at $20M',
  Math.abs(steamRoyalty(20_000_000) - (10_000_000 * 0.3 + 10_000_000 * 0.25)) < 1);
check('marginal at $100M',
  Math.abs(steamRoyalty(100_000_000) - (10_000_000 * 0.3 + 40_000_000 * 0.25 + 50_000_000 * 0.2)) < 1);
check('royalty is charged after deductions, not on list price', (() => {
  const r = estimateRevenue(100_000, 20);
  return r.royalty < 100_000 * 20 * 0.3;
})(), 'royalty < 30% of list gross');

group('Owner bands');

const band = parseOwnersBand('1,000,000 .. 2,000,000');
check('SteamSpy owner string parsed', band?.lo === 1_000_000 && band?.hi === 2_000_000);
check('owners are discounted toward paid units',
  unitsFromOwners(band).range.hi < band.hi, 'free keys and bundles removed');
check('tiny owner bands carry zero weight',
  unitsFromOwners({ lo: 0, hi: 20_000 }).weight === 0,
  'sample too thin after the 2018 privacy change');

// The share to remove is measured from how reviewers got the game, not
// guessed from whether a bundle widget happens to be on the page today.
const keyHeavy = unitsFromOwners(band, { steamPurchaseShare: 0.6 });
const keyLight = unitsFromOwners(band, { steamPurchaseShare: 0.95 });
check('a low Steam-purchase share discounts harder',
  keyHeavy.range.mid < keyLight.range.mid,
  `${compact(keyHeavy.range.mid)} vs ${compact(keyLight.range.mid)}`);
check('the measured share is reported as measured',
  keyHeavy.keyShareMeasured && !unitsFromOwners(band).keyShareMeasured);
check('an implausible share is clamped, not trusted',
  unitsFromOwners(band, { steamPurchaseShare: 0.01 }).keyShareFactor === OWNERS_TO_UNITS.floor
  && unitsFromOwners(band, { steamPurchaseShare: 1 }).keyShareFactor === OWNERS_TO_UNITS.ceiling,
  'reviewers are not a random sample of owners');

group('Ensemble');

const agree = combineEstimators([
  { method: 'a', label: 'A', range: { lo: 90, mid: 100, hi: 110 }, weight: 1 },
  { method: 'b', label: 'B', range: { lo: 95, mid: 105, hi: 115 }, weight: 1 }
]);
check('agreeing methods produce a tight band', !agree.widened, `${agree.disagreement.toFixed(2)}x apart`);

const clash = combineEstimators([
  { method: 'a', label: 'A', range: { lo: 80, mid: 100, hi: 120 }, weight: 1 },
  { method: 'b', label: 'B', range: { lo: 400, mid: 500, hi: 600 }, weight: 1 }
]);
check('disagreement widens the band instead of hiding it', clash.widened);
check('widened band covers both methods', clash.range.lo <= 80 && clash.range.hi >= 600,
  `${compact(clash.range.lo)}\u2013${compact(clash.range.hi)}`);
check('geometric mean avoids the arithmetic upward bias',
  clash.range.mid < 300, `mid ${clash.range.mid.toFixed(0)} vs arithmetic 300`);

const combined = estimateAll({
  appId: 6, reviews: 3000, positivePct: 88, price: 19.99, released: true,
  releaseYear: 2022, owners: '500,000 .. 1,000,000'
});
check('two methods actually combine', combined.units.contributors.length === 2);
check('weights sum to one',
  Math.abs(combined.units.contributors.reduce((a, c) => a + c.share, 0) - 1) < 1e-9);
check('the reason that set the level leads',
  combined.confidence.level !== 'low' ||
  combined.confidence.reasons[0].key === 'rNoCommonFigure',
  `${combined.confidence.level}: "${combined.confidence.reasons[0].text}"`);
check('supporting context is kept, not dropped',
  combined.confidence.reasons.some((r) => r.key === 'rMethodsCombined'));

group('Wishlists');

const unreleased = estimateAll({
  appId: 4, reviews: null, price: 19.99, released: false,
  releaseYear: 2026, followers: 4200, festivalContext: 'nextFest'
});
check('wishlists estimated from followers', unreleased.wishlists.ok,
  `${compact(unreleased.wishlists.range.lo)} \u2013 ${compact(unreleased.wishlists.range.hi)}`);
check('midpoint uses the festival multiplier',
  Math.abs(unreleased.wishlists.range.mid - 4200 * WISHLIST.median * WISHLIST.contexts.nextFest.factor) < 1,
  `x${(WISHLIST.median * WISHLIST.contexts.nextFest.factor).toFixed(2)}`);

// The festival breakdown was measured in 2021 against a 9.6x median; the range
// and median in use are from 2023, where it stands at 12x. Dropping the 2021
// numbers in beside the 2023 median would make a known festival *lower* the
// estimate, which is backwards — festivals raise the ratio.
const mult = (k) => WISHLIST.median * WISHLIST.contexts[k].factor;
check('knowing about a festival raises the estimate', mult('nextFest') > mult('unknown'),
  `${mult('nextFest').toFixed(2)} > ${mult('unknown').toFixed(2)}`);
check('a store feature raises it further', mult('featured') > mult('nextFest'));
check('knowing there was none lowers it', mult('none') < mult('unknown'),
  `${mult('none').toFixed(2)} < ${mult('unknown').toFixed(2)}`);
check('every multiplier stays inside the published range',
  Object.keys(WISHLIST.contexts).every((k) => mult(k) >= WISHLIST.lo && mult(k) <= WISHLIST.hi));
check('the applied context is reported back, not the requested one',
  unreleased.wishlists.contextKey === 'nextFest');
check('an unknown context falls back cleanly', (() => {
  const r = estimateAll({ appId: 8, released: false, followers: 100, festivalContext: 'bogus' });
  return r.wishlists.contextKey === 'unknown';
})(), 'caption cannot describe a multiplier the maths never used');
check('two week-one routes are produced', unreleased.weekOne.paths.length === 2);
check('their disagreement is surfaced, not averaged away',
  unreleased.weekOne.disagreement > 1,
  `${unreleased.weekOne.disagreement.toFixed(2)}x apart`);

const released = estimateAll({
  appId: 5, reviews: 800, price: 14.99, released: true, releaseYear: 2022, followers: 9000
});
check('refuses a wishlist number after release',
  !released.wishlists.ok && released.wishlists.reason === 'released');
check('but still surfaces the real follower count',
  released.wishlists.followers === 9000, 'shown as a fact, not a dash');

const releasedNoFollowers = estimateAll({
  appId: 7, reviews: 800, price: 14.99, released: true, releaseYear: 2022, followers: null
});
check('a shipped game reports shipping, not a missing follower count',
  releasedNoFollowers.wishlists.reason === 'released',
  'release state is checked first');

group('Wishlists from the store ranking');

const RANK_DAY = 24 * 60 * 60 * 1000;
const listing = { listed: 5154, upcoming: 14375, at: Date.now() };
const ranked = (rank, extra = {}) => estimateAll({
  appId: 40, released: false, followers: 4200, tags: ['Puzzle'],
  wishlistRank: rank, wishlistListing: listing, ...extra
});

// The curve is the estimator. If its exponent or level ever drifts without the
// tool that measures them being re-run, this is where it shows.
check('the curve is one expression, not a set of segments',
  WISHLIST_CURVE.b > 1 && WISHLIST_CURVE.b < 1.5 && WISHLIST_CURVE.a > 1e7 && WISHLIST_CURVE.q > 0,
  `wishlists = ${WISHLIST_CURVE.a.toLocaleString('en-US')} / (rank + ${WISHLIST_CURVE.q})^${WISHLIST_CURVE.b}`);

check('deeper ranks mean fewer wishlists', (() => {
  const ranks = [1, 20, 100, 400, 1200, 3000, 5100, 5154];
  const mids = ranks.map((r) => wishlistsFromRank(r, listing).range.mid);
  return mids.every((v, i) => i === 0 || v < mids[i - 1]);
})(), 'monotonic across the whole ordering');

check('the band is the same width everywhere inside the fitted range',
  Math.abs(
    (wishlistsFromRank(100, listing).range.hi / wishlistsFromRank(100, listing).range.lo)
    - (wishlistsFromRank(3000, listing).range.hi / wishlistsFromRank(3000, listing).range.lo)
  ) < 0.01,
  'it is this curve\'s out-of-sample error, not the spacing of somebody\'s histogram');

// The property that matters most: no boundary anywhere in it.
check('one formula answers at every position on the list', (() => {
  const every = [];
  for (let r = 1; r <= listing.listed; r++) every.push(wishlistsFromRank(r, listing));
  return every.every((v) => v.ok)
    && every.every((v) => Math.abs(v.range.mid / curveAt(v.rank) - 1) < 1e-9);
})(), `ranks 1 to ${listing.listed}, all answered by a / (rank + q)^b with nothing switching`);

check('and the band is the same width at every position', (() => {
  const wid = (r) => wishlistsFromRank(r, listing).range.hi / wishlistsFromRank(r, listing).range.lo;
  return [1, 27, 80, 500, 3000, 5154].every((r) => Math.abs(wid(r) - wid(100)) < 1e-9);
})(), 'no rank gets a widened band, because no rank is outside the fit');

// The offset is what makes that possible. Without it the same data reads
// 147 million at rank 1, because a log-log straight line has no upper bound.
check('the head of the ordering reads a number a game could actually hold',
  WISHLIST_CURVE.q > 0 && curveAt(1) < 5_000_000,
  `rank 1 reads ${compact(curveAt(1))}`);

check('a game at the head gets both marks like any other', (() => {
  const r = ranked(5);
  return r.wishlists.ok && r.wishlists.contributors.length === 2 && !r.wishlists.rankReason;
})(), 'nothing about the top of the list is handled specially any more');


const both = ranked(340);
check('two marks combine where nothing was announced', both.wishlists.contributors.length === 2,
  `${compact(both.wishlists.range.lo)}–${compact(both.wishlists.range.hi)}`);

check('and both of them were measured here', (() => {
  const methods = both.wishlists.contributors.map((c) => c.method).sort();
  return methods.join() === 'followers,rank';
})(), 'the follower coefficient and the curve are both fitted to one archive');

// A leg earns its say by being precise, not by existing. These replace three
// hand-set weights that gave a four-year-old announcement the same vote as a
// fresh one.
const saidShare = (days) => {
  const at = new Date(Date.now() - days * RANK_DAY).toISOString().slice(0, 10);
  const r = estimateAll({
    appId: 44, released: false, followers: 4200, tags: [],
    wishlistRank: 800, wishlistListing: listing,
    wishlistSaid: { wishlists: 60_000, announcedAt: at }
  });
  return r.wishlists.contributors.find((c) => c.method === 'said').share;
};

check('weights come from the width of each band, not from a constant', (() => {
  const wide = precisionWeight({ lo: 1, mid: 3, hi: 9 });
  const tight = precisionWeight({ lo: 1, mid: 1.2, hi: 1.5 });
  return tight > wide && wide > 0;
})(), 'inverse variance in logs, so a wider band has less say');

check('a fresh announcement carries most of the answer', saidShare(1) > 0.5,
  `${(saidShare(1) * 100).toFixed(0)}% of the figure is what the developer said`);

check('and a stale one carries almost none', saidShare(1460) < 0.1,
  `a four-year-old figure keeps ${(saidShare(1460) * 100).toFixed(0)}% of the say`);

check('so an old announcement cannot blow the band open', (() => {
  const at = (d) => new Date(Date.now() - d * RANK_DAY).toISOString().slice(0, 10);
  const spread = (said) => {
    const r = estimateAll({ appId: 45, released: false, followers: 4200, tags: [],
      wishlistRank: 800, wishlistListing: listing, wishlistSaid: said });
    return r.wishlists.range.hi / r.wishlists.range.lo;
  };
  const none = spread(null);
  const stale = spread({ wishlists: 60_000, announcedAt: at(1460) });
  return stale < none * 1.15;
})(), 'more evidence must not produce a worse answer');

// A game whose developer announced a figure must not come back with a number
// far above it. That is the whole point of the mark.
check('a game that announced a figure is answered close to that figure', (() => {
  const r = estimateAll({
    appId: 43, released: false, followers: 36_890, tags: [],
    wishlistRank: 80, wishlistListing: listing,
    wishlistSaid: { wishlists: 500_000, announcedAt: new Date(Date.now() - 2 * RANK_DAY).toISOString().slice(0, 10) }
  });
  const ratio = r.wishlists.range.mid / 500_000;
  const { lo, hi } = r.wishlists.range;
  return r.wishlists.said && ratio > 1.0 && ratio < 1.30 && lo <= 500_000 && hi >= 500_000;
})(), 'the announced figure is inside the band and the midpoint sits just above it');

check('an announcement is never read as less than itself', (() => {
  const said = { wishlists: 40_000, announcedAt: '2024-01-01' };
  const leg = wishlistsFromAnnouncement(said);
  return leg.ok && leg.range.lo >= 40_000 && leg.range.mid > leg.range.lo && leg.growth > 1;
})(), 'wishlists do not fall before release, so the announced figure is a hard floor');

check('and an old one widens instead of being dropped', (() => {
  const wide = (days) => {
    const at = new Date(Date.now() - days * RANK_DAY).toISOString().slice(0, 10);
    const leg = wishlistsFromAnnouncement({ wishlists: 40_000, announcedAt: at });
    return leg.range.hi / leg.range.lo;
  };
  return wide(900) > wide(2) && wishlistsFromAnnouncement({ wishlists: 40_000, announcedAt: '2019-01-01' }).ok;
})(), 'no age cutoff, because a cutoff is a rule the reader cannot see');

const rankOnly = ranked(340, { followers: null });
check('a game with no readable follower count still gets a number',
  rankOnly.wishlists.ok && rankOnly.wishlists.contributors.length === 1
  && rankOnly.wishlists.contributors[0].method === 'rank',
  'the ranking answers where the hidden group cannot');

const unlisted = ranked(null, { followers: 300 });
check('absence from the ordering is a ceiling, not a gap',
  unlisted.wishlists.ceiling > 0 && unlisted.wishlists.contributors.length === 1,
  `under ${compact(unlisted.wishlists.ceiling)}`);
check('the ceiling is the curve at the last ranked position',
  Math.abs(unlisted.wishlists.ceiling - curveAt(listing.listed) * WISHLIST_CURVE.band.hi) < 1);
check('a ceiling never joins the average',
  unlisted.wishlists.contributors.every((c) => c.method !== 'rank'));
check('and a follower estimate above it is reported as a contradiction',
  ranked(null, { followers: 4200 }).wishlists.ceilingBreached
  && !unlisted.wishlists.ceilingBreached);

check('a stale snapshot is refused rather than trusted', (() => {
  const old = { ...listing, at: Date.now() - WISHLIST_RANK.maxAgeMs - RANK_DAY };
  return wishlistsFromRank(340, old).reason === 'stale-listing';
})(), 'a wrong rank looks exactly as authoritative as a right one');

check('no listing at all is not a ceiling',
  ranked(null, { wishlistListing: null }).wishlists.ceiling === null,
  'not knowing where the list ends is different from being below it');

check('a released game gets no ranking estimate either', (() => {
  const r = estimateAll({
    appId: 41, reviews: 500, released: true, releaseYear: 2024,
    followers: 4200, wishlistRank: 340, wishlistListing: listing
  });
  return !r.wishlists.ok && r.wishlists.reason === 'released';
})());

// The two legs are not independent — rank and follower count correlate at
// -0.96 in logs. The scale must not hand out a level for having both.
check('having both legs is not itself evidence', (() => {
  const one = ranked(340, { followers: null }).confidence.wishlists.level;
  const two = ranked(340).confidence.wishlists.level;
  return LEVELS.indexOf(two) >= LEVELS.indexOf(one) - 1;
})(), 'they are two readings of one underlying popularity');

check('the rank leg is the curve alone',
  wishlistsFromRank(340, listing).range.mid === curveAt(340),
  'the band is the curve\'s own error and nothing else');

check('a stale snapshot silences the rank leg', (() => {
  const stale = { ...listing, at: Date.now() - WISHLIST_RANK.maxAgeMs - RANK_DAY };
  const r = estimateAll({ appId: 42, released: false, followers: 4200, tags: ['Puzzle'],
    wishlistRank: 340, wishlistListing: stale });
  return r.wishlists.contributors.length === 1 && r.wishlists.contributors[0].method === 'followers';
})(), 'a rank read from a store that has moved on is worse than no rank');

group('Concurrent players');

// The published multiplier is calibrated on the all-time peak, so that is what
// it is fed. Yesterday's peak is a different quantity that happens to
// coincide for a fortnight after launch.
const day = 86_400_000;
const releasedAt = Date.now() - 20 * day;

const freshLaunch = estimateAll({
  appId: 8, reviews: 900, positivePct: 90, listPrice: 24.99, released: true,
  releaseYear: new Date().getFullYear(),
  allTimePeak: 5000, releaseDate: releasedAt, allTimePeakAt: releasedAt + 3 * day
});
check('week-one rule applies to a peak set at launch', freshLaunch.crossChecks.ccu.ok,
  `~${compact(freshLaunch.crossChecks.ccu.range.mid)} week-one units`);
check('and reports which multiplier it used',
  freshLaunch.crossChecks.ccu.multiplier === CCU.multiplier.unknown,
  `${CCU.multiplier.unknown}x, the no-preorder-information median`);

// Stardew Valley's all-time peak is from March 2024, eight years after
// release. Running a week-one rule on that would be nonsense, and nothing
// downstream could tell the result from a real one.
const latePeak = estimateAll({
  appId: 9, reviews: 90_000, positivePct: 93, listPrice: 39.99, released: true,
  releaseYear: 2021,
  allTimePeak: 5000, releaseDate: Date.now() - 1200 * day, allTimePeakAt: Date.now() - 200 * day
});
check('a peak set long after launch is not treated as a launch peak',
  !latePeak.crossChecks.ccu.ok && latePeak.crossChecks.ccu.reason === 'peak-not-at-launch');
check('the refusal says how long after launch the peak came',
  latePeak.crossChecks.ccu.daysAfterRelease === 1000);

// This gate has to fail closed: applying the rule with no date to check it
// against is the one direction a guard against a confidently wrong number
// must never fail in.
const undated = estimateAll({
  appId: 10, reviews: 900, positivePct: 90, listPrice: 24.99, released: true,
  releaseYear: 2024, allTimePeak: 5000
});
check('an undated peak declines rather than applying the rule',
  !undated.crossChecks.ccu.ok && undated.crossChecks.ccu.reason === 'peak-date-unknown',
  'a safety gate fails closed');

group('Collapsed view');

const shipped = estimateAll({
  appId: 11, reviews: 2400, positivePct: 92, price: 24.99, released: true,
  releaseYear: 2023, currentPlayers: 812, peakCcuYesterday: 1500
});

const defaultFigures = pillFigures(shipped).map((f) => f.key);
check('defaults show the estimate chain',
  defaultFigures.join(' ') === 'reviews units net', defaultFigures.join(' '));
check('players are off by default', PILL_DEFAULTS.players === false);

const withPlayers = pillFigures(shipped, { players: true }).map((f) => f.key);
check('turning players on appends them', withPlayers.includes('players'));
check('order stays canonical regardless of config',
  withPlayers.join(' ') === 'reviews units net players', withPlayers.join(' '));

const onlyNet = pillFigures(shipped, { reviews: false, units: false, wishlists: false });
check('unchecking hides items', onlyNet.map((f) => f.key).join(' ') === 'net');

check('everything off yields nothing to render',
  pillFigures(shipped, { reviews: false, units: false, net: false, wishlists: false, players: false }).length === 0,
  'overlay falls back to a label');

const noData = estimateAll({ appId: 12, reviews: 8, price: 9.99, released: true, releaseYear: 2025 });
check('items without data are skipped, never dashed',
  pillFigures(noData, { players: true }).every((f) => f.value != null));

group('Zero-review handling');

const noReviews = estimateAll({
  appId: 13, reviews: 0, price: 14.99, released: true, releaseYear: 2026, followers: 300
});
check('a zero count is not shown as a figure',
  !pillFigures(noReviews).some((f) => f.key === 'reviews'),
  'nothing beats "0 reviews"');
check('one review is still a real count',
  pillFigures({ ...noReviews, game: { ...noReviews.game, reviews: 1 } })
    .some((f) => f.key === 'reviews'));

const emptyServer = estimateAll({
  appId: 14, reviews: 4000, positivePct: 88, price: 19.99, released: true,
  releaseYear: 2020, currentPlayers: 0, peakCcuYesterday: 0
});
check('an idle game shows no In-Game figure',
  !pillFigures(emptyServer, { players: true }).some((f) => f.key === 'players'));

const liveGame = estimateAll({
  appId: 15, reviews: 4000, positivePct: 88, price: 19.99, released: true,
  releaseYear: 2020, currentPlayers: 0, peakCcuYesterday: 553
});
const playersFig = pillFigures(liveGame, { players: true }).find((f) => f.key === 'players');
check('zero live players fall back to yesterday\'s peak', playersFig?.value === 553);

group('Pre-release panel');

const unshipped = estimateAll({
  appId: 16, reviews: 0, price: 24.99, released: false,
  releaseYear: 2027, followers: 3100, festivalContext: 'nextFest'
});
check('an unreleased game has no unit estimate to show', !unshipped.units.ok);
check('and no revenue either', !unshipped.revenue.ok);
check('but wishlists are the point of the page', unshipped.wishlists.ok,
  `${compact(unshipped.wishlists.range.lo)} \u2013 ${compact(unshipped.wishlists.range.hi)}`);
check('the pill carries only what exists',
  pillFigures(unshipped).map((f) => f.key).join(' ') === 'wishlists',
  pillFigures(unshipped).map((f) => f.key).join(' ') || '(nothing)');

group('Method labels');

const twoMethods = estimateAll({
  appId: 17, reviews: 3000, positivePct: 88, price: 19.99, released: true,
  releaseYear: 2022, owners: '500,000 .. 1,000,000'
});
check('labels are descriptors, not baked English',
  twoMethods.units.contributors.every((c) => typeof c.label === 'object' && c.label.key),
  twoMethods.units.contributors.map((c) => c.label.key).join(', '));
check('each carries an English fallback',
  twoMethods.units.contributors.every((c) => typeof c.label.text === 'string'));

group('Translation coverage');

// Descriptors travel from core to the overlay as { key, text }. If the key is
// missing from a locale the interface silently prints the English fallback,
// which is exactly the kind of failure nobody files a bug about.
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// Some invariants are about the shape of the code rather than its output —
// that a magic number is not baked into a template string, that a parser does
// not read by position. Each file is read once, here, so a group can grep it
// wherever it happens to sit in this script.
const workerSrc = readFileSync(join(REPO, 'src/background/service-worker.js'), 'utf8');
const overlaySrc = readFileSync(join(REPO, 'src/content/overlay.js'), 'utf8');
const scrapeSrc = readFileSync(join(REPO, 'src/content/scrape.js'), 'utf8');

const localeTags = readdirSync(join(REPO, '_locales'));
const tables = Object.fromEntries(
  localeTags.map((tag) => [tag, JSON.parse(readFileSync(join(REPO, '_locales', tag, 'messages.json'), 'utf8'))])
);

function collectKeys(value, found = new Set()) {
  if (Array.isArray(value)) { value.forEach((v) => collectKeys(v, found)); return found; }
  if (value && typeof value === 'object') {
    if (typeof value.key === 'string' && 'text' in value) found.add(value.key);
    Object.values(value).forEach((v) => collectKeys(v, found));
  }
  return found;
}

const emitted = new Set();
for (const sample of [
  estimateAll({ appId: 90, reviews: 3000, positivePct: 88, price: 19.99, released: true,
                releaseYear: 2022, owners: '500,000 .. 1,000,000' }),
  estimateAll({ appId: 91, reviews: 60, positivePct: 70, price: 9.99, released: true, releaseYear: 2015 }),
  estimateAll({ appId: 92, reviews: 0, price: 24.99, released: false, releaseYear: 2027,
                followers: 3100, festivalContext: 'nextFest' })
]) collectKeys(sample, emitted);

check('core emits descriptor keys', emitted.size > 0, `${emitted.size} keys`);

const missing = [];
for (const [tag, table] of Object.entries(tables)) {
  for (const key of emitted) if (!table[key]) missing.push(`${tag}/${key}`);
}
check('every descriptor key exists in every locale', missing.length === 0,
  missing.length ? missing.slice(0, 5).join(', ') : `${emitted.size} keys x ${localeTags.length} locales`);

group('Per-metric confidence');

const mixed = estimateAll({
  appId: 20, reviews: 3000, positivePct: 88, price: 19.99, released: true,
  releaseYear: 2022, owners: '500,000 .. 1,000,000'
});
check('every figure is scored separately',
  ['units', 'revenue', 'wishlists'].every((k) => mixed.confidence[k]?.level),
  `units ${mixed.confidence.units.level}, revenue ${mixed.confidence.revenue.level}`);
check('revenue is never more confident than the units it comes from',
  ['good', 'fair', 'low', 'none'].indexOf(mixed.confidence.revenue.level) >=
  ['good', 'fair', 'low', 'none'].indexOf(mixed.confidence.units.level));
check('a downgrade never becomes "no estimate"',
  mixed.confidence.revenue.level !== 'none', 'low is the floor for a scored figure');

const preRelease = estimateAll({
  appId: 21, reviews: 0, price: 24.99, released: false, releaseYear: 2027,
  followers: 3100, festivalContext: 'nextFest'
});
check('a pre-release page does not claim "no data" over a real number',
  preRelease.confidence.wishlists.level !== 'none',
  `wishlists ${preRelease.confidence.wishlists.level}, units ${preRelease.confidence.units.level}`);
// No penalty for an unknown promotion history: it is unknown on every game,
// and a step docked every time is a quieter baseline, not a signal.
check('an unknown history costs nothing',
  estimateAll({ appId: 22, reviews: 0, price: 24.99, released: false,
    releaseYear: 2027, followers: 3100 }).confidence.wishlists.level ===
  preRelease.confidence.wishlists.level,
  'same level with or without a festival');

check('the collapsed row reports the weakest figure it shows',
  preRelease.confidence.overallFor(['wishlists']) === preRelease.confidence.wishlists.level);
check('and combining figures cannot improve the verdict',
  mixed.confidence.overallFor(['units', 'net']) === 'low');

group('Review bands');

// Steam's own boundary is 70%, not 80%: below it a game wears the yellow
// "Mixed" label, above it the blue "Mostly Positive" one.
const bandFor = (pct) => {
  const g = estimateAll({
    appId: 30, reviews: 900, positivePct: pct, price: 19.99,
    released: true, releaseYear: 2023
  });
  return g.game.positivePct;
};
check('79% is a positive band, not mixed', bandFor(79) >= 70, 'Mostly Positive starts at 70');
check('69% falls into mixed', bandFor(69) < 70 && bandFor(69) >= 40);
check('39% is negative', bandFor(39) < 40);

group('All-time peak parser');

const chartsPage = [
  '<div class="app-stat"><span class="num">1066083</span><br>playing <abbr>now</abbr></div>',
  '<div class="app-stat"><span class="num">1185517</span><br>24-hour peak</div>',
  '<div class="app-stat"><span class="num">1818368</span><br>all-time peak</div>'
].join('\n');

check('reads the all-time figure, not the 24-hour one',
  parseAllTimePeak(chartsPage) === 1818368, String(parseAllTimePeak(chartsPage)));
check('reads both peaks in one pass', (() => {
  const st = parseChartsStats(chartsPage);
  return st?.peak24h === 1185517 && st?.allTimePeak === 1818368;
})(), JSON.stringify(parseChartsStats(chartsPage)));
// SteamSpy samples, so a game with a few hundred reviews reports ccu 0 while
// SteamCharts, reading Valve's API, has the real single-digit number.
check('a small game keeps its single-digit peaks', (() => {
  const tiny = chartsPage.replace('1185517', '3').replace('1818368', '41');
  const st = parseChartsStats(tiny);
  return st?.peak24h === 3 && st?.allTimePeak === 41;
})());
check('a genuine zero is a reading, not a miss',
  parseChartsStats(chartsPage.replace('1185517', '0'))?.peak24h === 0);
check('survives thousands separators',
  parseAllTimePeak(chartsPage.replace('1818368', '1,818,368')) === 1818368);
check('does not depend on class names',
  parseAllTimePeak('<span>4242</span><br>all-time peak') === 4242);
check('goes quiet when the label is absent',
  parseAllTimePeak('<span>4242</span><br>24-hour peak') === null,
  'a wrong number here would look exactly like a right one');
check('goes quiet on unexpected markup', parseAllTimePeak('<html>nope</html>') === null);
check('rejects non-strings', parseAllTimePeak(null) === null);

group('Player trend parser');

const trendTable = [
  '<table><tbody>',
  '<tr><td class="month-cell left">Last 30 Days</td><td class="right num-f">819,887.81</td>',
  '<td class="right num-f">-5,370.0</td><td class="right num-p">-0.65%</td>',
  '<td class="right num">1331274</td></tr>',
  '<tr><td class="month-cell left">August 2026</td><td class="right num-f">825,257.80</td>',
  '<td class="right num-f">-27,974.65</td><td class="right num-p">-3.28%</td>',
  '<td class="right num">1331274</td></tr>',
  '</tbody></table>'
].join('');

check('reads the 30-day change', parseRecentTrend(trendTable)?.changePct === -0.65,
  String(parseRecentTrend(trendTable)?.changePct));
check('does not bleed into the next month row',
  parseRecentTrend(trendTable)?.changePct !== -3.28);
check('picks up the average concurrent count',
  parseRecentTrend(trendTable)?.avgPlayers === 819888);
check('handles a rise',
  parseRecentTrend(trendTable.replace('-0.65%', '+12.59%'))?.changePct === 12.59);
check('handles a bare percentage',
  parseRecentTrend(trendTable.replace('-0.65%', '8.00%'))?.changePct === 8);
check('goes quiet when there is no table',
  parseRecentTrend('<html>brand new release</html>') === null);
check('rejects non-strings', parseRecentTrend(null) === null);

group('Review summary parser');

// The tooltip sentence is translated, so only the shapes can be matched.
check('reads an English recent summary', (() => {
  const r = parseReviewSummary('94% of the 1,234 user reviews in the last 30 days are positive.');
  return r?.pct === 94 && r?.count === 1234;
})());
check('reads a lifetime summary', (() => {
  const r = parseReviewSummary('87% of the 56,789 user reviews for this game are positive.');
  return r?.pct === 87 && r?.count === 56789;
})());
// A fixture of 1,234 reviews is larger than the window length, so it cannot
// exercise the case that matters. On a real page — app 2477010 reads "81% of
// the 22 user reviews in the last 30 days" — taking the largest remaining
// number reports 30 reviews instead of 22.
check('the "30 days" is not mistaken for the count',
  parseReviewSummary('94% of the 1,234 user reviews in the last 30 days are positive.')?.count === 1234);
check('and is not mistaken for it when it is the larger number', (() => {
  const r = parseReviewSummary('81% of the 22 user reviews in the last 30 days are positive.');
  return r?.pct === 81 && r?.count === 22;
})(), 'the case that goes wrong on every game with under 30 recent reviews');
check('a game with exactly 30 recent reviews still reports 30', (() => {
  const r = parseReviewSummary('90% of the 30 user reviews in the last 30 days are positive.');
  return r?.count === 30;
})(), 'the window length is dropped once, not every time it appears');

// Which row is which is decided by whether the sentence names its window,
// because the labels are translated and the position is not dependable: the
// store renders a second, responsive copy of both rows in the opposite order.
check('the recent row is identified by naming its window',
  parseReviewSummary('81% of the 22 user reviews in the last 30 days are positive.')?.windowed === true);
check('and the lifetime row by not naming one',
  parseReviewSummary('69% of the 1,047 user reviews for this game are positive.')?.windowed === false);
check('the reader classifies rather than counting positions',
  /\.find\(\(p\) => p\.windowed\)/.test(scrapeSrc)
  && !/rows\[0\]|rows\[1\]/.test(scrapeSrc),
  'no row index anywhere in the trend reader');
check('handles a percent-first language', (() => {
  const r = parseReviewSummary('Bu oyun için 56.789 kullanıcı incelemesinin %87 kadarı olumlu.');
  return r?.pct === 87 && r?.count === 56789;
})());
check('handles dot and space separators',
  parseReviewSummary('87 % der 56.789 Nutzerrezensionen sind positiv.')?.count === 56789);
check('goes quiet with no score',
  parseReviewSummary('Need more user reviews to generate a score') === null);
check('rejects an impossible percentage',
  parseReviewSummary('742% of reviews are positive') === null);
check('rejects non-strings', parseReviewSummary(null) === null);

group('Reason placement');

const thin = estimateAll({
  appId: 40, reviews: 70, positivePct: 85, price: 9.99, released: true, releaseYear: 2025
});
const shown = thin.confidence.units.reasons.filter((r) => (r.severity ?? 0) >= 1);
const quiet = thin.confidence.units.reasons.filter((r) => (r.severity ?? 0) === 0);

check('costly reasons are surfaced', shown.length > 0, shown.map((r) => r.text).join(' / '));
check('every reason carries a severity',
  thin.confidence.units.reasons.every((r) => Number.isFinite(r.severity)));
check('descriptive reasons stay out of the way',
  quiet.every((r) => (r.severity ?? 0) === 0));

// A note repeated under the game name while the figure shows it again is the
// same sentence twice on one panel, so the reason keys are the only source.
const localeKeys = Object.keys(tables.en);
check('no note string duplicates a reason',
  !localeKeys.includes('nLowSample') && !localeKeys.includes('nWidened'),
  'reason keys are the single source');

group('Comparable scopes');

// Real numbers off the Apex Legends store page. Steam scopes the lifetime row
// to English (449,071 of about 1,067,347 reviews) while leaving the recent row
// across every language, so subtracting one from the other compares thirty
// days of all languages against a lifetime of English.
// As observed in the overlay: 66% recent against a 76% English-only lifetime
// row, over roughly 1.07M reviews in total.
const apexTrend = { recentPct: 66, recentCount: 7497, allPct: 76, allCount: 449_071 };
const apexTotal = 1_067_347;

check('a language-filtered lifetime row is caught',
  comparableScopes(apexTrend, apexTotal) === false,
  `${apexTrend.allCount} of ${apexTotal} is not the same population`);

// The Ember Guardian, where the page counts every review it knows about.
check('an unfiltered page compares fine',
  comparableScopes({ recentPct: 80, recentCount: 15, allPct: 81, allCount: 272 }, 272) === true);
check('the margin tolerates a small purchase-type gap',
  comparableScopes({ allPct: 81, allCount: 950 }, 1000) === true, '95% of the total');
check('but not a halved population',
  comparableScopes({ allPct: 81, allCount: 500 }, 1000) === false);
check('missing counts never claim comparability',
  comparableScopes(null, 1000) === false &&
  comparableScopes({ allPct: 81, allCount: null }, 1000) === false);

group('What the review block shows');

// One lifetime share is chosen, and the delta is always the difference
// between the two figures printed on screen, so it can be checked by eye.
const reviewBlock = (total, trend, apiPct) => {
  const fromPage = comparableScopes(trend, total);
  const lifetime = Math.round(fromPage ? trend.allPct : apiPct);
  return { lifetime, delta: trend.recentPct - lifetime };
};

const apex = reviewBlock(1_067_347, apexTrend, 68);
check('a language-scoped page falls back to our own share', apex.lifetime === 68);
check('and still shows a trend', apex.delta === -2, '66 - 68 = -2');

const ember = reviewBlock(272, { recentPct: 80, recentCount: 15, allPct: 81, allCount: 272 }, 81);
check('an unfiltered page uses its own pair', ember.lifetime === 81);
check('with the delta drawn from that pair', ember.delta === -1, '80 - 81 = -1');

check('the delta always matches what is on screen',
  [apex, ember].every((b) => Number.isInteger(b.delta)),
  'no hidden third number');

group('Same-source comparisons');

// A percentage from one source compared against a percentage from another
// produces a delta that contradicts the numbers printed beside it. Apex
// Legends showed 68% (our API, every purchase type, review bombs included)
// against a 66% recent score from the page and labelled the gap 10 points,
// because the page's own lifetime score was 76%.
const pageAll = 76;
const pageRecent = 66;
const apiAll = 68;

check('the delta matches the pair it is drawn from',
  pageRecent - pageAll === -10, `${pageRecent} - ${pageAll} = -10`);
check('and would contradict a mixed pair',
  pageRecent - apiAll !== pageRecent - pageAll,
  `mixing gives ${pageRecent - apiAll}, not ${pageRecent - pageAll}`);

group('Separator consistency');

// An interpunct written into strings in some places and rendered as an
// element in others leaves half of them invisible at body weight.

check('no separator is baked into a template string',
  !/\$\{CLAUSE_SEP\}/.test(overlaySrc), 'all of them are elements');
check('none is emitted as a bare text node',
  !/createTextNode\(CLAUSE_SEP\)/.test(overlaySrc));
check('one rule styles every separator',
  (overlaySrc.match(/^\.sep \{/m) ?? []).length === 1,
  'spacing and weight live in one place');

group('Self-describing rows');

// A percentage with no unit and a caption floating above it leaves the reader
// guessing what the number is a share of. Every row has to say so itself.
const en = tables.en;
for (const key of ['mPositiveAllTime', 'mPositiveRecent']) {
  check(`${key} names what it measures`,
    /positive/i.test(en[key].message), en[key].message);
}
check('no floating caption stands in for a label',
  ['nAllLanguages', 'nPageFiltered', 'nPositivePct', 'mAllTimeReviews', 'mRecentReviews']
    .every((k) => !(k in en)),
  'their meaning belongs in the labels');

group('Collapsed row sub-lines');


// One helper decides the review delta. Two views of the same figure that
// disagree would be worse than showing it once.
check('the review delta has a single implementation',
  (overlaySrc.match(/function reviewTrendPp\(/g) ?? []).length === 1);
check('the panel uses that helper rather than its own arithmetic',
  /const pp = reviewTrendPp\(\);/.test(overlaySrc) &&
  !/rt\.recentPct - Math\.round\(lifetimePct\)/.test(overlaySrc),
  'no second copy of the subtraction');
check('the collapsed row uses it too',
  /pillTrendFor/.test(overlaySrc) && /reviewTrendPp\(\)/.test(overlaySrc));
check('estimates keep a verdict, measured figures get a trend',
  /conf \$\{conf\.level\}/.test(overlaySrc) && /trend-\$\{dir\}/.test(overlaySrc));

group('No guessing at promotion history');

// A demo is not festival participation, and the multiplier is measured for
// the latter. Inferring one from the other raises the estimate on an unrelated
// fact; searching for "Next Fest" only ever matches while the fest is running.
check('a demo is not read as a festival',
  !/demo_area_button|data-demo-appid/.test(scrapeSrc));
check('the page is not scanned for festival wording',
  !/Next Fest/i.test(scrapeSrc.replace(/\/\*[\s\S]*?\*\//g, '')),
  'only the comment explaining why mentions it');
check('the context is always reported as unknown',
  /return 'unknown';/.test(scrapeSrc));

// Which is the honest answer: the fallback is the survey median across every
// game, and confidence drops a step for not knowing.
const noContext = estimateAll({
  appId: 60, reviews: 0, price: 14.99, released: false,
  releaseYear: 2026, followers: 1069
});
check('the fallback uses the overall median',
  Math.abs(noContext.wishlists.range.mid - 1069 * WISHLIST.median) < 1,
  `1069 x ${WISHLIST.median} = ${Math.round(1069 * WISHLIST.median)}`);
check('and the width of the ratio is what the confidence reports',
  noContext.confidence.wishlists.reasons.some((r) => r.key === 'rFollowerRatio'),
  'the honest signal, not a constant apology');
check('no reason describes our own plumbing',
  !noContext.confidence.wishlists.reasons.some((r) => r.key === 'rContextUnknown'));

group('Emphasis markers');

// Locale strings can mark a phrase for emphasis with **double asterisks**.
// An unbalanced pair leaks raw asterisks into the interface, which is the kind
// of thing a translator breaks and nobody notices until a screenshot.
const marked = [];
for (const [tag, table] of Object.entries(tables)) {
  for (const [key, entry] of Object.entries(table)) {
    const stars = (entry.message.match(/\*\*/g) ?? []).length;
    if (stars % 2 !== 0) marked.push(`${tag}/${key}`);
  }
}
check('every emphasis marker is closed', marked.length === 0,
  marked.length ? marked.slice(0, 5).join(', ') : 'no stray asterisks');

const emphasised = Object.entries(tables.en)
  .filter(([, e]) => e.message.includes('**'))
  .map(([k]) => k);
check('marked strings are marked in every language',
  emphasised.every((key) => Object.values(tables).every((tb) => tb[key]?.message.includes('**'))),
  emphasised.join(', ') || 'none');

group('Local history');

const DAY = 86_400_000;
let series = [];
series = appendSnapshot(series, { at: 1 * DAY, reviews: 100, followers: 10, units: 3000 });
series = appendSnapshot(series, { at: 1 * DAY + 60_000, reviews: 101, followers: 10, units: 3030 });
check('rapid revisits collapse into one point', series.length === 1);

series = appendSnapshot(series, { at: 3 * DAY, reviews: 140, followers: 18, units: 4200 });
check('a later visit appends', series.length === 2);

const delta = diffSince(series, { at: 3 * DAY, reviews: 140, followers: 18, units: 4200 });
check('delta reports what moved', delta?.reviews === 39 && delta?.followers === 8,
  `+${delta?.reviews} reviews, +${delta?.followers} followers`);
check('sparkline needs two points', sparklinePoints([{ at: 1, reviews: 5 }], 'reviews') === null);
check('sparkline normalises to 0..1', (() => {
  const s = sparklinePoints(series, 'reviews');
  return s && s.points[0].y === 0 && s.points[s.points.length - 1].y === 1;
})());

group('List price versus the price on the page');

// Reading `price_overview.final` as the list price counted every discount
// twice — once in the price, again in the average-discount step — and flipped
// the price band on top of that, so the same game read differently during a
// sale than the week before it.
const atFullPrice = estimateAll({
  appId: 70, reviews: 2400, positivePct: 92, released: true, releaseYear: 2023,
  listPrice: 39.99, price: 39.99, discountPct: 0
});
const onSale = estimateAll({
  appId: 70, reviews: 2400, positivePct: 92, released: true, releaseYear: 2023,
  listPrice: 39.99, price: 9.99, discountPct: 75
});

check('a sale does not move the price band',
  atFullPrice.units.boxleiter.applied.some((a) => a.label === 'Priced over $30')
  && onSale.units.boxleiter.applied.some((a) => a.label === 'Priced over $30'),
  'a $40 game is a $40 game at -75%');
check('the waterfall runs on the list price, not the sale price',
  Math.abs(atFullPrice.revenue.netPerUnit - onSale.revenue.netPerUnit) < 0.01,
  `${money(atFullPrice.revenue.netPerUnit)} either way`);
check('the deep-discount signal still fires',
  onSale.units.boxleiter.applied.some((a) => a.label === 'Discounts deeply')
  && !atFullPrice.units.boxleiter.applied.some((a) => a.label === 'Discounts deeply'),
  'the one adjustment that is about today');

group('Every confidence scale has to vary');

// The failure this guards against is a rating that is really a label. Band
// width does not vary: every band is dominated by a fixed published range, so
// across 22 real games the unit spreads are bimodal — eighteen inside
// 2.23x-2.64x, four above 7x, nothing between. Reading a level off that gives
// `good` to nobody, pins revenue at "unreliable" on every paid game ever
// released, and pins wishlists at "rough" on every unreleased one.
//
// So each scale reads the evidence that differs between games, and width
// serves only as a ceiling. These checks assert that each one takes more than
// one value, which no test of a single game could ever catch.
// The three shapes are taken from real games rather than invented, so that
// "reachable" means reachable on the store and not merely on a fixture. Each
// carries the review count, owner bucket, reviewer playtime median and
// sustained concurrent average that produced its verdict live.
const months = (n, from, avgPlayers) =>
  Array.from({ length: n }, (_, i) => ({ year: from + Math.floor(i / 12), monthIndex: i % 12, avgPlayers }));

const scale = [
  ['Enshrouded-shaped: two bands overlapping', {
    appId: 80, reviews: 105_184, positivePct: 85.8, listPrice: 29.99, released: true,
    releaseYear: 2024, owners: '2,000,000 .. 5,000,000', steamPurchaseShare: 0.88
  }],
  ['Path of Exile 2-shaped: the playtime cross-check objects', {
    appId: 81, reviews: 225_264, positivePct: 80, listPrice: 29.99, released: true,
    releaseYear: 2024, owners: '5,000,000 .. 10,000,000', steamPurchaseShare: 0.9,
    monthlyHistory: months(21, 2024, 60_000), reviewerMedianHours: 120, reviewerSampleSize: 100
  }],
  ['Terraria-shaped: two bands that do not touch', {
    appId: 82, reviews: 1_551_818, positivePct: 97, listPrice: 9.99, released: true,
    releaseYear: 2011, owners: '20,000,000 .. 50,000,000', steamPurchaseShare: 0.9
  }]
];

const reached = new Set();
for (const [label, g] of scale) {
  const r = estimateAll(g);
  reached.add(r.confidence.units.level);
  check(`  ${label}`, true,
    `${r.confidence.units.level} — spread ${(r.units.range.hi / r.units.range.lo).toFixed(2)}x, disagree ${r.units.disagreement.toFixed(2)}x`);
}
check('the units scale reaches its top when the evidence is there',
  reached.has('good'), [...reached].join(' '));
check('and its bottom when methods conflict', reached.has('low'));

// Every scale, across shapes that differ only in what is known about them.
const shapes = [
  ['two methods, mix measured', { appId: 90, reviews: 856_026, positivePct: 96.8, listPrice: 59.99, released: true, releaseYear: 2023, owners: '20,000,000 .. 50,000,000', steamPurchaseShare: 0.86, languageMix: { discounted: 230_000, total: 856_026 } }],
  ['two methods, mix defaulted', { appId: 91, reviews: 856_026, positivePct: 96.8, listPrice: 59.99, released: true, releaseYear: 2023, owners: '20,000,000 .. 50,000,000', steamPurchaseShare: 0.86 }],
  ['one method', { appId: 92, reviews: 800, positivePct: 92, listPrice: 19.99, released: true, releaseYear: 2023 }],
  ['thin sample', { appId: 93, reviews: 60, positivePct: 88, listPrice: 14.99, released: true, releaseYear: 2025 }],
  ['methods conflicting', { appId: 94, reviews: 1_551_818, positivePct: 97, listPrice: 9.99, released: true, releaseYear: 2011, owners: '20,000,000 .. 50,000,000', steamPurchaseShare: 0.9 }],
  ['unreleased, genre known', { appId: 95, reviews: null, released: false, releaseYear: 2027, followers: 4000, listPrice: 24.99, tags: ['Puzzle'] }],
  ['unreleased, no genre', { appId: 96, reviews: null, released: false, releaseYear: 2027, followers: 4000, listPrice: 24.99 }],
  // What actually moves the wishlist scale, now that the band width is close
  // to a constant: where the game sits in the ordering, and whether the marks
  // that answer there agree.
  ['ranked, in the body', { appId: 97, reviews: null, released: false, followers: 1200, listPrice: 19.99,
    wishlistRank: 2400, wishlistListing: { listed: 5154, upcoming: 14375, at: Date.now() } }],
  ['ranked, at the head', { appId: 98, reviews: null, released: false, followers: 300_000, listPrice: 59.99,
    wishlistRank: 4, wishlistListing: { listed: 5154, upcoming: 14375, at: Date.now() } }],
  ['not in the ordering, but popular', { appId: 99, reviews: null, released: false, followers: 9000, listPrice: 19.99,
    wishlistRank: null, wishlistListing: { listed: 5154, upcoming: 14375, at: Date.now() } }]
];
const seen = { units: new Set(), revenue: new Set(), wishlists: new Set() };
for (const [, g] of shapes) {
  const r = estimateAll(g, {});
  seen.units.add(r.confidence.units.level);
  seen.revenue.add(r.confidence.revenue.level);
  seen.wishlists.add(r.confidence.wishlists.level);
}
const scored = (set) => [...set].filter((l) => l !== 'none');
check('units takes more than one scored value', scored(seen.units).length > 1, scored(seen.units).sort().join('/'));
check('revenue takes more than one scored value', scored(seen.revenue).length > 1,
  scored(seen.revenue).sort().join('/'));
check('wishlists takes more than one scored value', scored(seen.wishlists).length > 1,
  scored(seen.wishlists).sort().join('/'));

// And the one fact that moves the revenue verdict is a real one.
const measured = estimateAll(shapes[0][1], {});
const defaulted = estimateAll(shapes[1][1], {});
check('a measured audience mix is worth a step on revenue',
  measured.confidence.revenue.level !== defaulted.confidence.revenue.level,
  `${measured.confidence.revenue.level} against ${defaulted.confidence.revenue.level}`);
check('and the reason says which it was',
  measured.confidence.revenue.reasons.some((r) => r.key === 'rRegionalMeasured')
  && defaulted.confidence.revenue.reasons.some((r) => r.key === 'rRegionalAssumed'));

check('width still caps the level regardless of evidence',
  estimateAll(shapes[4][1], {}).confidence.units.level === 'low'
  && CONFIDENCE.good === 2.2 && CONFIDENCE.fair === 3.5,
  'a band past the fair threshold cannot be called anything else');
check('the gap alarm sits at the methods\' own published error, not under it',
  ENSEMBLE.alarmGap > 1.5, `${ENSEMBLE.alarmGap}x`);

// Baldur's Gate 3, as measured: three bands whose midpoints sit 1.88x apart
// and which all admit 17.2M to 20.1M. SteamSpy answers on a ladder, so the
// centre of its 20M-50M bucket is 31.6M for every game in that bucket — a
// fact about the ladder, not about the game. Judging by midpoints turned that
// into a conflict and widened the band to cover it.
const bg3 = combineEstimators([
  { method: 'boxleiter', label: 'B', range: { lo: 13_097_121, mid: 19_645_682, hi: 36_017_084 }, weight: 1 },
  { method: 'owners', label: 'O', range: { lo: 17_200_000, mid: 27_195_588, hi: 43_000_000 }, weight: 0.8 },
  { method: 'playtime', label: 'P', range: { lo: 10_327_483, mid: 14_431_995, hi: 20_125_351 }, weight: 0.5 }
]);
check('bands that share a region are not in conflict',
  bg3.overlaps && !bg3.widened,
  `midpoints ${bg3.disagreement.toFixed(2)}x apart, common ${compact(bg3.common.lo)}–${compact(bg3.common.hi)}`);
check('and the shared region is reported rather than inferred',
  bg3.common.lo === 17_200_000 && bg3.common.hi === 20_125_351);
check('so the verdict is not dragged down by a bucket edge',
  scoreConfidence(bg3).level !== 'low', scoreConfidence(bg3).level);

// Core Keeper, as measured: the playtime route starts above where the owner
// band ends. There is no figure both admit, and that is a real finding.
const disjoint = combineEstimators([
  { method: 'owners', label: 'O', range: { lo: 770_000, mid: 1_088_944, hi: 1_540_000 }, weight: 0.8 },
  { method: 'playtime', label: 'P', range: { lo: 3_356_109, mid: 4_689_947, hi: 6_540_109 }, weight: 0.5 }
]);
check('bands that do not touch are',
  !disjoint.overlaps && disjoint.widened, `gap ${disjoint.gap.toFixed(2)}x`);
check('a gap past the published error forces the bottom level',
  disjoint.gap > ENSEMBLE.alarmGap && scoreConfidence(disjoint).level === 'low');
check('the reason names the gap, not a ratio between midpoints',
  scoreConfidence(disjoint).reasons.some((r) => r.key === 'rNoCommonFigure'
    && r.params[0] === disjoint.gap.toFixed(1)));

// A narrow gap is reported without being treated as a contradiction.
const nearMiss = combineEstimators([
  { method: 'a', label: 'A', range: { lo: 900, mid: 1000, hi: 1100 }, weight: 1 },
  { method: 'b', label: 'B', range: { lo: 1200, mid: 1300, hi: 1400 }, weight: 1 }
]);
check('a near miss widens and reports but does not condemn',
  nearMiss.widened && nearMiss.gap < ENSEMBLE.alarmGap && scoreConfidence(nearMiss).level !== 'low',
  `gap ${nearMiss.gap.toFixed(2)}x, ${scoreConfidence(nearMiss).level}`);

check('the ladder gives the bottom bucket a floor instead of a fantasy',
  unitsFromOwners({ lo: 0, hi: 20_000 }).range.mid > 5_000,
  `${compact(unitsFromOwners({ lo: 0, hi: 20_000 }).range.mid)}, not 134`);

group('Why the second method is missing');

// SteamSpy answers for any app id it has heard of, including ones it has
// never processed. An unprocessed record is owners "0 .. 20,000" with every
// other field at zero, which is indistinguishable from a genuinely tiny game
// unless you look at its own review tally. PEAK carries 367,000 Steam reviews
// against a record like that; Escape from Tarkov 63,000.
const emptyRecord = estimateAll({
  appId: 100, reviews: 367_166, positivePct: 93, listPrice: 7.99, released: true,
  releaseYear: 2025, owners: '0 .. 20,000', ownerRecordReviews: 0
}, {});
const reallyTiny = estimateAll({
  appId: 101, reviews: 300, positivePct: 90, listPrice: 9.99, released: true,
  releaseYear: 2025, owners: '0 .. 20,000', ownerRecordReviews: 280
}, {});
const requestFailed = estimateAll({
  appId: 102, reviews: 3000, positivePct: 90, listPrice: 19.99, released: true,
  releaseYear: 2024, owners: null, ownerRecordReviews: null
}, {});

const why = (r) => r.confidence.units.reasons[0].key;
check('an unprocessed record is not read as a small game',
  why(emptyRecord) === 'rOwnersNoRecord',
  'a source that has never looked at the game is a fact about the source');
check('a populated tiny bucket says the band is too small',
  why(reallyTiny) === 'rOwnersTooSmall');
check('a failed request says neither', why(requestFailed) === 'rSingleMethod');
check('all three are different sentences',
  new Set([why(emptyRecord), why(reallyTiny), why(requestFailed)]).size === 3,
  '"single method" alone left the reader unable to tell them apart');
check('and none of them contributes a band',
  [emptyRecord, reallyTiny, requestFailed].every((r) => r.units.contributors.length === 1));

// The tell has to be robust to a game that legitimately has almost nothing.
check('a game below the review gate is not accused of a missing record',
  estimateAll({ appId: 103, reviews: 9, listPrice: 9.99, released: true, releaseYear: 2026, owners: '0 .. 20,000', ownerRecordReviews: 0 }, {}).units.ok === false,
  'no estimate at all, so nothing to explain');

// And it has to survive the display gate moving. The tell is the mismatch
// between the two review tallies, not a review count of its own, so a game
// just over the gate with an unprocessed record still gets the explanation
// that names the source rather than one that blames the game's size.
const justOverGate = estimateAll({
  appId: 104, reviews: 20, positivePct: 90, listPrice: 9.99, released: true,
  releaseYear: 2026, owners: '0 .. 20,000', ownerRecordReviews: 0
}, {});
// Presence, not position: at 20 reviews the widened band outranks this by
// severity, and the leading reason is meant to be whatever set the level.
check('a game just over the gate still reads the record, not the size',
  justOverGate.units.ok
    && justOverGate.confidence.units.reasons.some((r) => r.key === 'rOwnersNoRecord'),
  `leads with ${why(justOverGate)}, and names the record below it`);

group('A thin owner band changes nothing');

// SteamSpy's coarsest bucket tops out at 20,000 owners. It carries zero
// weight because it is too thin to trust, and it must not redden the
// confidence either — a game scoring worse with SteamSpy data than with none
// at all reads the respondent rather than the game.
const shape = {
  reviews: 800, positivePct: 92, listPrice: 19.99, released: true, releaseYear: 2023
};
const withThinBand = estimateAll({ ...shape, appId: 71, owners: '0 .. 20,000' });
const withNoBand = estimateAll({ ...shape, appId: 72, owners: null });

check('a zero-weight band stays out of the average',
  withThinBand.units.contributors.length === withNoBand.units.contributors.length);
check('and does not reach the confidence either',
  withThinBand.confidence.units.level === withNoBand.confidence.units.level,
  `both ${withNoBand.confidence.units.level}`);
// The verdict has to match; the sentences deliberately do not, because one
// of these games has a source reporting a useless band and the other has no
// source at all, and the reader is owed the difference.
check('having less data cannot improve the verdict',
  withThinBand.confidence.units.level === withNoBand.confidence.units.level
  && withThinBand.units.contributors.length === withNoBand.units.contributors.length);
check('but the reason still says which situation it is',
  withThinBand.confidence.units.reasons[0].key === 'rOwnersTooSmall'
  && withNoBand.confidence.units.reasons[0].key === 'rSingleMethod',
  'same verdict, different explanation');

// Owners are not a ceiling on units. SteamSpy is the source this file
// describes as reading low, so its bucket edge is not a bound; and because
// the band is one of the estimators being averaged, whenever the others clear
// its top the disagreement metric has already said so.
check('no reason blames the estimate for clearing a SteamSpy bucket',
  !/rCeiling/.test(readFileSync(join(REPO, 'src/core/ensemble.js'), 'utf8')));
const overOwners = estimateAll({
  appId: 73, reviews: 60_000, positivePct: 92, listPrice: 19.99, released: true,
  releaseYear: 2023, owners: '200,000 .. 500,000'
});
check('the same fact is reported once, as a disagreement',
  overOwners.confidence.units.reasons.some((r) => r.key === 'rNoCommonFigure'),
  `${overOwners.units.disagreement.toFixed(1)}x apart, named in one sentence`);

group('Review count as a multiplier band');

// Published as 36x under 100 reviews against 52.8x at 1,000-10,000, which is
// a 1.47x spread carried as a shape around its own geometric centre.
const bands = [80, 500, 5000, 50_000].map((reviews) =>
  collectAdjustments({ reviews, listPrice: 19.99 }).applied
    .find((a) => String(a.label).includes('reviews'))?.factor ?? 1);
check('mid-size games carry the highest multiple', bands[2] === Math.max(...bands),
  bands.map((f, i) => `${[80, 500, 5000, 50_000][i]}:${f}`).join(' '));
check('the smallest games carry the lowest', bands[0] === Math.min(...bands));
check('the shape is centred, not a net raise or cut',
  Math.abs(bands[0] * bands[2] - 1) < 0.01, `${bands[0]} x ${bands[2]} ~= 1`);

group('Player-hours over playtime');

const twoYears = [];
for (let i = 0; i < 24; i++) {
  twoYears.push({ year: 2024 + Math.floor(i / 12), monthIndex: i % 12, avgPlayers: 500 });
}
const fromHours = unitsFromPlaytime(twoYears, 20);
check('estimates lifetime units from history and playtime', fromHours.ok,
  `${compact(fromHours.range.mid)} units from ${compact(fromHours.playerHours)} player-hours`);
check('the band is ordered and wide',
  fromHours.range.lo < fromHours.range.mid && fromHours.range.mid < fromHours.range.hi
  && fromHours.range.hi / fromHours.range.lo > 1.5,
  `${(fromHours.range.hi / fromHours.range.lo).toFixed(2)}x spread`);
check('a longer average playtime means fewer owners for the same hours',
  unitsFromPlaytime(twoYears, 40).range.mid < fromHours.range.mid);
check('refuses a playtime sample too small to have a median',
  unitsFromPlaytime(twoYears, 20, { sampleSize: 5 }).reason === 'playtime-sample-too-small');
check('refuses with no history at all', !unitsFromPlaytime([], 20).ok);
check('the bias correction is the measured one, not a guess',
  PLAYTIME.biasRange.lo < 1 && PLAYTIME.biasRange.hi > 1,
  `${PLAYTIME.biasRange.lo}-${PLAYTIME.biasRange.hi}x, straddling 1`);

const threeLegs = estimateAll({
  appId: 74, reviews: 3000, positivePct: 88, listPrice: 19.99, released: true,
  releaseYear: 2022, owners: '500,000 .. 1,000,000',
  monthlyHistory: twoYears, reviewerMedianHours: 20, reviewerSampleSize: 100
});
check('the playtime route does not join the average',
  threeLegs.units.contributors.every((c) => c.method !== 'playtime'),
  threeLegs.units.contributors.map((c) => c.method).join(' '));
check('it is reported as a cross-check instead',
  threeLegs.crossChecks.playtime.ok && !('weight' in threeLegs.crossChecks.playtime),
  'measured hours, unmeasurable divisor');
check('weights still sum to one',
  Math.abs(threeLegs.units.contributors.reduce((a, c) => a + c.share, 0) - 1) < 1e-9);

check('median playtime comes back in hours',
  medianHours([60, 120, 180]) === 2, '120 minutes is 2 hours');
check('an empty playtime sample has no median', medianHours([]) === null);

group('Regional profile from review languages');

check('a mostly western audience reads as US and EU',
  regionalFromLanguages({ discounted: 100, total: 1000 }).profile === 'us-eu');
check('Stardew-shaped, at 41% low-price markets, reads as mixed',
  regionalFromLanguages({ discounted: 413, total: 1000 }).profile === 'mixed');
check('a heavily emerging-market audience reads as such',
  regionalFromLanguages({ discounted: 700, total: 1000 }).profile === 'emerging');
check('too few reviews to read declines',
  regionalFromLanguages({ discounted: 5, total: 50 }).ok === false);
check('no mix at all is not an answer', regionalFromLanguages(null) === null);

const autoRegion = estimateAll({
  appId: 75, reviews: 5000, positivePct: 90, listPrice: 19.99, released: true,
  releaseYear: 2023, languageMix: { discounted: 700, total: 1000 }
}, { regionalProfile: 'auto' });
check('the derived profile reaches the waterfall',
  autoRegion.revenue.settings.regionalKey === 'emerging',
  `x${autoRegion.revenue.settings.regionalFactor}`);
check('and says it was derived rather than chosen',
  autoRegion.revenue.settings.regionalAuto === true
  && autoRegion.revenue.settings.regionalDerivedFrom?.ok === true);

const pinnedRegion = estimateAll({
  appId: 76, reviews: 5000, positivePct: 90, listPrice: 19.99, released: true,
  releaseYear: 2023, languageMix: { discounted: 700, total: 1000 }
}, { regionalProfile: 'us-eu' });
check('an explicit choice overrides the reading',
  pinnedRegion.revenue.settings.regionalKey === 'us-eu',
  'the developer knows their own audience');

group('The revenue band carries the waterfall');

const unitBand = { lo: 10_000, mid: 20_000, hi: 40_000 };
const money20 = estimateRevenueRange(unitBand, 20, { regionalProfile: 'mixed' });
const unitSpread = unitBand.hi / unitBand.lo;
const netSpread = money20.net.hi / money20.net.lo;
check('the revenue band is wider than the unit band it came from',
  netSpread > unitSpread,
  `${netSpread.toFixed(2)}x against ${unitSpread.toFixed(2)}x`);
check('the envelope reports the discount span it used',
  Math.abs(money20.envelope.avgDiscount.lo - 0.1) < 1e-9
  && Math.abs(money20.envelope.avgDiscount.hi - 0.3) < 1e-9,
  '10% to 30%');
check('and the refund span, on the published figures',
  Math.abs(money20.envelope.refundRate.lo - REFUNDS.lo) < 1e-9
  && Math.abs(money20.envelope.refundRate.hi - REFUNDS.hi) < 1e-9,
  `${REFUNDS.lo * 100}% to ${REFUNDS.hi * 100}%`);
check('the regional leg steps to neighbouring published profiles only',
  money20.envelope.regional.best === 'us-eu' && money20.envelope.regional.worst === 'emerging');
check('the midpoint is untouched by the envelope',
  Math.abs(money20.net.mid - estimateRevenue(20_000, 20, { regionalProfile: 'mixed' }).net) < 0.01);

// The documented sanity figure has to be the one the defaults produce. It
// said 44% while defaulting to a profile that gives 40%, which made a healthy
// reading look like a bug.
const defaultTakeHome = estimateRevenue(1000, 20, {}).takeHomeRatio;
check('the default take-home matches what the interface claims',
  defaultTakeHome > 0.38 && defaultTakeHome < 0.42,
  `${(defaultTakeHome * 100).toFixed(1)}% of list`);
const usEuTakeHome = estimateRevenue(1000, 20, { regionalProfile: 'us-eu' }).takeHomeRatio;
check('and the US/EU figure matches its own claim',
  usEuTakeHome > 0.43 && usEuTakeHome < 0.47,
  `${(usEuTakeHome * 100).toFixed(1)}% of list`);
check('every published profile is in the stepping order',
  Object.keys(REGIONAL_PROFILES).every((k) => REGIONAL_ORDER.includes(k))
  && REGIONAL_ORDER.every((k) => REGIONAL_PROFILES[k]),
  'a gap would make the envelope skip a profile');

group('Wishlists by genre');

// The survey's own figures survive on `surveyed`, and what the estimate uses
// is that shape scaled to the level in force — the same split the festival
// factors carry. Asserting both keeps a rescale from quietly becoming a
// rewrite of the source.
check('a puzzle game gets the puzzle row',
  wishlistMultiplierFor(['Puzzle', 'Indie'])?.surveyed === 15.9);
check('a 4X game gets the lowest one',
  wishlistMultiplierFor(['Grand Strategy', '4X'])?.surveyed === 7.5);
check('the published figures are rescaled to the level in use, not used raw', (() => {
  const puzzleRule = wishlistMultiplierFor(['Puzzle']);
  const expected = (puzzleRule.surveyed / WISHLIST.surveyMedian) * WISHLIST.median;
  return Math.abs(puzzleRule.multiplier - expected) < 1e-9;
})(), `${(WISHLIST.median / WISHLIST.surveyMedian).toFixed(2)}x of what the survey printed`);
check('rescaling preserves what the survey actually measured', (() => {
  // The survey measured how far genres sit from each other, not their
  // absolute level. That spacing is the part that has to survive.
  const puzzle = wishlistMultiplierFor(['Puzzle']);
  const fourX = wishlistMultiplierFor(['4X']);
  return Math.abs((puzzle.multiplier / fourX.multiplier) - (15.9 / 7.5)) < 1e-9;
})(), 'puzzle over 4X stays 2.12x whatever the level');
check('an untagged game gets nothing to apply',
  wishlistMultiplierFor([]) === null);
// Letting table order decide this would score a game tagged Puzzle, Indie and
// Relaxing as Relaxing — because that row happens to be typed first, not
// because anything about the game says so. Steam ranks store-page tags by how
// many players applied them, so the game's own order is the signal.
check('the game\'s highest-ranked matching tag wins',
  wishlistMultiplierFor(['Puzzle', 'Indie', 'Relaxing'])?.label === 'Puzzle',
  'not whichever row sits first in the table');
check('and the same game tagged the other way round flips it',
  wishlistMultiplierFor(['Relaxing', 'Indie', 'Puzzle'])?.label === 'Relaxing');
check('tags with no published figure are skipped, not fatal',
  wishlistMultiplierFor(['Indie', 'Singleplayer', 'Survival'])?.label === 'Survival');
check('one tag only',
  wishlistMultiplierFor(['Puzzle', 'Survival'])?.label === 'Puzzle',
  'stacking two would invent a number neither row supports');

const puzzle = estimateAll({
  appId: 77, reviews: 0, released: false, releaseYear: 2026,
  followers: 1000, tags: ['Puzzle']
});
check('the genre figure moves the midpoint',
  Math.abs(puzzle.wishlists.range.mid - 1000 * wishlistMultiplierFor(['Puzzle']).multiplier) < 1,
  compact(puzzle.wishlists.range.mid));
check('but not the width',
  puzzle.wishlists.range.lo === 1000 * WISHLIST.lo && puzzle.wishlists.range.hi === 1000 * WISHLIST.hi,
  'one range for every game; genre moves where the midpoint sits inside it');
check('the midpoint stays inside its own band',
  puzzle.wishlists.range.mid > puzzle.wishlists.range.lo
  && puzzle.wishlists.range.mid < puzzle.wishlists.range.hi);
check('and the reason names the genre',
  puzzle.confidence.wishlists.reasons.some((r) => r.key === 'rWishlistGenre'));

group('Both week-one routes, and no average of them');

const twoRoutes = estimateAll({
  appId: 78, reviews: 0, released: false, releaseYear: 2026, followers: 4000
});
check('two routes are shown', twoRoutes.weekOne.paths.length === 2);
check('their disagreement is reported', twoRoutes.weekOne.disagreement > 1,
  `${twoRoutes.weekOne.disagreement.toFixed(1)}x apart`);

// This gap used to be asserted at more than 1.5x, because with a 12x follower
// ratio the two routes landed 1.9x apart and that spread was the headline
// finding: two respected heuristics, composed, disagreeing by nearly double.
//
// Measuring the follower ratio moved it. At 16.2x the wishlist route gives
// 1.78x followers against Birkett's direct 2.5x, so the two now sit 1.4x
// apart. Worth recording rather than quietly relaxing: the older rule was
// written when conversion was higher, the newer chain now nearly meets it,
// and a threshold pinned to the old coefficient would have failed here for
// the right reason and been "fixed" for the wrong one.
check('and raising the follower ratio brought the two routes closer',
  twoRoutes.weekOne.disagreement < 1.6,
  `${twoRoutes.weekOne.disagreement.toFixed(2)}x apart, against 1.9x at the surveyed 12x`);
check('and nothing in the result is a midpoint between them',
  twoRoutes.weekOne.range === undefined && twoRoutes.weekOne.span.mid === undefined,
  'anything called mid eventually gets rendered as an answer');

group('SteamCharts monthly table');

const tableHtml = `
<table class="common-table"><thead><tr>
  <th class="left">Month</th><th class="right">Avg. Players</th>
  <th class="right">Gain</th><th class="right">% Gain</th><th class="right">Peak Players</th>
</tr></thead><tbody>
  <tr class="odd"><td class="month-cell left italic">Last 30 Days</td>
    <td class="right num-f italic">59992.13</td><td class="right num-p italic">-2140.1</td>
    <td class="right italic">-3.44%</td><td class="right num italic">109715</td></tr>
  <tr><td class="month-cell left">August 2026</td>
    <td class="right num-f">62132.21</td><td class="right num-p">-5098.54</td>
    <td class="right">-7.58%</td><td class="right num">111665</td></tr>
  <tr class="odd"><td class="month-cell left">March 2024</td>
    <td class="right num-f">120000.00</td><td class="right num-p">90000.00</td>
    <td class="right">&#43;300.00%</td><td class="right num">236614</td></tr>
  <tr><td class="month-cell left">February 2016</td>
    <td class="right num-f">1594.72</td><td class="right num-p">1594.12</td>
    <td class="right">&#43;265786.67%</td><td class="right num">24496</td></tr>
</tbody></table>`;

const table = parseMonthlyHistory(tableHtml);
check('months are parsed', table.months.length === 3,
  table.months.map((m) => m.label).join(', '));
check('the rolling row is kept apart from them',
  table.recent.avgPlayers === 59992.13 && table.recent.changePct === -3.44,
  'adding it to the months would double-count the current one');
check('a positive gain survives its HTML entity',
  table.months[1].changePct === 300);
check('the peak month is located, not assumed to be the newest',
  allTimePeakMonth(table).year === 2024 && allTimePeakMonth(table).monthIndex === 2,
  "Stardew Valley's record is from March 2024, eight years after release");
check('the trend reader and the table agree, because they are one parse',
  parseRecentTrend(tableHtml).changePct === table.recent.changePct);
check('an unrecognisable page yields nothing',
  parseMonthlyHistory('<table><tr><td>nope</td></tr></table>') === null);

group('Caching and politeness');

// A live number cached for a day is not a live number: inheriting the
// day-long default here would let "Players right now" be 24 hours old.
check('the live player count passes its own short TTL',
  /GetNumberOfCurrentPlayers[\s\S]{0,600}?HISTORY\.liveTtlMs/.test(workerSrc),
  'not the day-long default');
check('and that TTL really is short',
  HISTORY.liveTtlMs < 10 * 60 * 1000, `${HISTORY.liveTtlMs / 60000} minutes`);

// Every prefix this extension writes has to be in the list the clear button
// walks. Missing one — `charts:` is the largest thing stored — leaves the
// button unable to clear it and under-reporting what it removed.
const writtenPrefixes = [...new Set(
  [...workerSrc.matchAll(/cached\(`([a-z]+):\$\{appId\}`/gi)].map((m) => `${m[1]}:`)
)];
const contentPrefixes = [...new Set(
  [...scrapeSrc.matchAll(/cachedJson\(`([A-Za-z]+):\$\{appId\}`/g)].map((m) => `${m[1]}:`)
)];
const cleared = workerSrc.slice(workerSrc.indexOf('const CACHE_PREFIXES'));
const uncleared = [...writtenPrefixes, ...contentPrefixes, 'history:']
  .filter((p) => !cleared.includes(`'${p}'`));
check('the clear button covers every cache anything writes',
  uncleared.length === 0,
  uncleared.length
    ? `missing ${uncleared.join(' ')}`
    : `${writtenPrefixes.length + contentPrefixes.length + 1} prefixes`);

// Reading the clock, sleeping, then writing the clock back does not
// rate-limit concurrent callers: they all read the same value before any of
// them writes, compute the same delay and fire together.
check('the throttle queues per bucket instead of racing on a timestamp',
  /queues\[bucket\]/.test(workerSrc) && /\.then\(async \(\) => \{/.test(workerSrc));
check('and a failed turn cannot wedge the bucket',
  /queues\[bucket\] = turn\.catch/.test(workerSrc));

group('No English left in the overlay');

// The multiplier is chosen at runtime — it changes with pre-order history —
// so a hardcoded "Peak CCU x 11.4" would be both untranslated and able to
// disagree with the number beside it.
check('the player-count row is translated',
  !/'Peak CCU/.test(overlaySrc) && /t\('nCcuRow'/.test(overlaySrc));
check('and takes the multiplier from the result',
  /nCcuRow', \[String\(ccu\.multiplier\)\]/.test(overlaySrc),
  'not from a literal that has to be kept in step');

group('Store pages that are not games');

// The manifest matches every /app/ page and Steam serves several kinds of
// thing from that path, so the review multiple has to be told which of them
// it was measured on. See APP_TYPES.
const ofType = (appType) => estimateAll({
  appId: 200, appType, reviews: 23_823, positivePct: 92, listPrice: 29.99,
  released: true, releaseYear: 2023
}, {});

check('a base game is estimated', ofType('game').units.ok);
check('DLC is not', ofType('dlc').units.reason === 'unsupported-type',
  'real sales, borrowed coefficient \u2014 the figure would look entirely plausible');
check('a soundtrack is not', ofType('music').units.reason === 'unsupported-type');
check('hardware is not', ofType('hardware').units.reason === 'unsupported-type',
  'Valve pays itself no royalty');
check('an unrecognised type is not either',
  ofType('somethingnew').units.reason === 'unsupported-type',
  'an unfamiliar page is not evidence that the game multiple fits it');
check('but a missing type still reads as a game', ofType(undefined).units.ok,
  'a failed appdetails must not turn every page into an unsupported one');

// The reason has to be the same one everywhere. "No price" on a soundtrack
// that plainly has a price would send a reader hunting for a bug in the
// price reader instead of telling them what actually happened.
const dlcPage = ofType('dlc');
check('every figure refuses for the same reason',
  [dlcPage.units, dlcPage.revenue, dlcPage.wishlists]
    .every((sec) => sec.reason === 'unsupported-type'));
check('and each carries the type, so the panel can name it',
  [dlcPage.units, dlcPage.revenue, dlcPage.wishlists]
    .every((sec) => sec.appType === 'dlc'));
check('confidence says none, not low',
  dlcPage.confidence.units.level === 'none'
    && dlcPage.confidence.overallFor(['units', 'net']) === 'none',
  'low means the estimate is poor; none means there is no estimate');
check('a declined page contributes no history point',
  makeSnapshot({ reviews: 100, followers: null }, dlcPage).units === null);

// Each declined type is declined for its own reason, and a reader who lands
// on a controller page deserves that reason rather than "not supported".
const noSentence = APP_TYPES.declined
  .filter((type) => !new RegExp(`\\b${type}: '(wType\\w+)'`).test(overlaySrc));
check('every declined type has a sentence of its own', noSentence.length === 0,
  noSentence.length ? `no sentence for: ${noSentence.join(', ')}` : `${APP_TYPES.declined.length} types`);

check('and a page that is not a game shows one sentence, not three dashes',
  /panel\.append\(notice\(reasonText\(units, 'wUnsupportedType'\)\)\)/.test(overlaySrc)
    && /function notice\(/.test(overlaySrc));

group('A demo is a page about a game that is not the game');

// Demos are free, which would double the review multiple, and have no
// sales at all. Duck Norris Tales Demo: 12 reviews, is_free, fullgame 3161930.
check('a demo with no parent named is declined',
  ofType('demo').units.reason === 'unsupported-type');

check('the demo substitution happens once, before the collector runs',
  /own\.appType === 'demo' && own\.fullGameId/.test(scrapeSrc),
  'and only after the page\u2019s own collection, so a game page keeps one round trip');
check('the parent is collected with the DOM switched off',
  /collect\(own\.fullGameId, \{ useDom: false \}\)/.test(scrapeSrc),
  'the DOM describes the demo, so it would describe the wrong app');

// Every DOM reader has to be behind that switch, or a substituted collection
// silently mixes the demo's tags and trend into the game's figures. The
// festival reader is exempt: it reads no DOM at all.
const domReaders = ['readReviewsFromDom', 'readTagsFromDom', 'readReleasedFromDom', 'readReviewTrend'];
const ungated = domReaders.filter((fn) => {
  const call = scrapeSrc.slice(scrapeSrc.indexOf('async function collect('));
  const at = call.indexOf(`${fn}()`);
  return at === -1 || !/useDom/.test(call.slice(Math.max(0, at - 90), at));
});
check('every DOM reader in the collector is behind that switch', ungated.length === 0,
  ungated.length ? `ungated: ${ungated.join(', ')}` : `${domReaders.length} readers`);

check('the demo page still says whose figures it is showing',
  /game\.viaDemo/.test(overlaySrc) && /'nViaDemo'/.test(overlaySrc));
check('and keeps the demo\u2019s own review count as a measured input',
  /'mDemoReviews'/.test(overlaySrc));

group('Localisation contract');

const desc = indie.confidence.reasons[0];
check('reasons leave the core as descriptors',
  typeof desc === 'object' && typeof desc.key === 'string' && Array.isArray(desc.params),
  desc.key);
check('descriptors carry an English fallback', typeof desc.text === 'string' && desc.text.length > 0);
check('waterfall steps carry keys and params',
  indie.revenue.steps.every((s) => typeof s.labelKey === 'string' && Array.isArray(s.labelParams)));
check('week-one routes carry keys',
  unreleased.weekOne.paths.every((p) => typeof p.labelKey === 'string'));

const source = JSON.parse(readFileSync(new URL('../tools/locales.source.json', import.meta.url), 'utf8'));
const locales = source._locales;
const msgKeys = Object.keys(source).filter((k) => !k.startsWith('_'));
check('twelve locales defined', locales.length === 12, locales.join(' '));
check('every key translated in every locale',
  msgKeys.every((k) => locales.every((l) => typeof source[k][l] === 'string' && source[k][l].trim())),
  `${msgKeys.length} keys`);
// A key nothing references is twelve translations maintained for nothing,
// and is usually what a removed feature leaves behind. Keys reach the
// interface three ways: as a quoted string in JS, as data-i18n in the options
// markup, and as Chrome's own __MSG_key__ form in the manifest, which is how
// the extension's name and description are localised.
const referenced = [
  ...['src/core', 'src/content', 'src/background', 'src/options']
    .flatMap((dir) => readdirSync(join(REPO, dir))
      .filter((f) => f.endsWith('.js'))
      .map((f) => readFileSync(join(REPO, dir, f), 'utf8'))),
  readFileSync(join(REPO, 'src/options/options.html'), 'utf8'),
  readFileSync(join(REPO, 'manifest.json'), 'utf8')
].join('\n');

const orphans = msgKeys.filter((k) =>
  !referenced.includes(`'${k}'`) && !referenced.includes(`"${k}"`)
  && !referenced.includes(`__MSG_${k}__`));
check('no translation is left with nothing referencing it', orphans.length === 0,
  orphans.length ? orphans.join(', ') : `${msgKeys.length} keys all reachable`);

check('placeholders survive translation', msgKeys.every((k) => {
  const ref = (source[k].en.match(/\$\d/g) ?? []).sort().join();
  return locales.every((l) => (source[k][l].match(/\$\d/g) ?? []).sort().join() === ref);
}));

console.log(`\n  ${failures === 0 ? 'All checks passed.' : `${failures} check(s) failed.`}\n`);
process.exit(failures === 0 ? 0 : 1);
