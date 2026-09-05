/**
 * Every magic number in this project, with the study it came from. No
 * coefficient without a `source`; `derived: true` means the direction is the
 * study's and the magnitude is ours.
 */

export const SOURCES = {
  VGI_2021: {
    label: 'Video Game Insights — 10,000+ games review-to-sales study (2021)',
    url: 'https://www.gamedeveloper.com/business/how-to-estimate-steam-video-game-sales-in-2021-',
    note: '>90% correlation between reviews and units. Multiple regression on reviews + release year + f2p gives adjusted R^2 of 78%. 2020+ band 20-55x, point 30x. States that higher prices and sports/racing lower the ratio while MMOs raise it, and says the quantification is still to come.'
  },
  GDC_NB_2020: {
    label: "GameDiscoverCo — 'New Boxleiter number', 237 dev-submitted games (2020)",
    url: 'https://www.gamedeveloper.com/business/how-that-game-sold-on-steam-using-the-nb-number-2',
    note: 'Average 63 sales/review, median 58, middle 80% between 25 and 100. Medians by launch year: pre-2017 74, 2017-2018 65, 2019 51, 2020 38.'
  },
  GAMALYTIC_RATIO_2023: {
    label: 'Gamalytic — what makes people review your game (23 Jul 2023)',
    url: 'https://gamalytic.com/blog/a-deep-dive-into-the-steam-review-ratio',
    note: 'Free games have almost twice as many sales per review. Review-score curve: above 90% positive around 30 sales/review, around 70% positive around 60, below 60% positive around 30 again. Discounted and bundled copies review less often. Genre correlates but is called not as important a factor.'
  },
  GAMALYTIC_METHOD_2023: {
    label: 'Gamalytic — method accuracy benchmark on ~120 games with public sales data (13 May 2023)',
    url: 'https://gamalytic.com/blog/how-to-accurately-estimate-steam-sales',
    note: 'Within 30% / 50% error: flat review multiple 42.7/70.9, adjusted multiples 50.4/80.3, top-seller rank 61.4/86.0, concurrents plus playtime 64.4/93.3, profile polling 77.9/97.7, weighted ensemble 76.9/99.2. Overall median sales/review ratio around 35. Games under 1,000 copies were excluded from the test.'
  },
  GDC_REVIEW_COUNT_2023: {
    label: 'GameDiscoverCo — what Steam review count tells us, on Gamalytic data (28 Aug 2023)',
    url: 'https://newsletter.gamediscover.co/p/what-steam-review-count-tells-us',
    note: 'Sales/review ratio for games under 100 reviews is 36x, against 52.8x for games with 1,000 to 10,000 reviews — almost 47% less. The largest games fall back again; no median is published for them.'
  },
  GDC_FOLLOWERS_2021: {
    label: 'GameDiscoverCo — follower-to-wishlist survey, 113 unreleased games (2021)',
    url: 'https://newsletter.gamediscover.co/p/deep-dive-how-steam-followers-and',
    note: 'Range 5x-14x, average 9.64x, median 9.6x. By promotion history: no festival 7.77x, a Steam festival 10x, a festival plus a pre-release store feature 10.45x.'
  },
  GDC_FOLLOWERS_2023: {
    label: 'GameDiscoverCo — follower-to-wishlist survey, 125+ unreleased games (Jun 2023)',
    url: 'https://newsletter.gamediscover.co/p/why-your-steam-follower-to-wishlist',
    note: 'Range 7x-20x, average 12.37x, median 12x. By tag: 4X 7.5x, turn-based strategy 9.0x, survival 9.5x, story-rich 13.2x, relaxing 15.7x, puzzle 15.9x.'
  },
  GDC_FOLLOWERS_2026: {
    label: 'GameDiscoverCo — measured follower-to-wishlist multiplier, 600+ games (May 2026)',
    url: 'https://newsletter.gamediscover.co/p/launch-success-on-steam-are-there',
    note: 'Median 16.1x, measured from GameDiscoverCo Pro data rather than surveyed, on games released in the last 12 months with over 50,000 launch wishlists, biggest outliers removed. Measured independently of this repository and of the two surveys below, and lands within 1% of OURS_FOLLOWER_RATIO.'
  },
  GDC_FOLLOWERS_2019: {
    label: "GameDiscoverCo — Steam follower counts, Jake Birkett's rule of thumb",
    url: 'https://newsletter.gamediscover.co/p/steams-follower-counts-hidden-in',
    note: 'followers x 2.5 ~= week-one sales. Older heuristic, and the article says it can vary quite a lot between games. Kept as an independent cross-check.'
  },
  GDC_CONVERSION_2025: {
    label: 'GameDiscoverCo — the state of Steam wishlist conversions, 2024-2025 (17 Oct 2025)',
    url: 'https://newsletter.gamediscover.co/p/the-state-of-steam-wishlist-conversions',
    note: 'Median week-1 sales 0.11x the launch wishlist balance; 0.15x for games with 25,000+ wishlists, 0.10x for games priced above $10. Outcomes vary by 10-20x, not 10-20%.'
  },
  STEAM_TOP_WISHLISTS: {
    label: "Steam store — the store's own Top Wishlists ordering",
    url: 'https://store.steampowered.com/search/?filter=popularwishlist',
    note: 'A public ranking of unreleased games by wishlists. Ordinal only: Valve publishes no counts, and does not document what the ordering weighs. Released games do not appear.'
  },
  OURS_WISHLIST_RANKS: {
    label: 'Measured in this repository — daily snapshot of the Top Wishlists ordering',
    url: 'https://github.com/q-sn/steam-revenue-wishlist-estimator/blob/main/tools/crawl-wishlist-ranks.mjs',
    note: 'Run `node tools/crawl-wishlist-ranks.mjs` to reproduce. Walks the store ordering in pages of 100 with ignore_preferences=1 and records the app id at each position. On 5 Sep 2026: 5,574 games ranked out of 15,343 announced. Ordering is by cumulative wishlist count, not velocity — regressing log(rank) on log(announced) and log(appid) leaves page age insignificant at t = -0.09 to -0.84 — and is region-invariant, with 0 order inversions across us/de/jp/br. Regional and preference differences are pure deletions from one global order.'
  },
  STEAMWORKS_FOLLOWERS: {
    label: 'Steamworks documentation — Followers',
    url: 'https://partner.steamgames.com/doc/marketing/followers',
    note: "Following a game joins a mostly hidden group; the count is shown as that group's member count."
  },
  VALVE_REV_SHARE: {
    label: 'Valve — new revenue share tiers, Steam Distribution Agreement (announced Nov 2018, effective on sales from 1 Oct 2018)',
    url: 'https://steamcommunity.com/groups/steamworks/announcements/detail/1697191267930157838',
    note: '30% to $10M, 25% from $10M to $50M, 20% above $50M. Per app, marginal not retroactive. The threshold counts the app together with its DLC, in-game sales and Community Marketplace game fees.'
  },
  VALVE_ADJUSTED_GROSS: {
    label: 'Steamworks documentation — sales reporting and adjusted gross revenue',
    url: 'https://partner.steamgames.com/doc/finance/reporting/sales_reporting',
    note: 'Adjusted gross revenue is gross revenue less applicable adjustments. Gross includes VAT and sales tax collected at checkout; adjustments back out refunds and chargebacks. The revenue share is charged on what is left, not on the sticker price.'
  },
  GDC_REFUNDS_2024: {
    label: 'GameDiscoverCo — Steam refunds and the hidden costs of getting to net',
    url: 'https://newsletter.gamediscover.co/p/game-refunds-and-the-hidden-costs',
    note: 'A 2024 developer survey of around 150 respondents found a median refund rate of 9.5% and an average of 10.8%, with an Early Access median of 12.4% and Chinese-market rates of 15-28%. The No More Robots portfolio piece reports 5-8% by units and 6.5-11% by revenue, with monthly extremes of 3% and 17%.'
  },
  IMMUTABLE_NET_2026: {
    label: 'Immutable — how much does Steam take, net-per-unit waterfall (vendor guide, 2026)',
    url: 'https://www.immutable.com/guides/how-much-does-steam-take',
    note: 'Secondary source, cited for the shape of the waterfall and its two worked scenarios: a US/EU-concentrated release keeps around 45% of list at a regional/VAT factor of 0.88, a globally distributed one around 39.5% at 0.78 — the roughly 22% that following Steam suggested regional prices costs. Emerging markets are put at 40-70% below USD list.'
  },
  STEAMSPY_PRIVACY: {
    label: 'SteamSpy — about page, after the April 2018 Steam profile privacy change',
    url: 'https://steamspy.com/about',
    note: 'Owner figures are extrapolated from a sample of public Steam profiles at 98% confidence. Valve made libraries private by default in April 2018 and the sample never fully recovered; the keyless API buckets owners into ranges spanning 2x or more, and small games are worst affected.'
  },
  GDC_CCU_2025: {
    label: 'GameDiscoverCo — launch players against week-one sales, top 50 Steam debuts of March 2025',
    url: 'https://newsletter.gamediscover.co/p/how-your-steam-launch-players-relate',
    note: 'Week-one sales against the ALL-TIME peak concurrent count: median 11.4x overall, 14.1x without pre-orders, 7.8x with. Against the day-one peak the medians are different again: 21.8x, 14.1x, 15.4x. Median time from launch to the all-time peak was 2.5 days without pre-orders and 4 days with. Variance of 50% or more in both directions.'
  },
  STEAM_RECENT_REVIEWS: {
    label: 'Valve — customer review system updated to show recent reviews and a summary (May 2016)',
    url: 'https://store.steampowered.com/oldnews/21695',
    note: 'The recent score covers a fixed 30-day window and is withheld until a game has been on Steam for 45 days with enough reviews inside that window.'
  },
  OURS_OWNER_QUALITY: {
    label: 'Measured in this repository — the SteamSpy owner band against disclosed sales',
    url: 'https://github.com/q-sn/steam-revenue-wishlist-estimator/blob/main/test/fixtures.json',
    note: 'One-off measurement, from SteamSpy appdetails against the disclosed units in test/fixtures.json. SteamSpy publishes no post-2018 accuracy figure, so its bucket today is compared against units developers disclosed a mean of 4.5 years ago; owners can only exceed units, so the bucket should contain or exceed every figure. Bucket midpoint over disclosed units, by disclosed size: 1M+ median 1.58x (12 games), 100k-1M median 3.39x (12), under 100k median 4.18x (6, ranging 0.21x to 15.81x, one of them arithmetically impossible). One-sided: it can show a bucket too low, never too high.'
  },
  OURS_WISHLIST_MODEL: {
    label: 'Measured in this repository — one model of rank, announcement age and the milestone floor',
    url: 'https://github.com/q-sn/steam-revenue-wishlist-estimator/blob/main/tools/calibrate-wishlist-model.mjs',
    note: 'Run `node tools/calibrate-wishlist-model.mjs` to reproduce. One median (L1) regression over every disclosure at any age, one anchor per game, 1,051 posts across 648 ranked games: log(wishlists) = log A - B*log(rank + Q) - ALPHA*log(1 + age/90) - RUNGK*gap, where gap is the log-distance to the next rung on the ladder studios post at and is zero for off-ladder figures. Gives A 503,667,749, B 1.31652, Q 84.699, ALPHA 0.35859. Ranks come from an ignore_preferences=1 crawl because the store default hides 415 of 5,574 positions non-uniformly, from 1.4% of the first 500 to 12.4% of 3001-3500. Held-out error over 5x10 folds split by game: median 12.3% under 30 days, 14.7% under 90, 19.4% under a year, 21.9% at any age. Band 0.695-1.294 is the p10 and p90 of that out-of-sample residual, covering 76%.'
  },
  OURS_ANNOUNCEMENT_FLOOR: {
    label: 'Measured in this repository — how far a wishlist announcement undershoots the true count',
    url: 'https://github.com/q-sn/steam-revenue-wishlist-estimator/blob/main/tools/calibrate-wishlist-model.mjs',
    note: 'A studio posting "20,000 wishlists" has just crossed 20,000, so every announced figure is a floor. Estimated inside the joint fit as RUNGK 0.15942 against a mean rung gap of 0.2393 in logs, which is x1.039 at the centre. Cross-checked directly: off-ladder figures such as "114,000" are not milestone crossings, and their median residual sits x1.06 above on-ladder figures at the same ranks (x1.03 within 60 days, x1.16 over all ages). The shipped model carried x1.21 here, which cross-validation scored as measurably worse than applying nothing at all.'
  },
  OURS_WISHLIST_GROWTH: {
    label: 'Measured in this repository — how fast an unreleased game accumulates wishlists',
    url: 'https://github.com/q-sn/steam-revenue-wishlist-estimator/blob/main/tools/calibrate-wishlist-model.mjs',
    note: 'Growth is the age term of the model above, so the curve and the carry-forward cannot contradict each other: x(1 + age/90)^0.35859, which is x1.34 at 90 days and x1.79 at a year. Deceleration is real and a constant percent per day is wrong at every age — it has to undershoot young anchors to avoid exploding on old ones. Confirmed three ways sharing no estimator: 0.3586 from the joint fit, 0.3604 from a curve fitted only on 30-day anchors and profiled against older announcements, 0.3639 from a p50 pinball fit on the cross-validated residual. Not measured from consecutive posts by the same studio divided by elapsed days: that is a regression through the origin, and the same regression with an intercept reads 0.119%/day on an intercept of x1.75, because the size of a leg is set by the milestone ladder and only its duration by growth.'
  },
  OURS_FOLLOWER_RATIO: {
    label: 'Measured in this repository — followers against wishlist counts developers announced',
    url: 'https://github.com/q-sn/steam-revenue-wishlist-estimator/blob/main/tools/calibrate-follower-ratio.mjs',
    note: 'Run `node tools/calibrate-follower-ratio.mjs` to reproduce. Divides a wishlist figure a studio posted on its own store page by that game\'s public follower count, one game per disclosure, restricted to figures announced within the window so the two readings describe the same week. Over 83 games announced within 30 days: min 4.5x, p10 9.6x, median 16.2x, p90 32.8x, max 79.7x. Stable across windows and ranks — 16.6x at 14 days (n=38), 15.3x at 90 days (n=200), 15.7x for ranks 201-1000 and 15.3x below rank 3000. Not stable by size, and no longer claimed to be: a 60-game re-measurement puts the slope of ln(ratio) on ln(wishlists) at +0.073 with a standard error of 0.049, indistinguishable from flat. Follower counts in the sample run from 132 to 12,036, so this is measured on small and mid-size games rather than on the head of the chart. Cross-checked against GDC_FOLLOWERS_2026, which measures 16.1x on a different population by a different method.'
  },
  OURS_PLAYTIME_BIAS: {
    label: 'Measured in this repository — reviewer playtime against average playtime',
    url: 'https://github.com/q-sn/steam-revenue-wishlist-estimator/blob/main/test/fixtures.json',
    note: 'One-off measurement, from SteamCharts monthly concurrents against the disclosed units in test/fixtures.json. For each game, SteamCharts player-hours up to the disclosure date divided by the disclosed unit count gives the true average playtime with no estimation on either side, compared against the median playtime-at-review over the 90 days before that date. Over 26 games: min 0.50x, p10 0.78x, median 1.09x, p90 1.52x, max 2.07x.'
  }
};

