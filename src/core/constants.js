/**
 * Every magic number in this project lives here, with the study it came from.
 *
 * Rule for contributors: no coefficient without a `source`. If you cannot cite
 * where a number came from, it does not belong in an estimator that claims to
 * be honest about its uncertainty.
 *
 * A second rule follows from the first. Some published findings give a
 * direction but no magnitude — "MMOs have higher multiples", "cheaper games
 * sell more copies per review" — and the number we pick to express that
 * direction is ours, not the study's. Those rows carry `derived: true`. It is
 * the difference between "the survey measured this" and "the survey measured
 * that this exists, and we sized it ourselves", and a file claiming full
 * traceability has to show which is which.
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
  VGI_WISHLISTS_2025: {
    label: 'Video Game Insights — "The importance of wishlists in 2025", games launched from Mar 2024 with 20+ reviews',
    url: 'https://app.sensortower.com/vgi/assets/reports/VGI_Wishlist_Report_July_2025.pdf',
    note: 'Distribution of wishlists at launch over 12 months: under 1,000 29%, 1,000-10,000 37%, 10,000-50,000 23%, 50,000-100,000 5%, above 100,000 6%. That top 6% breaks down as 253 games at 100k-500k, 26 at 500k-1M and 22 above 1M. Largest of the period Black Myth: Wukong at 4.3M. Correlation of launch wishlists with month-one units 70% overall but only 17% below 100,000 wishlists. Pre-launch accumulation, indexed to launch = 100%, runs 71% at 17 weeks out to 94% at one week out; that curve is measured on the top 50 games by launch wishlists.'
  },
  STEAM_TOP_WISHLISTS: {
    label: "Steam store — the store's own Top Wishlists ordering",
    url: 'https://store.steampowered.com/search/?filter=popularwishlist',
    note: 'A public ranking of unreleased games by wishlists. Ordinal only: Valve publishes no counts, and does not document what the ordering weighs. Released games do not appear.'
  },
  OURS_WISHLIST_RANKS: {
    label: 'Measured in this repository — daily snapshot of the Top Wishlists ordering',
    url: 'https://github.com/q-sn/steam-revenue-wishlist-estimator/blob/main/tools/crawl-wishlist-ranks.mjs',
    note: 'Run `node tools/crawl-wishlist-ranks.mjs` to reproduce. Walks the store ordering in pages of 100 and records the app id at each position, together with the size of the ordering and the number of unreleased games it is drawn from. On 5 Sep 2026: 5,262 games ranked out of 15,343 announced, so the ordering covers the top 34% of what Steam has a page for.'
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
    url: 'https://github.com/q-sn/steam-revenue-wishlist-estimator/blob/main/tools/calibrate-owners.mjs',
    note: 'Run `node tools/calibrate-owners.mjs` to reproduce. SteamSpy publishes no post-2018 accuracy figure, so its bucket today is compared against units developers disclosed a mean of 4.5 years ago; owners can only exceed units, so the bucket should contain or exceed every figure. Bucket midpoint over disclosed units, by disclosed size: 1M+ median 1.58x (12 games), 100k-1M median 3.39x (12), under 100k median 4.18x (6, ranging 0.21x to 15.81x, one of them arithmetically impossible). One-sided: it can show a bucket too low, never too high.'
  },
  OURS_PLAYTIME_BIAS: {
    label: 'Measured in this repository — reviewer playtime against average playtime',
    url: 'https://github.com/q-sn/steam-revenue-wishlist-estimator/blob/main/tools/calibrate-playtime.mjs',
    note: 'Run `node tools/calibrate-playtime.mjs` to reproduce. For each game in test/fixtures.json it divides SteamCharts player-hours up to the disclosure date by the disclosed unit count, giving the true average playtime with no estimation on either side, and compares it against the median playtime-at-review over the 90 days before that date. Over 26 games: min 0.50x, p10 0.78x, median 1.09x, p90 1.52x, max 2.07x.'
  }
};

/**
 * Base reviews-to-units multiplier by year of release.
 *
 * Steam added a "would you like to review this?" prompt in late October 2019,
 * which roughly halved the sales-per-review ratio. Games released before that
 * also kept accumulating reviews afterwards, so old games drift downward over
 * time. Treat pre-2017 numbers as the softest part of this table.
 *
 * Blended from VGI_2021 (2020+ gives 20-55x with a point of 30x) and
 * GDC_NB_2020, whose per-year medians are 74 for pre-2017, 65 for 2017-2018
 * and 51 for 2019.
 */
export const BASE_MULTIPLIER = [
  { from: 2020, to: 9999, lo: 20, point: 30, hi: 55, source: 'VGI_2021' },
  { from: 2019, to: 2019, lo: 30, point: 51, hi: 70, source: 'GDC_NB_2020' },
  { from: 2017, to: 2018, lo: 35, point: 65, hi: 85, source: 'GDC_NB_2020' },
  { from: 2014, to: 2016, lo: 40, point: 74, hi: 100, source: 'GDC_NB_2020' },
  { from: 0, to: 2013, lo: 40, point: 80, hi: 110, source: 'VGI_2021' }
];

