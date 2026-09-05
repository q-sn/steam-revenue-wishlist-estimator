/**
 * Cross-origin work and persistence.
 *
 * steamcommunity.com, api.steampowered.com, steamspy.com and steamcharts.com
 * are all different origins from the store page, so every request to them goes
 * through here. This worker also owns the local snapshot history, so the
 * content script stays a pure renderer.
 *
 * Note there is no DOM in an MV3 service worker: the follower XML is matched
 * with a regex rather than DOMParser, because the payload is a fixed Valve
 * format and we want exactly one integer out of it.
 */

import { HISTORY, WISHLIST_RANK } from '../core/constants.js';
import { parseChartsStats, parseMonthlyHistory, parseRecentTrend, allTimePeakMonth } from '../core/units.js';
import { appendSnapshot, diffSince } from '../core/history.js';

// SteamSpy asks for no more than one appdetails request per second, and
// SteamCharts is a free site with no API carrying whatever we send it.
const THROTTLE_MS = { default: 400, steamspy: 1100, steamcharts: 1500 };
const lastFetchAt = { default: 0, steamspy: 0, steamcharts: 0 };

/**
 * One request per bucket at a time, spaced by at least the bucket's gap.
 *
 * The obvious version of this — read the clock, sleep the difference, write
 * the clock back — does not work, because concurrent callers all read the same
 * clock before any of them writes to it, compute the same delay, and fire
 * together. Four tabs opening at once produced four simultaneous SteamSpy
 * requests while looking like it was rate-limiting them. So each bucket keeps
 * a promise chain and callers queue on it.
 *
 * The queue lives only as long as the worker. MV3 shuts an idle worker down
 * after about thirty seconds, and the gap is a fraction of that, so a request
 * arriving after a restart is not one of a burst anyway.
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
 * Wrap a network read in the same cache-then-fetch-then-fall-back-to-stale
 * pattern. Serving a day-old number beats serving nothing, as long as the
 * staleness is reported upward.
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
 * Follower count.
 *
 * Following a game silently joins a hidden group whose member count is the
 * only public surface for this number. Some titles use a community group that
 * is not keyed to the app ID, in which case there is nothing to read and we
 * return null rather than guessing.
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
 * Owner band and yesterday's peak. Keyless.
 *
 * `average_forever` is not read. SteamSpy still returns the field, and it is
 * zero for every game checked, so the playtime input comes from the reviews
 * endpoint instead — see the review sample in the content script.
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
      // SteamSpy's own review tallies, carried only so the core can tell an
      // empty record from a small game. It answers for every app id it has
      // heard of, including ones it has never processed, and an unprocessed
      // record looks exactly like a tiny game: owners '0 .. 20,000', ccu 0,
      // and these two at zero. PEAK carries 367,000 Steam reviews against an
      // empty record.
      recordedReviews: (Number(json.positive) || 0) + (Number(json.negative) || 0)
    };
  });
}

/**
 * Concurrent-player figures and history, scraped from SteamCharts.
 *
 * The only page here that is HTML rather than an API, because no public API
 * exposes the all-time peak or the monthly series. One request carries three
 * things nothing else can supply: the peak, the month it happened in, and the
 * whole history of average concurrents that the player-hours estimator runs
 * on.
 *
 * Cached for a day. The peak barely moves and the history grows a row a month,
 * but the 30-day trend on the same page does move, and a day means one request
 * per game per day rather than one per page view on a site carrying the cost
 * of everything we ask of it.
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
      // Newest first, as the page prints them. Only the fields the estimators
      // use are kept: the raw table is a hundred-odd rows per game and this
      // goes into storage.
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
  // A live number cached for a day is not a live number, so this one passes
  // its own TTL rather than inheriting the day-long default.
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
 * Steam's Top Wishlists ordering, downloaded as a file.
 *
 * Every other fetch in this worker is per-game and happens because the user
 * opened a page. This one is not: it is one shared snapshot of the whole
 * ordering, built once a day in CI and served to everyone from a CDN. See
 * WISHLIST_RANK.feed for why it is not crawled here.
 *
 * Two properties fall out of that and both matter. The extension makes the
 * same request no matter which game is on screen, so it discloses nothing
 * about browsing; and the load on Valve does not grow with the number of
 * users, because Valve is not the one being asked.
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
      // A payload missing any of these is a half-published file or somebody
      // else's JSON, and either way the positions in it cannot be trusted.
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
 * The stored snapshot, refreshed when it is older than the publishing cadence.
 *
 * A failed refresh keeps the copy already on disk. Positions drift slowly
 * enough that yesterday's file is a good answer and a missed day is not worth
 * losing the estimate over; WISHLIST_RANK.maxAgeMs is where the core stops
 * accepting one, and that check reads the day the snapshot was built rather
 * than the day it was downloaded.
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

// Rebuilt per worker lifetime rather than stored: 5,000-odd entries is a
// millisecond to index and a second copy in storage to keep in step.
let rankIndex = { generatedAt: null, map: null };

function indexOf(payload) {
  if (rankIndex.generatedAt !== payload.generatedAt) {
    const map = new Map();
    payload.appids.forEach((id, i) => {
      // Zero marks a position held by a package rather than a game. It is in
      // the file so that index and rank stay the same number, and it is not a
      // game anyone can look up.
      if (!id) return;
      // The ordering is live, so a game that moved while the crawl was walking
      // past it can appear at two positions. Keep the first: a duplicate means
      // the game was somewhere between them, and the better of two guesses is
      // the one that does not flatter it.
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
    // Absent means the game is below the bottom of the ordering, which is a
    // fact about the game. The core reads it as a ceiling, not as missing data
    // — but only when there is a listing to say what the bottom was.
    wishlistRank: indexOf(payload).get(appId) ?? null,
    wishlistListing: {
      listed: payload.listed,
      upcoming: payload.upcoming,
      // When the store was read, not when we downloaded it. Staleness here is
      // a question about the store having moved on.
      at: Date.parse(payload.generatedAt) || hit.at
    }
  };
}

/** Everything the estimators need from outside the store page, in one round trip. */
async function fetchExternal(appId) {
  const [followers, spy, players, charts, ranks] = await Promise.all([
    fetchFollowers(appId),
    fetchSteamSpy(appId),
    fetchCurrentPlayers(appId),
    fetchCharts(appId),
    wishlistRankFor(appId)
  ]);

  return {
    ...ranks,
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
    // Both this and the peak come from Valve's API by way of SteamCharts, so
    // for a small game they are exact where a sampled figure is rounded.
    peak24h: charts.value?.peak24h ?? null,
    trend: charts.value?.trend ?? null
  };
}