/**
 * Base reviews-to-units multiplier by release year; the oldest rows are the
 * softest. Blended from VGI_2021 and GDC_NB_2020.
 */
export const BASE_MULTIPLIER = [
  { from: 2020, to: 9999, lo: 20, point: 30, hi: 55, source: 'VGI_2021' },
  { from: 2019, to: 2019, lo: 30, point: 51, hi: 70, source: 'GDC_NB_2020' },
  { from: 2017, to: 2018, lo: 35, point: 65, hi: 85, source: 'GDC_NB_2020' },
  { from: 2014, to: 2016, lo: 40, point: 74, hi: 100, source: 'GDC_NB_2020' },
  { from: 0, to: 2013, lo: 40, point: 80, hi: 110, source: 'VGI_2021' }
];

/** Multiplicative adjustments on top of the base multiplier. */
export const ADJUSTMENTS = {
  isFree: { factor: 2.0, label: 'Free to play', source: 'GAMALYTIC_RATIO_2023' },

  /** Keyed off the list price, never off the current sale price. */
  price: [
    { maxPrice: 10, factor: 1.15, label: 'Priced under $10', source: 'GAMALYTIC_RATIO_2023', derived: true },
    { maxPrice: 30, factor: 1.0, label: 'Priced $10-$30', source: 'GAMALYTIC_RATIO_2023' },
    { maxPrice: Infinity, factor: 0.85, label: 'Priced over $30', source: 'VGI_2021', derived: true }
  ],

  reviewScore: [
    { maxPct: 65, factor: 1.05, label: 'Under 65% positive', source: 'GAMALYTIC_RATIO_2023' },
    { maxPct: 80, factor: 1.35, label: '65-80% positive', source: 'GAMALYTIC_RATIO_2023' },
    { maxPct: 90, factor: 1.0, label: '80-90% positive', source: 'GAMALYTIC_RATIO_2023' },
    { maxPct: 101, factor: 0.9, label: 'Over 90% positive', source: 'GAMALYTIC_RATIO_2023' }
  ],

  tags: [
    { match: ['mmorpg', 'massively multiplayer'], factor: 1.3, label: 'MMO', source: 'VGI_2021', derived: true },
    { match: ['visual novel'], factor: 1.5, label: 'Visual novel', source: 'GAMALYTIC_RATIO_2023', derived: true },
    { match: ['sports', 'racing'], factor: 0.8, label: 'Sports or racing', source: 'VGI_2021', derived: true }
  ],

  /** Lifetime discount depth, proxied by today's cut past `thresholdPct`. */
  heavyDiscount: {
    thresholdPct: 50,
    factor: 1.2,
    label: 'Discounts deeply',
    source: 'GAMALYTIC_RATIO_2023',
    derived: true
  }
};