/**
 * Multiplicative adjustments applied on top of the base multiplier.
 *
 * The review-score curve is the least certain sourced block here: it is
 * non-monotonic (very positive and very negative games both sit low,
 * mid-scoring games sit high) and the base table already reflects a mix
 * skewed toward 80%+ games. Coefficients are deliberately damped relative to
 * the raw study medians.
 *
 * Rows marked `derived` take their direction from the cited study and their
 * size from us. VGI_2021 says in as many words that it has not quantified
 * price or genre yet, and GAMALYTIC_RATIO_2023 presents genre as a chart with
 * no table before concluding that genre is a weak factor. Sized
 * conservatively for that reason.
 */
export const ADJUSTMENTS = {
  isFree: { factor: 2.0, label: 'Free to play', source: 'GAMALYTIC_RATIO_2023' },

  /**
   * Keyed off the list price, never off the current sale price.
   *
   * This describes the price point a game sells at over its life. Reading it
   * from `price_overview.final` scores a $40 game as a sub-$10 game for the
   * length of every discount, moving the estimate by 1.35x on a fact about
   * the calendar rather than about the game.
   */
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

  /**
   * Discount depth over a game's life, not the banner on the page today.
   *
   * GAMALYTIC_RATIO_2023 measures games that "were significantly discounted",
   * which is a property of a price history, and no free source publishes price
   * history. How far below list a game sits right now is a weak proxy for it:
   * a game at -75% today is more likely than not to be a game that discounts
   * deeply. Applied only when the current cut is deep enough to say something,
   * and the size of it is ours.
   */
  heavyDiscount: {
    thresholdPct: 50,
    factor: 1.2,
    label: 'Discounts deeply',
    source: 'GAMALYTIC_RATIO_2023',
    derived: true
  }
};

/**
 * Sales per review also tracks how many reviews a game has.
 *
 * GDC_REVIEW_COUNT_2023 puts games under 100 reviews at 36x against 52.8x for
 * games with 1,000 to 10,000 — the mid-size band sits 1.47x above the small
 * one. That within-dataset ratio is the durable part of the finding. The
 * absolute levels belong to Gamalytic's 2023 dataset, whose overall median
 * ratio is about 35, and cannot be dropped in beside a base table blended
 * from two other vintages — the same trap the wishlist festival block
 * describes. So the shape carries over and the level does not, anchored at the
 * geometric centre of the published pair so this table changes the spread
 * between sizes without moving the overall level.
 *
 * sqrt(52.8 / 36) = 1.211, and 1 / 1.211 = 0.826.
 *
 * The same sources say the very largest games fall back toward the small-game
 * ratio — Elden Ring is given as roughly 20 sales per review — but publish no
 * median for that group, so above 10,000 reviews this returns to neutral
 * rather than inventing a decline.
 */
export const REVIEW_COUNT_BANDS = [
  { maxReviews: 100, factor: 0.83, label: 'Under 100 reviews', source: 'GDC_REVIEW_COUNT_2023' },
  { maxReviews: 1_000, factor: 1.0, label: '100-1,000 reviews', source: 'GDC_REVIEW_COUNT_2023', derived: true },
  { maxReviews: 10_000, factor: 1.21, label: '1,000-10,000 reviews', source: 'GDC_REVIEW_COUNT_2023' },
  { maxReviews: Infinity, factor: 1.0, label: 'Over 10,000 reviews', source: 'GDC_REVIEW_COUNT_2023', derived: true }
];

/**
 * Which store pages the estimators apply to.
 *
 * The manifest matches every /app/ page, and Steam serves several different
 * kinds of thing from that path. Asking the store API for a handful of them
 * shows what reaches us:
 *
 *   game      Cyberpunk 2077                 977,729 reviews   $59.99
 *   dlc       Cyberpunk: Phantom Liberty      23,823 reviews   $29.99
 *   music     Terraria: Official Soundtrack      548 reviews    $2.49
 *   hardware  Steam Deck                          20 reviews  $399.00
 *   demo      Duck Norris Tales Demo              12 reviews      free
 *
 * The review multiple was calibrated on base games, so only `game` gets a
 * number. The rest are wrong in different ways and deserve to be told apart:
 *
 * - `demo` has no sales at all, and its `is_free` flag would double the
 *   multiplier on top. Where Steam names the parent game we estimate that
 *   instead; where it does not, there is nothing to estimate.
 * - `dlc` and `music` do have sales. Only the coefficient is borrowed: DLC is
 *   bought by people who already own the base game and have often already
 *   reviewed it, so its reviews-per-sale ratio is its own and nobody has
 *   published it. The figure would look entirely plausible, which is worse
 *   than an obvious error.
 * - `hardware` is not sold under the revenue share at all — Valve pays itself
 *   no royalty — and no review multiple was ever measured for devices.
 *
 * Anything not listed still declines, because an unrecognised type is not
 * evidence that the game multiple applies to it.
 */
