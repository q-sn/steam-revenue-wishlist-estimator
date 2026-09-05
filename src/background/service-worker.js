/**
 * Cross-origin work and persistence. Every request to steamcommunity.com,
 * api.steampowered.com, steamspy.com and steamcharts.com goes through here,
 * as does the local snapshot history.
 *
 * There is no DOM in an MV3 service worker, so the follower XML is matched
 * with a regex rather than DOMParser.
 */

import { HISTORY, WISHLIST_RANK, WISHLIST_SAID } from '../core/constants.js';
import { parseChartsStats, parseMonthlyHistory, parseRecentTrend, allTimePeakMonth } from '../core/units.js';
import { appendSnapshot, diffSince } from '../core/history.js';

// SteamSpy asks for no more than one appdetails request per second, and
// SteamCharts is a free site with no API carrying whatever we send it.
const THROTTLE_MS = { default: 400, steamspy: 1100, steamcharts: 1500 };
const lastFetchAt = { default: 0, steamspy: 0, steamcharts: 0 };

/**
 * One request per bucket at a time, spaced by at least the bucket's gap.
 *
 * Each bucket is a promise chain that callers queue on. Sleeping on a shared
 * timestamp instead does not rate-limit anything: concurrent callers all read
 * the clock before any of them writes it and then fire together.
 *
 * The queue lives only as long as the worker, which MV3 shuts down after about
 * thirty seconds idle.
 */
const queues = { default: Promise.resolve(), steamspy: Promise.resolve(), steamcharts: Promise.resolve() };

function throttle(bucket = 'default') {
  const gap = THROTTLE_MS[bucket] ?? THROTTLE_MS.default;
  const turn = (queues[bucket] ?? Promise.resolve()).then(async () => {
    const wait = gap - (Date.now() - (lastFetchAt[bucket] ?? 0));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastFetchAt[bucket] = Date.now();
  });
  // A rejected turn must not wedge the bucket for the rest of the session.
  queues[bucket] = turn.catch(() => {});
  return turn;
}

async function cacheGet(key, ttl) {
  const store = await chrome.storage.local.get(key);
  const hit = store[key];
  if (!hit) return null;
  return Date.now() - hit.at > ttl ? { stale: true, ...hit } : hit;
}

function cacheSet(key, value) {
  return chrome.storage.local.set({ [key]: { value, at: Date.now() } });
}

/**
 * Cache, then fetch, then fall back to the stale copy — with `stale: true` on
 * the result so callers can report it.
 */
async function cached(key, bucket, fetcher, ttl = HISTORY.cacheTtlMs) {
  const hit = await cacheGet(key, ttl);
  if (hit && !hit.stale) return { value: hit.value, cached: true, at: hit.at };

  try {
    await throttle(bucket);
    const value = await fetcher();
    await cacheSet(key, value);
    return { value, cached: false, at: Date.now() };
  } catch (err) {
    if (hit) return { value: hit.value, cached: true, stale: true, at: hit.at, error: String(err) };
    return { value: null, error: String(err) };
  }
}

/**
 * Follower count, read as the member count of the hidden group a follow joins.
 * Null for titles whose community group is not keyed to the app ID.
 */