/**
 * Sales per review also tracks review count. Only the shape of
 * GDC_REVIEW_COUNT_2023 carries over: the factors are sqrt(52.8/36) = 1.211
 * and its inverse. Above 10,000 reviews returns to neutral.
 */
export const REVIEW_COUNT_BANDS = [
  { maxReviews: 100, factor: 0.83, label: 'Under 100 reviews', source: 'GDC_REVIEW_COUNT_2023' },
  { maxReviews: 1_000, factor: 1.0, label: '100-1,000 reviews', source: 'GDC_REVIEW_COUNT_2023', derived: true },
  { maxReviews: 10_000, factor: 1.21, label: '1,000-10,000 reviews', source: 'GDC_REVIEW_COUNT_2023' },
  { maxReviews: Infinity, factor: 1.0, label: 'Over 10,000 reviews', source: 'GDC_REVIEW_COUNT_2023', derived: true }
];

/**
 * Which store pages get a number. The review multiple was measured on base
 * games, so every other /app/ type declines, including unlisted ones.
 */
export const APP_TYPES = {
  /** The only type the published multiples were measured on. */
  estimable: 'game',
  /** What Steam has served from /app/ that is not a game. */
  declined: ['demo', 'dlc', 'music', 'video', 'series', 'episode', 'hardware', 'mod', 'advertising']
};