export const APP_TYPES = {
  /** The only type the published multiples were measured on. */
  estimable: 'game',
  /** What Steam has served from /app/ that is not a game. */
  declined: ['demo', 'dlc', 'music', 'video', 'series', 'episode', 'hardware', 'mod', 'advertising']
};

/**
 * Below MIN_REVIEWS we refuse to produce a number at all.
 *
 * Ten is where Steam itself starts. Ask the store's own review summary about a
 * game with nine reviews and it answers `review_score: 0` with the description
 * "9 user reviews"; at eleven it answers with a score and a word. Valve will
 * not commit to a verdict on a smaller sample, and neither will we: under ten,
 * one more review moves the estimate by a tenth, so the figure would track the
 * sample rather than the game.
 *
 * Between MIN and CONFIDENT the band is widened instead of withheld.
 */
export const REVIEW_GATES = {
  MIN_REVIEWS: 10,
  CONFIDENT_REVIEWS: 200,
  LOW_SAMPLE_WIDEN: { lo: 0.75, hi: 1.4 }
};

/**
 * Refunds.
 *
 * GDC_REFUNDS_2024 surveyed around 150 developers: median 9.5%, average 10.8%,
 * Early Access median 12.4%. The envelope is the span the same body of work
 * reports across portfolios and markets — 6% where a niche audience is bought
 * in, 13% at and above the Early Access median — and it is what widens the
 * revenue band rather than a figure anyone has to set.
 */
export const REFUNDS = { lo: 0.06, mid: 0.095, hi: 0.13, source: 'GDC_REFUNDS_2024' };

/** Revenue waterfall defaults. All user-editable in the options page. */
export const REVENUE_DEFAULTS = {
  avgDiscount: 0.2,
  regionalProfile: 'auto',
  refundRate: REFUNDS.mid,
  source: 'IMMUTABLE_NET_2026'
};

/**
 * Combined effect of regional pricing and VAT on the average realised price.
 *
 * The two anchored values are the worked scenarios in IMMUTABLE_NET_2026: a
 * US/EU-concentrated audience keeps 0.88 of US list, and a globally
 * distributed one 0.78 — the "roughly 22% below list" that following Steam's
 * suggested regional prices costs. `emerging` is ours: the same source puts
 * Southeast Asia, the CIS, Brazil and China at 40-70% below USD list, so an
 * audience genuinely concentrated there lands nearer 0.6 than the blended
 * 0.78.
 *
 * Order matters. `revenue.js` widens the band by stepping to the neighbouring
 * profile, so REGIONAL_ORDER has to run from the most to the least favourable
 * with nothing missing in between.
 */
export const REGIONAL_PROFILES = {
  'us-eu': { factor: 0.88, label: 'Mostly US and EU buyers', source: 'IMMUTABLE_NET_2026' },
  mixed: { factor: 0.78, label: 'Mixed global audience', source: 'IMMUTABLE_NET_2026' },
  emerging: { factor: 0.6, label: 'Heavily CIS, SEA, LATAM, China', source: 'IMMUTABLE_NET_2026', derived: true }
};

/** Most to least favourable realised price. */
export const REGIONAL_ORDER = ['us-eu', 'mixed', 'emerging'];

/**
 * Deriving the regional profile from the language mix of a game's reviews.
 *
 * The alternative is asking the developer, which is all the options page
 * dropdown can do on its own — and asking someone to declare their audience
 * split is asking them to guess. Review language is a measured signal pointing at the same
 * thing, and the reviews API returns a total per language for the price of one
 * cheap request each.
 *
 * It is a proxy, not the answer. Review propensity differs by market, and
 * GAMALYTIC_RATIO_2023 found the demographic correlation real but not
 * statistically significant, so the mix is mapped onto the three published
 * profiles rather than turned into a factor of its own, and the dropdown still
 * overrides it.
 */