function fetchFollowers(appId) {
  return cached(`followers:${appId}`, 'default', async () => {
    const res = await fetch(
      `https://steamcommunity.com/games/${appId}/memberslistxml/?xml=1`,
      { credentials: 'omit' }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const m = text.match(/<memberCount>(\d+)<\/memberCount>/);
    if (!m) throw new Error('no memberCount in response');
    return Number(m[1]);
  });
}

/**
 * Owner band and yesterday's peak. Keyless. `average_forever` is not read: it
 * is zero for every game checked, so playtime comes from the review sample.
 */
function fetchSteamSpy(appId) {
  return cached(`steamspy:${appId}`, 'steamspy', async () => {
    const res = await fetch(
      `https://steamspy.com/api.php?request=appdetails&appid=${appId}`,
      { credentials: 'omit' }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!json || json.appid == null) throw new Error('empty SteamSpy response');
    return {
      owners: json.owners ?? null,
      peakCcu: Number.isFinite(json.ccu) ? json.ccu : null,
      // Carried only so the core can tell an unprocessed record from a small
      // game: SteamSpy answers for every app id it has heard of, and an
      // unprocessed one reads as owners '0 .. 20,000' with every field zero.
      recordedReviews: (Number(json.positive) || 0) + (Number(json.negative) || 0)
    };
  });
}

/**
 * All-time peak, the month it fell in, and the monthly average-concurrents
 * series, scraped from SteamCharts. The only HTML page read here — no public
 * API exposes these. Cached for a day.
 */
function fetchCharts(appId) {
  return cached(`charts:${appId}`, 'steamcharts', async () => {
    const res = await fetch(`https://steamcharts.com/app/${appId}`, { credentials: 'omit' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();

    const stats = parseChartsStats(html);
    const history = parseMonthlyHistory(html);
    const trend = parseRecentTrend(html);
    if (!stats && !history) throw new Error('nothing readable in page');

    const peakMonth = allTimePeakMonth(history);
    return {
      ...(stats ?? {}),
      trend,
      // Newest first, as the page prints them. Trimmed to the fields the
      // estimators use, since the raw table is ~100 rows per game in storage.
      monthlyHistory: (history?.months ?? []).map((m) => ({
        year: m.year,
        monthIndex: m.monthIndex,
        avgPlayers: m.avgPlayers
      })),
      allTimePeakAt: peakMonth?.at ?? null,
      allTimePeakMonthLabel: peakMonth ? `${peakMonth.year}-${String(peakMonth.monthIndex + 1).padStart(2, '0')}` : null
    };
  });
}

/** Live concurrent players straight from Valve. Keyless, short TTL. */
function fetchCurrentPlayers(appId) {
  // Passes its own short TTL rather than inheriting the day-long default.
  return cached(`ccu:${appId}`, 'default', async () => {
    const res = await fetch(
      `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/?appid=${appId}`,
      { credentials: 'omit' }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const players = json?.response?.player_count;
    if (!Number.isFinite(players)) throw new Error('no player_count');
    return players;
  }, HISTORY.liveTtlMs);
}


/**
 * Steam's Top Wishlists ordering: one shared snapshot of the whole ordering,
 * built daily in CI and served from a CDN. The request is identical whatever
 * game is on screen, so it discloses nothing about browsing. See
 * WISHLIST_RANK.feed for why it is not crawled here.
 */
const RANKS_KEY = 'wishlistRanks';
const RANKS_ALARM = 'refresh-wishlist-ranks';

async function downloadRanks() {
  const urls = [WISHLIST_RANK.feed.url, WISHLIST_RANK.feed.fallbackUrl];
  let lastError = null;

  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // A payload missing any of these is half-published or somebody else's
      // JSON; either way its positions cannot be trusted.
      if (!Array.isArray(json?.appids) || !json.appids.length
          || !Number.isFinite(json.listed) || !Number.isFinite(json.upcoming)) {
        throw new Error('malformed ranking payload');
      }
      return json;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('no ranking source reachable');
}

/**
 * The stored snapshot, refreshed when older than the publishing cadence. A
 * failed refresh keeps the copy on disk; WISHLIST_RANK.maxAgeMs is where the
 * core stops accepting one, measured from the day it was built.
 */
async function ensureRanks({ force = false } = {}) {
  const store = await chrome.storage.local.get(RANKS_KEY);
  const hit = store[RANKS_KEY];
  if (!force && hit && Date.now() - hit.at < WISHLIST_RANK.feed.refreshMs) return hit;

  try {
    const value = await downloadRanks();
    const fresh = { value, at: Date.now() };
    await chrome.storage.local.set({ [RANKS_KEY]: fresh });
    return fresh;
  } catch {
    return hit ?? null;
  }
}

// Rebuilt per worker lifetime rather than stored.
let rankIndex = { generatedAt: null, map: null };

function indexOf(payload) {
  if (rankIndex.generatedAt !== payload.generatedAt) {
    const map = new Map();
    payload.appids.forEach((id, i) => {
      // Zero marks a position held by a package rather than a game; it is in
      // the file so that index and rank stay the same number.
      if (!id) return;
      // The ordering is live, so a game that moved during the crawl can appear
      // twice. Keep the first, which is the less flattering of the two.
      if (!map.has(id)) map.set(id, i + 1);
    });
    rankIndex = { generatedAt: payload.generatedAt, map };
  }
  return rankIndex.map;
}

async function wishlistRankFor(appId) {
  const hit = await ensureRanks();
  if (!hit?.value) return { wishlistRank: null, wishlistListing: null };

  const payload = hit.value;
  return {
    // Null means below the bottom of the ordering, which the core reads as a
    // ceiling rather than as missing data — but only given a listing.
    wishlistRank: indexOf(payload).get(appId) ?? null,
    wishlistListing: {
      listed: payload.listed,
      upcoming: payload.upcoming,
      // When the store was read, not when it was downloaded.
      at: Date.parse(payload.generatedAt) || hit.at
    }
  };
}

/**
 * Wishlist counts developers announced for their own games — another shared
 * CDN file, ~20 KB for 676 games.
 *
 * Kept in its own store entry rather than folded into the ranking: different
 * steps of the same CI job publish them, so either can be a day behind.
 */
const SAID_KEY = 'wishlistSaid';
const SAID_ALARM = 'refresh-wishlist-said';

async function downloadSaid() {
  const urls = [WISHLIST_SAID.feed.url, WISHLIST_SAID.feed.fallbackUrl];
  let lastError = null;

  for (const url of urls) {
    try {
      const res = await fetch(url, { credentials: 'omit' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json?.said || typeof json.said !== 'object' || !Number.isFinite(json.games)) {
        throw new Error('malformed announcement payload');
      }
      return json;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError ?? new Error('no announcement source reachable');
}

async function ensureSaid({ force = false } = {}) {
  const store = await chrome.storage.local.get(SAID_KEY);
  const hit = store[SAID_KEY];
  if (!force && hit && Date.now() - hit.at < WISHLIST_SAID.feed.refreshMs) return hit;

  try {
    const value = await downloadSaid();
    const fresh = { value, at: Date.now() };
    await chrome.storage.local.set({ [SAID_KEY]: fresh });
    return fresh;
  } catch {
    return hit ?? null;
  }
}

/**
 * No freshness gate, unlike the ranking: an announcement does not go stale,
 * and its age is carried in the figure's own correction and band width.
 */
async function wishlistSaidFor(appId) {
  const hit = await ensureSaid();
  const row = hit?.value?.said?.[String(appId)];
  if (!Array.isArray(row) || !Number.isFinite(row[0]) || typeof row[1] !== 'string') return null;
  return { wishlists: row[0], announcedAt: row[1] };
}

/** Everything the estimators need from outside the store page, in one round trip. */
async function fetchExternal(appId) {
  const [followers, spy, players, charts, ranks, said] = await Promise.all([
    fetchFollowers(appId),
    fetchSteamSpy(appId),
    fetchCurrentPlayers(appId),
    fetchCharts(appId),
    wishlistRankFor(appId),
    wishlistSaidFor(appId)
  ]);

  return {
    ...ranks,
    wishlistSaid: said,
    followers: followers.value ?? null,
    followersStale: Boolean(followers.stale),
    owners: spy.value?.owners ?? null,
    ownerRecordReviews: spy.value?.recordedReviews ?? null,
    // SteamSpy's `ccu` is the peak for yesterday, not for all time.
    peakCcuYesterday: spy.value?.peakCcu ?? null,
    currentPlayers: players.value ?? null,
    allTimePeak: charts.value?.allTimePeak ?? null,
    allTimePeakAt: charts.value?.allTimePeakAt ?? null,
    monthlyHistory: charts.value?.monthlyHistory ?? null,
    // From Valve's API by way of SteamCharts, so exact rather than sampled.
    peak24h: charts.value?.peak24h ?? null,
    trend: charts.value?.trend ?? null
  };
}

/** Record this visit and report what moved since the last one. Local only. */
async function recordHistory(appId, snapshot) {
  const key = `history:${appId}`;
  const store = await chrome.storage.local.get(key);
  const series = store[key] ?? [];

  const delta = diffSince(series, snapshot);
  const next = appendSnapshot(series, snapshot);
  await chrome.storage.local.set({ [key]: next });

  return { series: next, delta };
}

/**
 * Every cached key. Adding a cache means adding its prefix here, or the clear
 * button silently leaves it behind and under-reports what it removed.
 */
const CACHE_PREFIXES = [
  'followers:', 'steamspy:', 'ccu:', 'charts:',
  'sReviews:', 'sDetails:', 'sLang:', 'sSample:',
  'history:',
  // Not per-game, but still cached from somebody's server.
  RANKS_KEY,
  SAID_KEY
];

async function clearAllCaches() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => CACHE_PREFIXES.some((p) => k.startsWith(p)));
  if (keys.length) await chrome.storage.local.remove(keys);
  return keys.length;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg?.type) {
    case 'getExternal':
      fetchExternal(msg.appId).then((data) => sendResponse({ ok: true, ...data }));
      return true;

    case 'recordHistory':
      recordHistory(msg.appId, msg.snapshot).then((r) => sendResponse({ ok: true, ...r }));
      return true;

    case 'clearCaches':
      clearAllCaches().then((removed) => sendResponse({ ok: true, removed }));
      return true;

    case 'openOptions':
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      return false;

    default:
      return false;
  }
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// Keeps the snapshots warm, so no page view waits on the download.
//
// Created only when absent: `alarms.create` on an existing name restarts its
// period, and this file runs on every worker wake — which is constantly — so
// recreating unconditionally would reset the timer before it ever fires.
chrome.alarms.get(SAID_ALARM).then((existing) => {
  if (!existing) {
    chrome.alarms.create(SAID_ALARM, { periodInMinutes: WISHLIST_SAID.feed.refreshMs / 60000 });
  }
});
chrome.alarms.get(RANKS_ALARM).then((existing) => {
  if (!existing) {
    chrome.alarms.create(RANKS_ALARM, { periodInMinutes: WISHLIST_RANK.feed.refreshMs / 60000 });
  }
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RANKS_ALARM) ensureRanks();
  if (alarm.name === SAID_ALARM) ensureSaid();
});
chrome.runtime.onInstalled.addListener(() => { ensureRanks({ force: true }); ensureSaid({ force: true }); });
chrome.runtime.onStartup.addListener(() => { ensureRanks(); ensureSaid(); });
