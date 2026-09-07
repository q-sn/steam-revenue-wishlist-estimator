/**
 * One game's inputs, from the endpoints the extension itself reads.
 *
 * Mirrors `collect()` in src/content/scrape.js and `fetchExternal()` in the
 * service worker, in Node: same endpoints, same fields, same parsers imported
 * from the core rather than reimplemented. What a screenshot shows is
 * therefore what the extension would have drawn for that game that day.
 *
 * The two DOM-derived fields — user tags and the review-trend rows — stay
 * null here and are read off the live page by page.js, because that is where
 * scrape.js reads them from too.
 *
 * The two published wishlist feeds are held for the length of the process and
 * written nowhere: `data/` is where tools/crawl-wishlist-ranks.mjs and
 * tools/condense-anchors.mjs keep their own copies of those same file names,
 * and a screenshot has no business overwriting a crawl.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseChartsStats, parseMonthlyHistory, parseRecentTrend, allTimePeakMonth,
  medianHours, firstSaleDate
} from '../src/core/units.js';
import { LANGUAGE_REGIONS, WISHLIST_RANK, WISHLIST_SAID } from '../src/core/constants.js';

const HERE = dirname(fileURLToPath(import.meta.url));
export const INPUTS = join(HERE, 'inputs');

// SteamCharts serves a browser and returns 403 to anything that announces
// itself as a script.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  + ' (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function getText(url) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

const reviewsUrl = (appId, params) =>
  `https://store.steampowered.com/appreviews/${appId}?json=1&purchase_type=all&${params}`;

const parseDate = (s) => (s && Number.isFinite(Date.parse(s)) ? Date.parse(s) : null);
const parseYear = (s) => Number(String(s ?? '').match(/(19|20)\d{2}/)?.[0]) || null;

async function reviewSummary(appId) {
  const data = await getJson(reviewsUrl(appId, 'num_per_page=0&language=all&filter=summary'));
  const q = data?.query_summary;
  const total = q?.total_reviews;
  if (!Number.isFinite(total)) throw new Error('no query_summary');
  return { reviews: total, positivePct: total > 0 ? (q.total_positive / total) * 100 : null };
}

async function languageMix(appId, total) {
  if (!Number.isFinite(total) || total < LANGUAGE_REGIONS.minReviews) return null;
  const codes = LANGUAGE_REGIONS.discounted.join(',');
  const data = await getJson(reviewsUrl(appId, `num_per_page=0&language=${codes}&filter=summary`));
  const discounted = data?.query_summary?.total_reviews;
  return Number.isFinite(discounted) ? { discounted, total } : null;
}

async function reviewSample(appId) {
  const data = await getJson(reviewsUrl(appId, 'num_per_page=100&language=all&filter=recent'));
  const reviews = data?.reviews;
  if (!Array.isArray(reviews) || !reviews.length) return null;

  const playtimes = reviews
    .map((r) => r.author?.playtime_forever)
    .filter((m) => Number.isFinite(m) && m > 0);

  return {
    sampleSize: reviews.length,
    medianPlaytimeHours: medianHours(playtimes),
    steamPurchaseShare: reviews.filter((r) => r.steam_purchase === true).length / reviews.length,
    freeShare: reviews.filter((r) => r.received_for_free === true).length / reviews.length
  };
}

async function appDetails(appId) {
  const data = await getJson(
    `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=en`
  );
  const entry = data?.[String(appId)];
  if (!entry?.success || !entry.data) throw new Error('appdetails unsuccessful');
  const d = entry.data;

  return {
    name: d.name,
    isFree: Boolean(d.is_free),
    price: d.price_overview ? d.price_overview.final / 100 : d.is_free ? 0 : null,
    listPrice: d.price_overview ? d.price_overview.initial / 100 : d.is_free ? 0 : null,
    discountPct: d.price_overview?.discount_percent ?? 0,
    released: d.release_date ? !d.release_date.coming_soon : null,
    releaseYear: parseYear(d.release_date?.date),
    releaseDate: parseDate(d.release_date?.date),
    tags: (d.genres ?? []).map((g) => g.description),
    dlcCount: Array.isArray(d.dlc) ? d.dlc.length : 0,
    type: d.type,
    fullGameId: Number(d.fullgame?.appid) || null,
    fullGameName: d.fullgame?.name ?? null
  };
}

async function firstSale(appId) {
  const data = await getJson(
    `https://store.steampowered.com/appreviewhistogram/${appId}?l=english`
  );
  const start = data?.results?.start_date;
  return Number.isFinite(start) ? start * 1000 : null;
}

async function followers(appId) {
  const text = await getText(`https://steamcommunity.com/games/${appId}/memberslistxml/?xml=1`);
  const m = text.match(/<memberCount>(\d+)<\/memberCount>/);
  return m ? Number(m[1]) : null;
}

async function steamSpy(appId) {
  const json = await getJson(`https://steamspy.com/api.php?request=appdetails&appid=${appId}`);
  if (!json || json.appid == null) throw new Error('empty SteamSpy response');
  return {
    owners: json.owners ?? null,
    peakCcu: Number.isFinite(json.ccu) ? json.ccu : null,
    recordedReviews: (Number(json.positive) || 0) + (Number(json.negative) || 0)
  };
}

async function charts(appId) {
  const html = await getText(`https://steamcharts.com/app/${appId}`);
  const stats = parseChartsStats(html);
  const history = parseMonthlyHistory(html);
  if (!stats && !history) throw new Error('nothing readable in page');
  const peakMonth = allTimePeakMonth(history);

  return {
    ...(stats ?? {}),
    trend: parseRecentTrend(html),
    monthlyHistory: (history?.months ?? []).map((m) => ({
      year: m.year, monthIndex: m.monthIndex, avgPlayers: m.avgPlayers
    })),
    allTimePeakAt: peakMonth?.at ?? null
  };
}

async function currentPlayers(appId) {
  const json = await getJson(
    'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/'
    + `?appid=${appId}`
  );
  const n = json?.response?.player_count;
  return Number.isFinite(n) ? n : null;
}

/**
 * The daily ranking and announcement files, once per run however many games
 * are collected. Both are one file for every game, exactly as the extension
 * downloads them.
 */