export const LANGUAGE_REGIONS = {
  /**
   * The languages of the markets IMMUTABLE_NET_2026 names as priced well below
   * US list: China, the CIS, Brazil and Latin America, Southeast Asia, Turkey.
   *
   * The reviews endpoint takes this whole list comma-joined in one request and
   * returns the union, so reading a game's mix costs a single call against a
   * lifetime total rather than a dozen calls or a sample. That matters more
   * than it sounds: sampling the most recent hundred reviews put Stardew
   * Valley at 71% low-price markets where its lifetime total is 41%, because
   * where a game sells today is not where it has sold.
   *
   * Spanish is deliberately absent. Spain is a euro market at close to list
   * price; `latam` is the code for the Spanish that is not.
   */
  discounted: [
    'schinese', 'tchinese', 'russian', 'ukrainian', 'brazilian', 'latam',
    'turkish', 'thai', 'vietnamese', 'indonesian'
  ],
  /**
   * Share of all reviews coming from those markets that tips a game from one
   * profile into the next. Ours: the profiles are published, the boundaries
   * between them are not, so they sit where the blended factor each profile
   * stands for would come out about right for an audience split that way.
   *
   * Every language not on the list above lands in the denominator as a
   * full-price market, which is true of most of them — the remainder is
   * mostly European.
   */
  thresholds: { mixed: 0.2, emerging: 0.5 },
  // Below this many reviews in total the mix is too thin to read.
  minReviews: 100,
  source: 'IMMUTABLE_NET_2026',
  derived: true
};

/**
 * How wide the revenue band gets from the waterfall's own assumptions.
 *
 * Pushing the unit band through one set of point assumptions would make
 * revenue look exactly as certain as units, when every step of the chain has
 * a range of its own. The sliders on the options page set the midpoint of
 * each assumption; they do not make it certain.
 *
 * The discount span is ours. Nobody publishes a distribution of lifetime
 * average discounts, because doing so would need price history for every game
 * on the store.
 */
export const REVENUE_UNCERTAINTY = {
  avgDiscount: { lo: 0.1, hi: 0.3, source: 'IMMUTABLE_NET_2026', derived: true },
  refundRate: { lo: REFUNDS.lo, hi: REFUNDS.hi, source: 'GDC_REFUNDS_2024' },
  // The regional leg steps one profile either side of the chosen one, so it
  // only ever spans values this file already publishes.
  regionalNeighbourStep: 1
};

/** Valve's tiered royalty. Marginal, per app, applied after VAT and refunds. */
export const STEAM_TIERS = [
  { upTo: 10_000_000, rate: 0.3 },
  { upTo: 50_000_000, rate: 0.25 },
  { upTo: Infinity, rate: 0.2 }
];

/**
 * Followers -> wishlists. Only valid before release: after launch wishlists
 * are consumed by purchases while followers persist, and the total balance
 * typically peaks at 2-4x the pre-launch count.
 */
export const WISHLIST = {
  // Range and overall median from the 2023 survey.
  lo: 7,
  hi: 20,
  median: 12.0,

  /**
   * Promotion history moves the midpoint, but the two surveys are different
   * vintages and cannot be mixed directly.
   *
   * The festival breakdown is from GDC_FOLLOWERS_2021, when the overall median
   * was 9.6x: no festival 7.77x, a Steam festival 10x, a festival plus a store
   * feature 10.45x. The range and median we use are from GDC_FOLLOWERS_2023,
   * where the overall median had risen to 12x.
   *
   * Dropping the 2021 numbers in beside the 2023 median would invert the
   * effect: a game known to have been in a festival would score 10x while a
   * game nothing is known about scores 12x, so a festival would *lower* the
   * estimate. Festivals raise the ratio. What the 2021 survey measures is how
   * far each group sits from its own median, so that is what carries over —
   * the shape from 2021, anchored to the level from 2023.
   *
   * Nothing on a store page reveals promotion history, so in practice this is
   * always 'unknown'. It stays because a caller that does know can pass it.
   */
  contexts: {
    none: { factor: 7.77 / 9.6, label: 'No festival or feature', source: 'GDC_FOLLOWERS_2021' },
    unknown: { factor: 1, label: 'Unknown promotion history' },
    nextFest: { factor: 10.0 / 9.6, label: 'Appeared in a Steam festival', source: 'GDC_FOLLOWERS_2021' },
    featured: { factor: 10.45 / 9.6, label: 'Festival plus a store feature', source: 'GDC_FOLLOWERS_2021' }
  },

  /**
   * Genre moves this ratio further than festival participation does, and
   * unlike festival participation it is readable from the store page.
   *
   * GDC_FOLLOWERS_2023 publishes per-tag multipliers alongside the 7-20x range
   * and 12x median already in use here, so this is the same survey at the same
   * vintage and the figures go in as absolute multipliers rather than as a
   * shape to renormalise. Strategy audiences follow closely and wishlist
   * sparingly; puzzle and relaxing audiences do the opposite.
   *
   * One tag adjustment only, resolved by the game's own tag ranking rather
   * than by the order of this list — see matchTagRule in tags.js. The order
   * here is by multiplier, purely so the table reads as a scale.
   */
  genres: [
    { match: ['4x'], multiplier: 7.5, label: '4X strategy', source: 'GDC_FOLLOWERS_2023' },
    { match: ['turn-based strategy', 'turn based strategy'], multiplier: 9.0, label: 'Turn-based strategy', source: 'GDC_FOLLOWERS_2023' },
    { match: ['survival'], multiplier: 9.5, label: 'Survival', source: 'GDC_FOLLOWERS_2023' },
    { match: ['story rich', 'story-rich'], multiplier: 13.2, label: 'Story rich', source: 'GDC_FOLLOWERS_2023' },
    { match: ['relaxing'], multiplier: 15.7, label: 'Relaxing', source: 'GDC_FOLLOWERS_2023' },
    { match: ['puzzle'], multiplier: 15.9, label: 'Puzzle', source: 'GDC_FOLLOWERS_2023' }
  ],

  source: 'GDC_FOLLOWERS_2023'
};