/**
 * Record what we saw and report what moved since the last visit.
 * Stored locally and never transmitted.
 */
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
 * Everything this extension has remembered about other people's servers.
 *
 * Kept as one list so that adding a cache means adding a prefix here too. A
 * prefix left off — `charts:` is the largest thing stored — leaves the button
 * clearing everything but that and under-reporting how much it removed.
 */
const CACHE_PREFIXES = [
  'followers:', 'steamspy:', 'ccu:', 'charts:',
  'sReviews:', 'sDetails:', 'sLang:', 'sSample:',
  'history:',
  // Not per-game and not about the user, but it is still somebody's server
  // cached on this machine, and a button that says it clears everything has
  // to mean it.
  RANKS_KEY
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

    case 'getCurrentPlayers':
      fetchCurrentPlayers(msg.appId).then((r) =>
        sendResponse({ ok: r.value != null, players: r.value, ...r }));
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

/**
 * Keep the ranking snapshot warm.
 *
 * An alarm rather than a fetch on first use, so the first unreleased game of
 * the day is not the one that waits for a 30 KB download. `ensureRanks` is
 * still the gate — the alarm only asks, and asking for something already
 * fresh costs a storage read.
 */
//
// Created only when it is not already there. `alarms.create` with an existing
// name replaces it and restarts its period, and this file runs every time the
// worker wakes — which for an extension that answers a message on every store
// page is constantly. Recreating it unconditionally means an alarm whose timer
// is reset a few seconds before it would have fired, forever.
chrome.alarms.get(RANKS_ALARM).then((existing) => {
  if (!existing) {
    chrome.alarms.create(RANKS_ALARM, { periodInMinutes: WISHLIST_RANK.feed.refreshMs / 60000 });
  }
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RANKS_ALARM) ensureRanks();
});
chrome.runtime.onInstalled.addListener(() => ensureRanks({ force: true }));
chrome.runtime.onStartup.addListener(() => ensureRanks());
