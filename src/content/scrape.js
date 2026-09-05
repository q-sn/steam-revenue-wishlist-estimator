/**
 * Collecting the inputs.
 *
 * Preference order is deliberate: Steam's own JSON endpoints are same-origin
 * from a store page, so they cost no host permission and survive store
 * redesigns. The DOM is the fallback, not the primary — store markup changes
 * several times a year and every extension that parses it first eventually
 * breaks silently.
 *
 * Everything here is cached in chrome.storage.local before it is requested
 * again. That is not politeness for its own sake: `appdetails` is rate-limited
 * hard enough that a few minutes of browsing without a cache starts returning
 * nothing, and a missing appdetails response silently costs the release year,
 * the list price and the revenue figure at once.
 */

import { parseReviewSummary, medianHours } from '../core/units.js';
import { LANGUAGE_REGIONS, HISTORY } from '../core/constants.js';

export function readAppId() {
  const m = location.pathname.match(/\/app\/(\d+)/);
  return m ? Number(m[1]) : null;
}

/** How long each kind of store answer stays usable. */
const TTL = {
  // Review totals move visibly on a launch week, so this one is short.
  reviews: 60 * 60 * 1000,
  // Price, release state and genres, none of which change hourly.
  details: 6 * 60 * 60 * 1000,
  // Audience mix and playtime distribution move over months, not hours.
  audience: HISTORY.cacheTtlMs
};

async function cachedJson(key, ttl, fetcher) {
  let hit = null;
  try {
    const store = await chrome.storage.local.get(key);
    hit = store[key] ?? null;
    if (hit && Date.now() - hit.at <= ttl) return hit.value;
  } catch {
    // Storage can be unavailable; that is a reason to skip the cache, not to
    // skip the request.
  }

  try {
    const value = await fetcher();
    try {
      await chrome.storage.local.set({ [key]: { value, at: Date.now() } });
    } catch { /* over quota: serve the value, just do not remember it */ }
    return value;
  } catch (err) {
    // A stale answer beats no answer, and every caller here degrades to null
    // rather than showing something wrong.
    if (hit) return hit.value;
    throw err;
  }
}