/**
 * Wishlists from a game's position in Steam's own Top Wishlists ordering.
 *
 * This is the second wishlist estimator, and the one that does not run on
 * follower count. It matters because on a single leg wishlists would be the
 * one figure in this project with nothing to disagree with it: one signal,
 * one published ratio, no second opinion.
 *
 * The store publishes an ordering of unreleased games by wishlists and no
 * numbers at all. An ordering alone cannot be turned into a count — rank 340
 * is not 340 of anything — so something has to supply the distribution the
 * ranks are positions in. VGI_WISHLISTS_2025 publishes exactly that: what
 * share of games launch above 100,000 wishlists, above 50,000, and so on.
 * Reading a rank as a percentile and inverting that distribution gives a
 * count, and gives it without fitting anything.
 *
 * The alternative is fitting a curve of the form a*r^-b to games whose
 * developers announced their wishlist totals. It fails on paper: wishlist
 * counts are heavy-tailed with a steep head and a flat
 * body, which one power law cannot follow, and a fit forced through it misses
 * by more than 10x across the range of ranks even with perfect inputs. The
 * error there is in the shape, and no quality of input data removes it.
 * Reading the published distribution instead means the shape is measured
 * rather than assumed, which is the same reason the review multiplier here is
 * a table by year and not a formula.
 *
 * Those announcements are still worth collecting, and tools/harvest-anchors.mjs
 * collects them — as a way to check this mapping, not to build it.
 */
