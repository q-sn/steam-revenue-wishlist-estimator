/**
 * Collecting the inputs.
 *
 * Steam's same-origin JSON endpoints come first; the DOM is the fallback.
 * Every read is cached in chrome.storage.local — `appdetails` is rate-limited
 * hard enough that uncached browsing starts returning nothing, which silently
 * costs the release year, the list price and the revenue figure at once.
 */

import { parseReviewSummary, medianHours, firstSaleDate } from '../core/units.js';
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
    // Storage unavailable: skip the cache, still make the request.
  }

  try {
    const value = await fetcher();
    try {
      await chrome.storage.local.set({ [key]: { value, at: Date.now() } });
    } catch { /* over quota: serve the value, just do not remember it */ }
    return value;
  } catch (err) {
    // A stale answer beats no answer.
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
 * The endpoint takes the language list comma-joined and returns the union, so
 * this is one request for a lifetime figure.
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
 * One page of reviews, read for median owner playtime and the share of buyers
 * who purchased on Steam rather than activating a key.
 *
 * Uses `playtime_forever`, not `playtime_at_review`: the question is how much
 * an owner has played by now, not at the time of writing.
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

    // `final` is what the store charges today; `initial` is the list price.
    // The waterfall and the price band both want the list price — `final`
    // counts a discount twice and moves the estimate by over 2x on a sale.
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
      // Display only. DLC revenue is not estimated; this names how much the
      // figure leaves out.
      dlcCount: Array.isArray(d.dlc) ? d.dlc.length : 0,
      type: d.type,
      // Present on demos, DLC and soundtracks: the app the page belongs to.
      fullGameId: Number(d.fullgame?.appid) || null,
      fullGameName: d.fullgame?.name ?? null
    };
  });
}

/**
 * With `l=en` the store returns dates as "Feb 26, 2016". Date.parse gives NaN
 * for the "Coming soon" and "Q2 2026" forms, which is the wanted answer.
 */
/**
 * When the game first took money, which is not what `appdetails` reports.
 *
 * The store's release date is the 1.0 date. `appreviewhistogram` carries the
 * whole review history and its `start_date` is where that history begins,
 * which for an Early Access title is years earlier — measured over 930 games
 * it agrees with Steam's own `original_steam_release_date` on 97% of the games
 * that have one, and finds the date for 55 more that do not. See
 * OURS_FIRST_SALE_DATE.
 *
 * Steam floors this field at October 2010. Everything before that is already
 * in the oldest multiplier band, so the clamp cannot move one.
 */
async function fetchFirstSale(appId) {
  return cachedJson(`sFirstSale:${appId}`, TTL.details, async () => {
    const data = await getJson(`https://store.steampowered.com/appreviewhistogram/${appId}?l=english`);
    const start = data?.results?.start_date;
    return Number.isFinite(start) ? start * 1000 : null;
  });
}

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
 * Recent versus lifetime review sentiment, from the glance box.
 *
 * The two rows are told apart by their tooltips, never by position: the store
 * renders a second responsive copy of both rows in the opposite order. Only
 * the recent tooltip names its window length, and that is digits in every
 * Steam locale, so it survives translation where a label would not.
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
 * Are the two summary rows measuring the same population? Steam sometimes
 * scopes the lifetime row to the reader's language while leaving the recent
 * row across all of them, and the difference between those is not a trend.
 *
 * Labels are translated, so the check is arithmetic: a lifetime row counting
 * far fewer reviews than exist has been filtered. The margin absorbs the
 * purchase-type difference between Steam's display and our own count.
 */
export function comparableScopes(trend, totalReviews) {
  if (!trend || !Number.isFinite(trend.allCount) || !Number.isFinite(totalReviews)) return false;
  return trend.allCount >= totalReviews * 0.9;
}

/**
 * Always 'unknown': festival participation is not readable from a store page,
 * and the core falls back to the survey median across every game.
 */
function readFestivalContext() {
  return 'unknown';
}