async function getJson(url) {
  const res = await fetch(url, { credentials: 'omit' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

const reviewsUrl = (appId, params) =>
  `https://store.steampowered.com/appreviews/${appId}?json=1&purchase_type=all&${params}`;

/** Authoritative review totals, all languages, including off-topic filtering. */
async function fetchReviewSummary(appId) {
  return cachedJson(`sReviews:${appId}`, TTL.reviews, async () => {
    const data = await getJson(reviewsUrl(appId, 'num_per_page=0&language=all&filter=summary'));
    const q = data?.query_summary;
    if (!q || !Number.isFinite(q.total_reviews)) throw new Error('no query_summary');
    const total = q.total_reviews;
    return {
      reviews: total,
      positivePct: total > 0 ? (q.total_positive / total) * 100 : null
    };
  });
}

/**
 * How much of a game's audience sits in a market Steam prices below US list.
 *
 * The endpoint takes the whole language list comma-joined and returns the
 * union, so this is one request for a lifetime figure rather than a dozen
 * requests or a sample of recent reviews — and the difference is not
 * cosmetic, since recent reviews describe where a game sells now rather than
 * where it has sold.
 */
async function fetchLanguageMix(appId, totalReviews) {
  if (!Number.isFinite(totalReviews) || totalReviews < LANGUAGE_REGIONS.minReviews) return null;

  return cachedJson(`sLang:${appId}`, TTL.audience, async () => {
    const codes = LANGUAGE_REGIONS.discounted.join(',');
    const data = await getJson(reviewsUrl(appId, `num_per_page=0&language=${codes}&filter=summary`));
    const discounted = data?.query_summary?.total_reviews;
    if (!Number.isFinite(discounted)) throw new Error('no language totals');
    return { discounted, total: totalReviews };
  });
}

/**
 * One page of reviews, read for three things at once.
 *
 * Each review carries the playtime its author had when they wrote it, the
 * language they wrote in, and whether they bought the game on Steam or
 * activated a key. Those answer, in order: how long an owner plays, which is
 * the missing half of the player-hours estimator; and what share of the
 * SteamSpy owner band was actually bought here rather than activated from a
 * key. The purchase block on the page cannot answer that last one: it says
 * whether a bundle is on offer today, not whether the game has ever been
 * bundled.
 *
 * `playtime_at_review` is deliberately not used. It is the right field for
 * calibration against a past date and the wrong one here, where the question
 * is how much an owner has played by now.
 */
async function fetchReviewSample(appId) {
  return cachedJson(`sSample:${appId}`, TTL.audience, async () => {
    const data = await getJson(reviewsUrl(appId, 'num_per_page=100&language=all&filter=recent'));
    const reviews = data?.reviews;
    if (!Array.isArray(reviews) || !reviews.length) throw new Error('no reviews returned');

    const playtimes = reviews
      .map((r) => r.author?.playtime_forever)
      .filter((m) => Number.isFinite(m) && m > 0);

    const bought = reviews.filter((r) => r.steam_purchase === true).length;
    const free = reviews.filter((r) => r.received_for_free === true).length;

    return {
      sampleSize: reviews.length,
      medianPlaytimeHours: medianHours(playtimes),
      steamPurchaseShare: reviews.length ? bought / reviews.length : null,
      freeShare: reviews.length ? free / reviews.length : null
    };
  });
}

/** Price, release state, genres, f2p flag. */
async function fetchAppDetails(appId) {
  return cachedJson(`sDetails:${appId}`, TTL.details, async () => {
    const data = await getJson(
      `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=en`
    );
    const entry = data?.[String(appId)];
    if (!entry?.success || !entry.data) throw new Error('appdetails unsuccessful');
    const d = entry.data;

    // Two different prices, and confusing them is expensive. `final` is what
    // the store charges today; `initial` is the list price. The waterfall and
    // the price band both want the list price — feeding them `final` counts
    // every discount twice, once in the price and again in the average-
    // discount step, and moves the estimate by more than 2x on a sale.
    const price = d.price_overview
      ? d.price_overview.final / 100
      : d.is_free ? 0 : null;
    const listPrice = d.price_overview
      ? d.price_overview.initial / 100
      : d.is_free ? 0 : null;

    return {
      name: d.name,
      isFree: Boolean(d.is_free),
      price,
      listPrice,
      discountPct: d.price_overview?.discount_percent ?? 0,
      released: d.release_date ? !d.release_date.coming_soon : null,
      releaseYear: parseYear(d.release_date?.date),
      releaseDate: parseDate(d.release_date?.date),
      tags: (d.genres ?? []).map((g) => g.description),
      // Not an input to anything. DLC revenue is not estimated, and the honest
      // way to say so on a game with eleven of them is to name the number
      // being left out rather than to note in general terms that DLC exists.
      dlcCount: Array.isArray(d.dlc) ? d.dlc.length : 0,
      type: d.type,
      // Present on demos, DLC and soundtracks: the app the page belongs to.
      // It is what lets a demo show the game's figures instead of a sales
      // estimate for something that has no sales, and what lets the other
      // declined types point at the game they came from instead of being a
      // dead end.
      fullGameId: Number(d.fullgame?.appid) || null,
      fullGameName: d.fullgame?.name ?? null
    };
  });
}

/**
 * With `l=en` the store returns dates as "Feb 26, 2016". Date.parse handles
 * that, and returns NaN for the "Coming soon" and "Q2 2026" forms an
 * unreleased game carries — which is the answer we want for those.
 */
function parseDate(dateStr) {
  if (!dateStr) return null;
  const ms = Date.parse(dateStr);
  return Number.isFinite(ms) ? ms : null;
}

function parseYear(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/(19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

/** User tags carry more genre signal than Steam's coarse `genres` field. */
function readTagsFromDom() {
  return [...document.querySelectorAll('a.app_tag')]
    .map((el) => el.textContent.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function readReviewsFromDom() {
  const el = document.querySelector('meta[itemprop="reviewCount"]');
  const n = el ? Number(el.getAttribute('content')) : NaN;
  return Number.isFinite(n) ? { reviews: n, positivePct: null } : null;
}

function readReleasedFromDom() {
  // "Coming soon" pages carry a pre-purchase / coming-soon block instead of
  // an add-to-cart form.
  if (document.querySelector('.game_area_comingsoon')) return false;
  return null;
}

/**
 * Recent versus lifetime review sentiment, straight off the page.
 *
 * Valve computes a 30-day score itself and prints both summaries in the glance
 * box. That is the number to use: deriving it from the reviews API would mean
 * paging through every review and counting timestamps, for a figure already
 * rendered a few hundred pixels away.
 *
 * The two rows are told apart by what their tooltips say rather than by where
 * they sit. Only the recent one names the length of its window, and that
 * number is digits in every Steam locale, so it survives translation where a
 * label would not. Position does not survive: the store renders a second,
 * responsive copy of both rows in the opposite order, and any page that ever
 * ships one set without the other would leave this reading the lifetime score
 * as the recent one and reporting a flat trend on every game.
 */
function readReviewTrend() {
  const parsed = [...document.querySelectorAll('.user_reviews_summary_row[data-tooltip-html]')]
    .map((row) => parseReviewSummary(row.getAttribute('data-tooltip-html')))
    .filter(Boolean);

  const recent = parsed.find((p) => p.windowed);
  const all = parsed.find((p) => !p.windowed);
  if (!recent || !all) return null;

  return {
    recentPct: recent.pct,
    recentCount: recent.count,
    allPct: all.pct,
    allCount: all.count
  };
}

/**
 * Are the two summary rows measuring the same population?
 *
 * Steam scopes the lifetime row to the reader's language while leaving the
 * recent row across all of them. On Apex Legends that means the page shows
 * "Recent Reviews: 68% of 7,497" beside "English Reviews: 76% of 449,071",
 * and subtracting one from the other compares thirty days of every language
 * against a lifetime of English. The gap that produces is not a trend.
 *
 * The row labels are translated, so the check is arithmetic: a lifetime row
 * counting far fewer reviews than we know exist has been filtered. The margin
 * is loose enough to tolerate the purchase-type difference between Steam's
 * display and our own count.
 */
export function comparableScopes(trend, totalReviews) {
  if (!trend || !Number.isFinite(trend.allCount) || !Number.isFinite(totalReviews)) return false;
  return trend.allCount >= totalReviews * 0.9;
}

/**
 * Promotion history is not readable from a store page.
 *
 * The wishlist midpoint shifts with festival participation, so it is tempting
 * to guess at it here. Both available signals are wrong:
 *
 *  - A demo is not a festival. Games ship demos whenever they like, and the
 *    multiplier was measured for festival participation specifically. Treating
 *    one as the other raised the estimate on a fact that has no bearing on it.
 *
 *  - Searching the page for "Next Fest" only finds a game while the festival
 *    is actually running. A game that took part last year leaves no trace on
 *    today's page, so the check is a false negative almost all of the time.
 *
 * A detector that is wrong in one direction and blind in the other is worse
 * than no detector: the fallback multiplier is the survey median across every
 * game, which is the correct answer when the history is unknown.
 *
 * What does move the wishlist ratio and is readable is genre, from the same
 * survey — see WISHLIST.genres. Tags come off the page a few lines above.
 */
function readFestivalContext() {
  return 'unknown';
}

/**
 * Build the normalised game object the core estimators expect.
 *
 * A demo page is a page about a game that is not the game. Its reviews are
 * reviews of the demo, its `is_free` flag is about the demo, and the sales it
 * would imply do not exist. The game it belongs to does have sales, and Steam
 * names it in `fullgame` — so on a demo the pipeline runs a second time
 * against the parent, and the panel says whose figures it is showing.
 *
 * The page's own collection still happens first, rather than reading the type
 * and then deciding. Reading the type first would put `appdetails` in front
 * of the other two requests on every game page, turning one round trip into
 * two for the common case to save a wasted one on the rare case.
 */
export async function collectGame(appId) {
  const own = await collect(appId, { useDom: true });

  if (own.appType === 'demo' && own.fullGameId) {
    const parent = await collect(own.fullGameId, { useDom: false });
    return {
      ...parent,
      // The demo's own review count is the one figure the page we are standing
      // on legitimately supplies, so it is kept rather than discarded.
      viaDemo: { appId, name: own.name ?? null, reviews: own.reviews ?? null }
    };
  }

  return own;
}

/**
 * Followers, owner bands and concurrent-player history all live on other
 * origins, so they come back from the background worker in a single round
 * trip. Everything else here is same-origin and cached.
 *
 * `useDom` is false when the app being collected is not the app whose page we
 * are on. Everything the DOM supplies describes the page, so on a substituted
 * collection it would describe the wrong app — quietly, and in the fields
 * that feed the genre multiplier and the recent-review trend.
 */
async function collect(appId, { useDom = true } = {}) {
  const [reviewSummary, details, external] = await Promise.all([
    fetchReviewSummary(appId).catch(() => null),
    fetchAppDetails(appId).catch(() => null),
    requestExternal(appId)
  ]);

  const reviews = reviewSummary ?? (useDom ? readReviewsFromDom() : null);
  const totalReviews = reviews?.reviews ?? null;

  // These two need the review total to be worth requesting at all, so they
  // wait for it rather than joining the round trip above.
  const [languageMix, sample] = await Promise.all([
    fetchLanguageMix(appId, totalReviews).catch(() => null),
    Number.isFinite(totalReviews) && totalReviews > 0
      ? fetchReviewSample(appId).catch(() => null)
      : null
  ]);

  const domTags = useDom ? readTagsFromDom() : [];

  return {
    appId,
    name: details?.name ?? document.title.replace(/ on Steam$/, ''),
    reviews: totalReviews,
    positivePct: reviews?.positivePct ?? null,
    isFree: details?.isFree ?? false,
    // The price on the page today, and the price the game is nominally sold
    // at. The estimators want the second one; only the discount signal wants
    // the first.
    price: details?.price ?? null,
    listPrice: details?.listPrice ?? details?.price ?? null,
    discountPct: details?.discountPct ?? 0,
    dlcCount: details?.dlcCount ?? 0,
    released: details?.released ?? (useDom ? readReleasedFromDom() : null) ?? true,
    releaseYear: details?.releaseYear ?? null,
    releaseDate: details?.releaseDate ?? null,
    tags: domTags.length ? domTags : (details?.tags ?? []),
    followers: external?.followers ?? null,
    followersStale: Boolean(external?.followersStale),
    // Place in Steam's own Top Wishlists ordering, from the shared daily
    // snapshot rather than from anything this page asked for. Null means the
    // game is below the bottom of the ordering, which the core reads as a
    // ceiling — but only when `wishlistListing` says where that bottom was.
    // Null listing means the snapshot has not arrived and nothing is known.
    wishlistRank: external?.wishlistRank ?? null,
    wishlistListing: external?.wishlistListing ?? null,
    owners: external?.owners ?? null,
    // How many reviews SteamSpy itself has on file. Zero against a game Steam
    // says has hundreds means the record was never processed, not that the
    // game is small — see unitsFromOwners.
    ownerRecordReviews: external?.ownerRecordReviews ?? null,
    // SteamCharts first: it reads Valve's API, where SteamSpy samples.
    peak24h: external?.peak24h ?? external?.peakCcuYesterday ?? null,
    peak24hSource: external?.peak24h != null ? 'charts' : 'steamspy',
    peakCcuYesterday: external?.peakCcuYesterday ?? null,
    currentPlayers: external?.currentPlayers ?? null,
    allTimePeak: external?.allTimePeak ?? null,
    // When that peak happened, to the month. Without it the week-one rule
    // cannot tell a launch peak from a viral spike years later, and declines.
    allTimePeakAt: external?.allTimePeakAt ?? null,
    monthlyHistory: external?.monthlyHistory ?? null,
    trend: external?.trend ?? null,
    reviewerMedianHours: sample?.medianPlaytimeHours ?? null,
    reviewerSampleSize: sample?.sampleSize ?? null,
    steamPurchaseShare: sample?.steamPurchaseShare ?? null,
    freeCopyShare: sample?.freeShare ?? null,
    languageMix: languageMix ?? null,
    reviewTrend: useDom ? readReviewTrend() : null,
    festivalContext: readFestivalContext(),
    // What kind of store page this is, and what it belongs to. The estimators
    // decline everything that is not a base game — see APP_TYPES. A failed
    // appdetails leaves this null, which reads as "game": a request that did
    // not answer is not evidence that the page is something exotic.
    appType: details?.type ?? null,
    fullGameId: details?.fullGameId ?? null,
    fullGameName: details?.fullGameName ?? null
  };
}

function sendMessage(payload) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(payload, (res) => {
        if (chrome.runtime.lastError) return resolve(null);
        resolve(res ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

function requestExternal(appId) {
  return sendMessage({ type: 'getExternal', appId });
}

/** Store this visit and get back what moved since the previous one. */
export function recordHistory(appId, snapshot) {
  return sendMessage({ type: 'recordHistory', appId, snapshot });
}