export const WISHLIST_RANK = {
  /**
   * Distribution of wishlists at launch, as the share of games sitting above
   * each edge. Cumulative from the top.
   *
   * The bottom four rows are the bands VGI_WISHLISTS_2025 states directly: 6%
   * of games launch above 100k wishlists, 5% more between 50k and 100k, 23%
   * more between 10k and 50k, 37% more between 1k and 10k.
   *
   * The top two rows are the same report's breakdown of that 6%, which it
   * gives as counts rather than shares: 22 games above 1M, 26 between 500k
   * and 1M, 253 between 100k and 500k. Turning counts into shares needs the
   * size of the sample, and the report does not state it — but 22+26+253 is
   * 301, and 301 as 6% puts the sample at 5,017 games, against which every
   * other band lands on its published percentage to the nearest whole game.
   * Six rows that reconstruct from one number is not a coincidence, so the
   * derivation stands.
   *
   * Without those two rows the first band runs from 100,000 to the largest
   * game of the year and every title in the top 900 gets the same 43x answer,
   * which is a coarser estimate than the data it rests on.
   *
   * The edges are the resolution of the source, and they are also what the
   * band reports. A game landing in the 10,000-50,000 band is reported as
   * 10,000 to 50,000, because that is the finest this source can distinguish.
   * Interpolating a midpoint inside a band is reasonable; narrowing the band
   * around it would claim a precision nobody measured.
   */
  distribution: [
    { above: 1_000_000, shareAbove: 0.0044 },
    { above: 500_000, shareAbove: 0.0096 },
    { above: 100_000, shareAbove: 0.06 },
    { above: 50_000, shareAbove: 0.11 },
    { above: 10_000, shareAbove: 0.34 },
    { above: 1_000, shareAbove: 0.71 }
  ],

  /**
   * The largest launch wishlist count of the period the distribution covers,
   * used as the top of the first band. Without it the top band has no upper
   * edge and the game at rank 1 has no answer.
   */
  ceiling: 4_300_000,

  /**
   * How far into its accumulation an unreleased game is.
   *
   * The distribution above is of wishlists *at launch*. Every game in the
   * ordering is pre-launch, so it holds some fraction of its eventual total,
   * and the count this estimator reports is today's, not launch day's. That
   * fraction is the correction.
   *
   * VGI_WISHLISTS_2025 publishes the curve, indexed so launch day is 100%.
   * It stops at 17 weeks out, and so do we: a game announced for two years
   * from now is far below the bottom of this table, and extrapolating a curve
   * past its data to find out how far is the kind of number this project
   * declines to print. Outside the window the band spans the whole published
   * range instead, and the note says the game is outside it.
   *
   * Measured on the top 50 games by launch wishlists, which is a real
   * limitation: a game that will launch with 15,000 wishlists is unlikely to
   * accumulate them on the same schedule as one that will launch with a
   * million. Direction over magnitude, and the width carries the doubt.
   */
  accumulation: {
    // Week 0 is launch. Percentages of the launch total, as published.
    curve: [
      { weeksOut: 17, fraction: 0.71 }, { weeksOut: 16, fraction: 0.72 },
      { weeksOut: 15, fraction: 0.73 }, { weeksOut: 14, fraction: 0.75 },
      { weeksOut: 13, fraction: 0.77 }, { weeksOut: 12, fraction: 0.79 },
      { weeksOut: 11, fraction: 0.80 }, { weeksOut: 10, fraction: 0.80 },
      { weeksOut: 9, fraction: 0.82 }, { weeksOut: 8, fraction: 0.83 },
      { weeksOut: 7, fraction: 0.85 }, { weeksOut: 6, fraction: 0.85 },
      { weeksOut: 5, fraction: 0.85 }, { weeksOut: 4, fraction: 0.87 },
      { weeksOut: 3, fraction: 0.90 }, { weeksOut: 2, fraction: 0.92 },
      { weeksOut: 1, fraction: 0.94 }, { weeksOut: 0, fraction: 1.0 }
    ],
    // Used when the release date is unreadable or further out than the curve.
    span: { lo: 0.71, hi: 1.0 }
  },

  /**
   * Where the daily snapshot comes from.
   *
   * A file, not a crawl. The ordering costs 50-odd requests to read and the
   * extension never spends them: .github/workflows/wishlist-ranks.yml reads it
   * once a day for everybody and commits the result, and this fetches that.
   * The difference is not a nicety — 50 requests a day times every install is
   * a load Valve would be right to block, and it would take the feature with
   * it. It also means the extension never tells anyone which game is being
   * looked at: the same file is served to every user regardless.
   *
   * jsDelivr fronts the repository because GitHub Pages carries a 100 GB
   * monthly bandwidth limit that a popular extension would reach — 15 KB
   * gzipped, once a day, is 45 GB a month at a hundred thousand users. Raw
   * GitHub is the fallback for when the CDN has not caught up or is blocked.
   */
  feed: {
    url: 'https://cdn.jsdelivr.net/gh/q-sn/steam-revenue-wishlist-estimator@data/wishlist-ranks.json',
    fallbackUrl: 'https://raw.githubusercontent.com/q-sn/steam-revenue-wishlist-estimator/data/wishlist-ranks.json',
    // Twice the publishing cadence. jsDelivr caches a branch for 12 hours, so
    // asking more often than that returns the same bytes from the same edge.
    refreshMs: 12 * 60 * 60 * 1000
  },

  /**
   * How stale a ranking snapshot may be before it is not worth reading.
   *
   * The ordering is rebuilt daily. Two days is one missed run; beyond that
   * the positions describe a store that has moved on, and a wrong rank is
   * worse than no rank because it looks exactly as authoritative.
   */
  maxAgeMs: 3 * 24 * 60 * 60 * 1000,

  source: 'VGI_WISHLISTS_2025'
};

/** Two independent published routes from public data to week-one sales. */
export const WEEK_ONE = {
  fromWishlists: { factor: 0.11, label: 'Wishlists x 0.11', source: 'GDC_CONVERSION_2025' },
  fromFollowers: { factor: 2.5, label: 'Followers x 2.5', source: 'GDC_FOLLOWERS_2019' }
};

/**
 * Confidence thresholds, expressed as the ratio of the high end of a range to
 * its low end. A 2x spread is the honest floor for this class of estimate.
 *
 * Widening them to 2.75x and 5.1x — on the reasoning that the published
 * multiplier band spans 2.75x on its own, so nothing narrower is reachable —
 * answers the wrong question. What the ensemble produces on 22 real games is
 * bimodal: eighteen games sit between 2.23x and 2.64x, four sit between 7.4x
 * and 12.6x, and nothing lands in between. With two estimators the width of
 * the band is close to a binary signal — either the two ranges overlap or they
 * do not — so no pair of thresholds populates three levels. All the choice
 * decides is which label the big cluster gets.
 *
 * At 2.75x that cluster reads *reliable*, which claims accuracy on 82% of the
 * store on the strength of two wide, correlated, measurably biased sources
 * happening to overlap. At 2.2x it reads *rough*, which is what a 2.4x band
 * built from a review multiple that is right within 30% half the time and a
 * SteamSpy bucket with a measured 1.58x median offset actually is.
 *
 * Underclaiming is the correct direction to be wrong in here, and the top of
 * the scale stays out of reach
 * until there is a third estimator whose input can be specified, or frozen
 * snapshots to calibrate against. That is recorded as a known limitation
 * rather than fixed by moving a number.
 */