let feedsOnce = null;
function feeds() {
  feedsOnce ??= Promise.all([
    getJson(WISHLIST_RANK.feed.url),
    getJson(WISHLIST_SAID.feed.url)
  ]).then(([ranks, said]) => ({ ranks, said }));
  return feedsOnce;
}

/**
 * An absent source is a null field rather than a failed run: an unreleased
 * game has no SteamCharts page and no player count, and that is exactly the
 * case a wishlist screenshot is for.
 */
const soft = (p) => p.catch((err) => {
  console.warn(`    (no answer: ${String(err).replace(/^Error:\s*/, '').slice(0, 80)})`);
  return null;
});

/** Collect one game and write inputs/game-<appId>.json. Returns the game. */
export async function collect(appId) {
  const { ranks, said } = await feeds();

  const [summary, details, first, folw, spy, ccu, chart] = await Promise.all([
    soft(reviewSummary(appId)),
    soft(appDetails(appId)),
    soft(firstSale(appId)),
    soft(followers(appId)),
    soft(steamSpy(appId)),
    soft(currentPlayers(appId)),
    soft(charts(appId))
  ]);

  const reviews = summary?.reviews ?? null;
  const [mix, sample] = await Promise.all([
    soft(languageMix(appId, reviews)),
    reviews > 0 ? soft(reviewSample(appId)) : null
  ]);

  // The store's date is the 1.0 date; the review history knows when the game
  // first took money. See firstSaleDate.
  const sale = firstSaleDate(details?.releaseDate ?? null, first);
  const rankIndex = ranks.appids.indexOf(appId);
  const saidRow = said.said?.[String(appId)];

  const game = {
    appId,
    name: details?.name ?? null,
    reviews,
    positivePct: summary?.positivePct ?? null,
    isFree: details?.isFree ?? false,
    price: details?.price ?? null,
    listPrice: details?.listPrice ?? details?.price ?? null,
    discountPct: details?.discountPct ?? 0,
    dlcCount: details?.dlcCount ?? 0,
    released: details?.released ?? true,
    releaseYear: sale?.corrected
      ? new Date(sale.at).getUTCFullYear()
      : details?.releaseYear ?? null,
    releaseDate: sale?.at ?? null,
    storeReleaseYear: details?.releaseYear ?? null,
    firstSaleCorrected: Boolean(sale?.corrected),
    tags: details?.tags ?? [],
    followers: folw ?? null,
    followersStale: false,
    wishlistRank: rankIndex >= 0 ? rankIndex + 1 : null,
    wishlistListing: {
      listed: ranks.listed,
      upcoming: ranks.upcoming,
      at: Date.parse(ranks.generatedAt) || Date.now()
    },
    wishlistSaid: Array.isArray(saidRow)
      ? { wishlists: saidRow[0], announcedAt: saidRow[1] }
      : null,
    owners: spy?.owners ?? null,
    ownerRecordReviews: spy?.recordedReviews ?? null,
    peak24h: chart?.peak24h ?? spy?.peakCcu ?? null,
    peak24hSource: chart?.peak24h != null ? 'charts' : 'steamspy',
    peakCcuYesterday: spy?.peakCcu ?? null,
    currentPlayers: ccu ?? null,
    allTimePeak: chart?.allTimePeak ?? null,
    allTimePeakAt: chart?.allTimePeakAt ?? null,
    monthlyHistory: chart?.monthlyHistory ?? null,
    trend: chart?.trend ?? null,
    reviewerMedianHours: sample?.medianPlaytimeHours ?? null,
    reviewerSampleSize: sample?.sampleSize ?? null,
    steamPurchaseShare: sample?.steamPurchaseShare ?? null,
    freeCopyShare: sample?.freeShare ?? null,
    languageMix: mix ?? null,
    // Read off the page by page.js, as scrape.js does.
    reviewTrend: null,
    festivalContext: 'unknown',
    appType: details?.type ?? null,
    fullGameId: details?.fullGameId ?? null,
    fullGameName: details?.fullGameName ?? null,
    collectedAt: Date.now()
  };

  await mkdir(INPUTS, { recursive: true });
  await writeFile(join(INPUTS, `game-${appId}.json`), `${JSON.stringify(game, null, 2)}\n`);
  return game;
}