/**
 * No number below MIN_REVIEWS. Between MIN and CONFIDENT the band is widened
 * by LOW_SAMPLE_WIDEN rather than withheld.
 */
export const REVIEW_GATES = {
  MIN_REVIEWS: 10,
  CONFIDENT_REVIEWS: 200,
  LOW_SAMPLE_WIDEN: { lo: 0.75, hi: 1.4 }
};

/** Refund rate, as a share of gross. Fractions, not percent. See GDC_REFUNDS_2024. */
export const REFUNDS = { lo: 0.06, mid: 0.095, hi: 0.13, source: 'GDC_REFUNDS_2024' };

/** Revenue waterfall defaults. All user-editable in the options page. */
export const REVENUE_DEFAULTS = {
  avgDiscount: 0.2,
  regionalProfile: 'auto',
  refundRate: REFUNDS.mid,
  source: 'IMMUTABLE_NET_2026'
};

/**
 * Regional pricing and VAT combined, as a fraction of US list price.
 *
 * revenue.js widens the band by stepping to the neighbouring profile, so
 * REGIONAL_ORDER must run most to least favourable with nothing missing.
 */
export const REGIONAL_PROFILES = {
  'us-eu': { factor: 0.88, label: 'Mostly US and EU buyers', source: 'IMMUTABLE_NET_2026' },
  mixed: { factor: 0.78, label: 'Mixed global audience', source: 'IMMUTABLE_NET_2026' },
  emerging: { factor: 0.6, label: 'Heavily CIS, SEA, LATAM, China', source: 'IMMUTABLE_NET_2026', derived: true }
};