export const CONFIDENCE = {
  good: 2.2,
  fair: 3.5
};

/**
 * Converting SteamSpy owner bands into paid units.
 *
 * Owners are not sales. The band includes free keys, giveaways, review copies
 * and bundle purchases that produced little or no revenue, so the raw number
 * is a ceiling.
 *
 * The store page cannot supply the share to remove. A bundle widget in the
 * purchase block says whether a bundle is on offer today, while the
 * coefficient is about every key ever handed out — blind to a game bundled
 * two years ago, and firing on games that merely carry a publisher bundle.
 *
 * The reviews API answers the real question. Asking for `purchase_type=steam`
 * and for `purchase_type=all` gives the share of reviewers who bought on Steam
 * rather than activating a key, and GAMALYTIC_METHOD_2023 names exactly this
 * ratio as the signal for telling sold copies from given-away ones. `floor`
 * and `ceiling` bound it, because reviewers are not a random sample of owners.
 */
export const OWNERS_TO_UNITS = {
  // Used when the key share cannot be read at all.
  fallback: 0.9,
  floor: 0.5,
  ceiling: 0.98,

  /**
   * The keyless API answers on a fixed ladder — 20k, 50k, 100k, 200k, 500k,
   * 1M and so on — so each bucket is 2x or 2.5x wide and the bottom rung has
   * no lower edge at all. This is that step, used to give "0 .. 20,000" an
   * implied floor rather than treating it as "possibly none".
   *
   * The width of those rungs is the reason a bucket's midpoint is not a
   * reading: every game between 20M and 50M gets the same one. See
   * ENSEMBLE.alarmGap for what follows from that.
   */
  ladderStep: 2.5,

  source: 'GAMALYTIC_METHOD_2023'
};

/**
 * Ensemble weights.
 *
 * Only estimators of the same quantity may be averaged, and only when we can
 * say what they measure. The review multiple and the owner band both estimate
 * lifetime units on inputs we can specify, so they combine.
 *
 * Two things stay outside the average for different reasons. The peak-CCU rule
 * estimates week-one sales, which is a different quantity. The player-hours
 * route estimates the right quantity but divides by an average playtime we
 * cannot measure, so it can widen a band and lower confidence without moving
 * the midpoint.
 *
 * SteamSpy's sample collapsed when Valve made profiles private in 2018 and it
 * is worst for small games, so its weight scales with the size of the band —
 * a direction checked against OURS_OWNER_QUALITY rather than assumed.
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
  // No playtime entry. The player-hours route is a cross-check, not a leg:
  // see PLAYTIME for why its divisor cannot be specified from public data.
  // Midpoints are combined as a weighted geometric mean: the underlying
  // multiplier distribution is closer to log-normal than normal, so an
  // arithmetic mean would bias every result upward.
  useGeometricMean: true,

  /**
   * When estimators actually disagree.
   *
   * Every estimator here reports an interval, not a number, so agreement is a
   * question about intervals: is there any figure all of them admit? If the
   * bands share a region, nothing is in conflict, however far apart their
   * midpoints happen to sit.
   *
   * Comparing midpoints against a 1.5x threshold measures the wrong thing,
   * and measures it worst on the source least able to bear it. SteamSpy's
   * keyless API answers on a fixed ladder of buckets, so the geometric centre
   * of a 20M-50M bucket is 31.6M for every game in it: the midpoint is where
   * the ladder's edges fall, not a claim about the game. On Baldur's Gate 3
   * that reads as a "1.9x disagreement" between three bands that overlap on
   * 17.2M to 20.1M, widening the band to cover a conflict that does not exist.
   *
   * So a gap between bands is the trigger, and its size sets the tier.
   * `alarmGap` is the point where the nearest edges of two published bands are
   * further apart than a single method's own published error — 1.3 / 0.7 from
   * GAMALYTIC_METHOD_2023, where adjusted review multiples land within 30% on
   * 50.4% of games and concurrents-over-playtime on 64.4%. Below it the
   * sources merely fail to touch; above it they contradict each other.
   */
  alarmGap: 1.86,

  /**
   * Wishlist legs, weighted equally, and the equality is the point.
   *
   * The follower ratio rests on a survey of 125+ developers who volunteered
   * their numbers. The rank leg rests on a published distribution of launch
   * wishlists inverted through a position Valve publishes but does not
   * document. Neither comes with an accuracy figure for this quantity — there
   * is no wishlist equivalent of GAMALYTIC_METHOD_2023 — so there is nothing
   * to prefer one on, and a weight picked to express a hunch would be a
   * coefficient without a source.
   *
   * What the pair is actually for is the disagreement between them. On a
   * single leg the band could only ever be as wide as one survey's published
   * range, and nothing could contradict it. Two legs that sometimes conflict
   * say more than either leg's midpoint does.
   */
  wishlists: { followers: 1, rank: 1 },

  source: 'GAMALYTIC_METHOD_2023',
  derived: true
};