/**
 * Build the normalised game object the core estimators expect.
 *
 * On a demo the pipeline runs a second time against the parent named in
 * `fullgame`, since the demo's own reviews and `is_free` flag describe the
 * demo. The page's own collection runs first regardless: reading the type
 * before collecting would serialise `appdetails` ahead of the other requests
 * on every game page.
 */
export async function collectGame(appId) {
  const own = await collect(appId, { useDom: true });

  if (own.appType === 'demo' && own.fullGameId) {
    const parent = await collect(own.fullGameId, { useDom: false });
    return {
      ...parent,
      // The demo's own review count, the one figure this page legitimately
      // supplies.
      viaDemo: { appId, name: own.name ?? null, reviews: own.reviews ?? null }
    };
  }

  return own;
}

/**
 * Followers, owner bands and player history are cross-origin and come back
 * from the background worker in one round trip; the rest is same-origin.
 *
 * `useDom` must be false when the app being collected is not the app whose
 * page this is — everything the DOM supplies describes the page, so it would
 * otherwise silently feed the wrong app's tags and review trend.
 */
async function collect(appId, { useDom = true } = {}) {
  const [reviewSummary, details, external, firstSale] = await Promise.all([
    fetchReviewSummary(appId).catch(() => null),
    fetchAppDetails(appId).catch(() => null),
    requestExternal(appId),
    fetchFirstSale(appId).catch(() => null)
  ]);

  // The store's date is the 1.0 date; the review history knows when the game
  // actually went on sale. `firstSaleDate` decides between them.
  const sale = firstSaleDate(details?.releaseDate ?? null, firstSale);

  const reviews = reviewSummary ?? (useDom ? readReviewsFromDom() : null);
  const totalReviews = reviews?.reviews ?? null;

  // Both need the review total to be worth requesting, so they wait for it
  // rather than joining the round trip above.
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
    // `price` is today's price, `listPrice` the nominal one. The estimators
    // want listPrice; only the discount signal wants price.
    price: details?.price ?? null,
    listPrice: details?.listPrice ?? details?.price ?? null,
    discountPct: details?.discountPct ?? 0,
    dlcCount: details?.dlcCount ?? 0,
    released: details?.released ?? (useDom ? readReleasedFromDom() : null) ?? true,
    releaseYear: sale?.corrected
      ? new Date(sale.at).getUTCFullYear()
      : details?.releaseYear ?? null,
    releaseDate: sale?.at ?? null,
    // Kept apart so the panel can say the game has been selling since before
    // the date its own store page shows, rather than silently contradicting it.
    storeReleaseYear: details?.releaseYear ?? null,
    firstSaleCorrected: Boolean(sale?.corrected),
    tags: domTags.length ? domTags : (details?.tags ?? []),
    followers: external?.followers ?? null,
    followersStale: Boolean(external?.followersStale),
    // Place in Steam's Top Wishlists ordering, from the shared daily snapshot.
    // Null rank means below the bottom of the ordering, which the core reads
    // as a ceiling; null listing means no snapshot, so nothing is known.
    wishlistRank: external?.wishlistRank ?? null,
    wishlistListing: external?.wishlistListing ?? null,
    // What the studio published about this game, from the same daily job.
    wishlistSaid: external?.wishlistSaid ?? null,
    owners: external?.owners ?? null,
    // Reviews SteamSpy has on file. Zero against a game Steam says has
    // hundreds means an unprocessed record — see unitsFromOwners.
    ownerRecordReviews: external?.ownerRecordReviews ?? null,
    // SteamCharts first: it reads Valve's API, where SteamSpy samples.
    peak24h: external?.peak24h ?? external?.peakCcuYesterday ?? null,
    peak24hSource: external?.peak24h != null ? 'charts' : 'steamspy',
    peakCcuYesterday: external?.peakCcuYesterday ?? null,
    currentPlayers: external?.currentPlayers ?? null,
    allTimePeak: external?.allTimePeak ?? null,
    // Month of that peak. Without it the week-one rule declines.
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
    // The estimators decline everything that is not a base game — see
    // APP_TYPES. Null (a failed appdetails) reads as "game".
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