/** Most to least favourable realised price. */
export const REGIONAL_ORDER = ['us-eu', 'mixed', 'emerging'];

/**
 * The regional profile derived from the language mix of a game's reviews. A
 * proxy; the options dropdown overrides it.
 */
export const LANGUAGE_REGIONS = {
  /**
   * Markets IMMUTABLE_NET_2026 names as priced well below US list. Spanish is
   * absent on purpose: Spain is a euro market near list, `latam` is not.
   */
  discounted: [
    'schinese', 'tchinese', 'russian', 'ukrainian', 'brazilian', 'latam',
    'turkish', 'thai', 'vietnamese', 'indonesian'
  ],
  /**
   * Share of all reviews from those markets that tips a game into the next
   * profile. Every other language counts as a full-price market.
   */
  thresholds: { mixed: 0.2, emerging: 0.5 },
  // Below this many reviews in total the mix is too thin to read.
  minReviews: 100,
  source: 'IMMUTABLE_NET_2026',
  derived: true
};

/** How wide the revenue band gets from the waterfall's own assumptions. */
export const REVENUE_UNCERTAINTY = {
  avgDiscount: { lo: 0.1, hi: 0.3, source: 'IMMUTABLE_NET_2026', derived: true },
  refundRate: { lo: REFUNDS.lo, hi: REFUNDS.hi, source: 'GDC_REFUNDS_2024' },
  // How many profiles either side of the chosen one the regional leg steps.
  regionalNeighbourStep: 1
};