/**
 * Peak concurrent players, as a week-one cross-check.
 *
 * GDC_CCU_2025 measured week-one sales against the *all-time* peak, so that is
 * the figure to feed it. SteamSpy's `ccu` field is yesterday's peak, which
 * coincides with the launch peak for about a fortnight and then diverges
 * without limit; feeding it in would make the rule quietly underestimate
 * every game older than that.
 *
 * The all-time peak is the launch peak only while nothing has beaten it since.
 * Stardew Valley peaked in March 2024, eight years after release, and running
 * a week-one rule on that would be nonsense. Which month the peak falls in is
 * readable from the same SteamCharts table, so the rule applies only when the
 * peak sits within `launchPeakWindowDays` of release and says why when it does
 * not. With no readable release date or no monthly history it declines to
 * answer: a gate that protects against a confidently wrong number has to fail
 * closed.
 */
export const CCU = {
  launchPeakWindowDays: 60,
  multiplier: { withPreorders: 7.8, withoutPreorders: 14.1, unknown: 11.4 },
  // GameDiscoverCo flag variance of 50% or more in both directions.
  variance: 0.5,
  source: 'GDC_CCU_2025'
};

/**
 * Units implied by concurrent-player history and playtime. A cross-check, and
 * the reason it is only a cross-check is worth the space.
 *
 * The method GAMALYTIC_METHOD_2023 ranks second of the five it benchmarks: add
 * up concurrent players over time for total player-hours, then divide by the
 * hours an average owner puts in. The first half we have exactly — SteamCharts
 * publishes average concurrents per month for a game's whole life, on the page
 * already fetched for the peak, and summing it is arithmetic.
 *
 * The second half is the average playtime of everyone who owns the game, and
 * we cannot get it. SteamSpy returns zero for every app. What is free is the
 * playtime attached to each review, and a review sample is not the owner
 * population:
 *
 *  - The newest hundred reviews of a mature game span days, not years. On
 *    Enshrouded they covered three days, and those buyers' median playtime was
 *    41.7 hours against 100.5 hours for reviewers from its launch quarter
 *    measured today. Sampling the newest reviews measures whoever just bought
 *    the game.
 *  - The quantity needed is a mean, since total hours over owners is a mean by
 *    definition, and playtime distributions have a long enough tail that the
 *    mean sits far above any median — 96.7 against 41.7 hours on that same
 *    sample.
 *
 * OURS_PLAYTIME_BIAS measured a correction for this and it does not transfer.
 * It compared playtime-at-review in the 90 days before each disclosure against
 * the true average at that date, which is a coherent specification, but the
 * estimator applies it to a different quantity at an arbitrary game age. The
 * measurement's own numbers show why that fails: the correction falls with a
 * game's age, 0.50x for Stardew Valley at six years and 0.55x for Garry's Mod
 * at fifteen, and averaging that into one constant gives a middle-80% band
 * that does not even contain those two games.
 *
 * Alternative specifications do no better: none of four tried on five games
 * is consistently closer, and the only yardstick available is whether the
 * answer matches the other two estimators — which is fitting an independent
 * method to the ones it exists to be independent of.
 *
 * So the honest reading of GAMALYTIC_METHOD_2023 here is that its 64.4% belongs
 * to *their* playtime estimate, drawn from profile data we do not have. The
 * article says as much: accuracy "depends completely on the average playtime
 * estimate". Claiming that figure for this implementation would be unearned.
 *
 * What remains is still worth showing. The player-hour total is measured, and
 * an owner count implied by a stated average playtime is a real cross-check
 * with its assumption in plain view. `biasRange` therefore spans the full
 * measured range rather than its middle, because the width is the finding.
 */
export const PLAYTIME = {
  // The whole measured range, not the middle 80%: min 0.50x, median 1.09x,
  // max 2.07x over 26 fixtures. A band this wide is the honest report of a
  // correction that depends on things it does not measure.
  biasRange: { lo: 0.5, mid: 1.09, hi: 2.07 },
  // Fewer reviews than this and the median is not worth having.
  minSample: 20,
  // A month averaging below this is noise from a pre-release build.
  minMonthlyAverage: 0.5,
  source: 'OURS_PLAYTIME_BIAS'
};

/**
 * Local history. The extension keeps its own snapshots so it can show what
 * changed since the last visit; nothing leaves the browser.
 */
export const HISTORY = {
  maxPoints: 60,
  minGapMs: 12 * 60 * 60 * 1000,
  cacheTtlMs: 24 * 60 * 60 * 1000,
  // A live player count cached for a day is not a live player count.
  liveTtlMs: 3 * 60 * 1000
};

/** Steam's recent-review window, in days. Fixed by Valve, not by us. */
export const RECENT_REVIEW_WINDOW_DAYS = 30;