/** Valve's tiered royalty. Marginal, per app, applied after VAT and refunds. */
export const STEAM_TIERS = [
  { upTo: 10_000_000, rate: 0.3 },
  { upTo: 50_000_000, rate: 0.25 },
  { upTo: Infinity, rate: 0.2 }
];

/** Followers -> wishlists. Pre-release only. */
export const WISHLIST = {
  /**
   * See OURS_FOLLOWER_RATIO. lo and hi are the p10 and p90 of that
   * measurement, not its min and max; read the median as a floor.
   */
  lo: 9.6,
  hi: 32.8,
  median: 16.2,

  /**
   * Promotion history, as each group's distance from its own survey median of
   * 9.6x. Always 'unknown' in practice; a caller that knows can pass it.
   */
  contexts: {
    none: { factor: 7.77 / 9.6, label: 'No festival or feature', source: 'GDC_FOLLOWERS_2021' },
    unknown: { factor: 1, label: 'Unknown promotion history' },
    nextFest: { factor: 10.0 / 9.6, label: 'Appeared in a Steam festival', source: 'GDC_FOLLOWERS_2021' },
    featured: { factor: 10.45 / 9.6, label: 'Festival plus a store feature', source: 'GDC_FOLLOWERS_2021' }
  },

  /**
   * Per-tag multipliers from GDC_FOLLOWERS_2023; divide by `surveyMedian`
   * before use. One row applies — see matchTagRule in tags.js.
   */
  genres: [
    { match: ['4x'], multiplier: 7.5, label: '4X strategy', source: 'GDC_FOLLOWERS_2023' },
    { match: ['turn-based strategy', 'turn based strategy'], multiplier: 9.0, label: 'Turn-based strategy', source: 'GDC_FOLLOWERS_2023' },
    { match: ['survival'], multiplier: 9.5, label: 'Survival', source: 'GDC_FOLLOWERS_2023' },
    { match: ['story rich', 'story-rich'], multiplier: 13.2, label: 'Story rich', source: 'GDC_FOLLOWERS_2023' },
    { match: ['relaxing'], multiplier: 15.7, label: 'Relaxing', source: 'GDC_FOLLOWERS_2023' },
    { match: ['puzzle'], multiplier: 15.9, label: 'Puzzle', source: 'GDC_FOLLOWERS_2023' }
  ],

  /** The median `genres` was published against; divide a genre row by this. */
  surveyMedian: 12.0,

  /** Where the level in force came from. One declaration for every caption. */
  level: {
    originKey: 'oMeasuredHere',
    originParams: ['83'],
    originText: 'measured here on 83 announced figures',
    source: 'OURS_FOLLOWER_RATIO'
  },

  /** The genre shape is still the survey's; only the level is ours. */
  source: 'OURS_FOLLOWER_RATIO'
};

/**
 * Rank in Steam's Top Wishlists ordering to a count: a / (rank + q)^b.
 * `q` is the head offset — the top of the list is crowded, so rank 1 and rank
 * 20 are not 20x apart. See OURS_WISHLIST_MODEL.
 */
export const WISHLIST_CURVE = {
  a: 503_667_749,
  q: 84.699,
  b: 1.31652,

  /** p10 and p90 of the held-out log residual. Covers 76% of anchors. */
  band: { lo: 0.695, hi: 1.294 },

  /** Positions in the ignore_preferences=1 snapshot the fit was made on. */
  listed: 5574,

  /** Announcements the fit stands on, for the caption that cites it. */
  fittedOn: 1051,

  source: 'OURS_WISHLIST_MODEL'
};

/**
 * An announced figure carried forward: announced * floor * (1 + age/tau)^alpha.
 * `alpha` is the age term of the same joint fit as WISHLIST_CURVE, so the two
 * legs share one growth law. `tau` is pinned, not fitted. `floor` corrects for
 * the announcement being a milestone crossing. See OURS_WISHLIST_MODEL.
 */
export const WISHLIST_SAID = {
  tau: 90,
  alpha: 0.35859,
  floor: 1.0389,
  loFloor: 0.8583,
  loAlpha: 0.13356,
  hiFloor: 1.35065,
  hiAlpha: 0.89203,

  /** Published beside the ordering by the same daily job, newest figure per game. */
  feed: {
    url: 'https://cdn.jsdelivr.net/gh/q-sn/steam-revenue-wishlist-estimator@data/wishlist-said.json',
    fallbackUrl: 'https://raw.githubusercontent.com/q-sn/steam-revenue-wishlist-estimator/data/wishlist-said.json',
    refreshMs: 12 * 60 * 60 * 1000
  },

  source: 'OURS_WISHLIST_MODEL'
};

export const WISHLIST_RANK = {
  /**
   * A file, not a crawl: .github/workflows/wishlist-ranks.yml reads the
   * ordering once a day for everybody and commits it. Raw GitHub is the CDN
   * fallback.
   */
  feed: {
    url: 'https://cdn.jsdelivr.net/gh/q-sn/steam-revenue-wishlist-estimator@data/wishlist-ranks.json',
    fallbackUrl: 'https://raw.githubusercontent.com/q-sn/steam-revenue-wishlist-estimator/data/wishlist-ranks.json',
    // Twice the publishing cadence; jsDelivr caches a branch for 12 hours.
    refreshMs: 12 * 60 * 60 * 1000
  },

  /** How stale a snapshot may be before it is dropped. Rebuilt daily. */
  maxAgeMs: 3 * 24 * 60 * 60 * 1000,

  source: 'OURS_WISHLIST_RANKS'
};

/** Two independent published routes from public data to week-one sales. */
export const WEEK_ONE = {
  fromWishlists: { factor: 0.11, label: 'Wishlists x 0.11', source: 'GDC_CONVERSION_2025' },
  fromFollowers: { factor: 2.5, label: 'Followers x 2.5', source: 'GDC_FOLLOWERS_2019' }
};

/** Confidence thresholds, as the ratio of a band's high end to its low end. */
export const CONFIDENCE = {
  good: 2.2,
  fair: 3.5,

  /**
   * A ceiling on the wishlist grade, not the driver of it. Measured over the
   * whole ordering the band is 1.86x with the ranking alone, 2.11x with a
   * follower count too, and 2.31x with a stale announcement, so width barely
   * varies; only a contradiction pushes it past 3.5x.
   */
  wishlists: {
    good: 2.0,
    fair: 3.5,
    source: 'OURS_WISHLIST_MODEL',
    derived: true
  }
};

/**
 * SteamSpy owner bands into paid units. Owners are a ceiling: the band
 * includes keys, giveaways and bundles. The share to remove is read from the
 * reviews API, bounded by `floor` and `ceiling`.
 */
export const OWNERS_TO_UNITS = {
  // Used when the key share cannot be read at all.
  fallback: 0.9,
  floor: 0.5,
  ceiling: 0.98,

  /**
   * The keyless API answers on a fixed ladder (20k, 50k, 100k, ...) whose
   * bottom rung has no lower edge. This step gives it an implied floor.
   */
  ladderStep: 2.5,

  source: 'GAMALYTIC_METHOD_2023'
};

/**
 * Ensemble weights. Only the review multiple and the owner band are averaged;
 * peak-CCU and player-hours stay cross-checks. Owner weight scales with band
 * size; see STEAMSPY_PRIVACY.
 */
export const ENSEMBLE = {
  boxleiter: { base: 1.0, lowSamplePenalty: 0.6 },
  owners: {
    // Below this many owners the profile sample is too thin to trust.
    minTrusted: 20_000,
    maxTrusted: 200_000,
    weightAtMin: 0.15,
    weightAtMax: 0.8,
    source: 'STEAMSPY_PRIVACY',
    // Checked for direction against OURS_OWNER_QUALITY, not fitted to it.
    quality: 'OURS_OWNER_QUALITY'
  },
  // No playtime entry; it is a cross-check, not a leg. See PLAYTIME.
  // Midpoints combine as a weighted geometric mean.
  useGeometricMean: true,

  /**
   * The gap between the nearest band edges that counts as a contradiction
   * rather than a near miss. Between bands, not midpoints: a SteamSpy bucket's
   * centre is where the ladder's edges fall. See GAMALYTIC_METHOD_2023.
   */
  alarmGap: 1.86,

  source: 'GAMALYTIC_METHOD_2023',
  derived: true
};

/**
 * Peak concurrent players as a week-one cross-check. Feed it the all-time
 * peak, which is what GDC_CCU_2025 measured against — not SteamSpy's `ccu`.
 * Applies only within `launchPeakWindowDays` of release.
 */
export const CCU = {
  launchPeakWindowDays: 60,
  multiplier: { withPreorders: 7.8, withoutPreorders: 14.1, unknown: 11.4 },
  // GameDiscoverCo flag variance of 50% or more in both directions.
  variance: 0.5,
  source: 'GDC_CCU_2025'
};

/**
 * Units implied by concurrent-player history and playtime. A cross-check only:
 * the divisor is the mean playtime of all owners, which no public source
 * reports, and the reviewer figure standing in for it is a median of recent
 * buyers. See OURS_PLAYTIME_BIAS.
 */
export const PLAYTIME = {
  // The whole measured range over 26 fixtures, not its middle 80%.
  biasRange: { lo: 0.5, mid: 1.09, hi: 2.07 },
  // Fewer reviews than this and the median is not worth having.
  minSample: 20,
  // A month averaging below this is noise from a pre-release build.
  minMonthlyAverage: 0.5,
  source: 'OURS_PLAYTIME_BIAS'
};

/** Local snapshots, so the overlay can show what changed since the last visit. */
export const HISTORY = {
  maxPoints: 60,
  minGapMs: 12 * 60 * 60 * 1000,
  cacheTtlMs: 24 * 60 * 60 * 1000,
  // A live player count cached for a day is not a live player count.
  liveTtlMs: 3 * 60 * 1000
};

/** Steam's recent-review window, in days. Fixed by Valve, not by us. */
export const RECENT_REVIEW_WINDOW_DAYS = 30;
