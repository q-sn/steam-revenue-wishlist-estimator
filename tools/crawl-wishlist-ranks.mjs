#!/usr/bin/env node
/**
 * Snapshots Steam's Top Wishlists ordering into data/wishlist-ranks.json.
 *
 * The store publishes a public ranking of unreleased games by wishlists at
 * store.steampowered.com/search/?filter=popularwishlist, in pages the
 * infinite-scroll endpoint hands back as JSON. It prints no counts, so what
 * this collects is one app id per position — an ordinal signal that
 * src/core/wishlist-rank.js turns into a number through a fitted curve.
 *
 * Runs in CI once a day, never in the extension: the whole ordering costs
 * 50-odd requests, and that many per user per day would close the endpoint.
 *
 *   node tools/crawl-wishlist-ranks.mjs
 *   node tools/crawl-wishlist-ranks.mjs --out data/wishlist-ranks.json
 *   node tools/crawl-wishlist-ranks.mjs --delay 2000
 *
 * Two things about this endpoint are worth knowing before changing anything:
 *
 *  - `count` is capped at 100 however much you ask for. Requesting 200 returns
 *    100 and no error.
 *  - `start` is snapped down to a multiple of the page size. Asking for 99
 *    returns the first page again, so pages must be walked by a fixed stride
 *    and never by however many rows the last one happened to yield.
 *  - Not every row is a game. Packages share the ordering and occupy real
 *    positions in it, so they are recorded as holes rather than skipped —
 *    dropping them would shift every rank below them by one.
 *  - Throttling arrives as HTTP 200 with a short or empty body, not as 429.
 *    Every page is therefore required to come back with a full 100 rows —
 *    only the last one may be short — and the run is checked against the total
 *    the store itself reports.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const argv = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : argv[at + 1] ?? fallback;
};

const OUT = valueOf('--out', 'data/wishlist-ranks.json');
const DELAY_MS = Number(valueOf('--delay', 1500));
const PAGE = 100;
const MAX_ATTEMPTS = 6;

/**
 * Region is pinned, and it is not cosmetic.
 *
 * The ordering is global but the store hides titles unavailable in the
 * requesting country, so a page fetched from a different region silently
 * drops rows and shifts every position after them. Comparing a US snapshot
 * with a German one put 83 of the same 100 games in the top 100.
 */
const REGION = { cc: 'us', l: 'english' };

/**
 * Games only, on both queries. Without it the ordering and the count of
 * announced pages quietly include soundtracks and demos.
 *
 * ignore_preferences pins the axis. Steam's default anonymous content
 * preferences hide 415 of 5,574 positions, and hide them non-uniformly — 1.4%
 * of the first 500 against 12.4% of ranks 3001-3500 — so a snapshot taken
 * without it is the real ordering compressed by a factor that reaches 1.08x,
 * and would move under the curve the day Valve changes a default.
 */
const GAMES_ONLY = { category1: '998', ignore_preferences: '1' };

const UA = {
  'User-Agent': 'steam-revenue-wishlist-estimator/ranks (+https://github.com/q-sn/steam-revenue-wishlist-estimator)',
  'Accept-Language': 'en-US,en'
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function searchUrl(params) {
  const qs = new URLSearchParams({ infinite: '1', json: '1', ...REGION, ...params });
  return `https://store.steampowered.com/search/results/?${qs}`;
}

/**
 * One page, retried with a widening gap until it comes back full.
 *
 * A full page is 100 rows; only the last page of the ordering may hold fewer,
 * and the total in the same response says how many. `start` advances by a
 * fixed stride, so a short page anywhere else shifts every rank below it.
 *
 * Returns null after every attempt failed, which the caller treats as a failed
 * run rather than as the end of the list.
 */
async function page(start) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(searchUrl({ filter: 'popularwishlist', ...GAMES_ONLY, start: String(start), count: String(PAGE) }), { headers: UA });
      const text = await res.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* throttled bodies are not JSON */ }

      if (json && typeof json.results_html === 'string') {
        // Every row carries an item key, and its kind is the prefix. A row
        // that is not an app still holds a position, so it goes in as a zero:
        // the index in this array is the rank, and a hole keeps it that way.
        const rows = [...json.results_html.matchAll(/data-ds-itemkey="(App|Sub|Bundle)_(\d+)"/g)]
          .map((m) => (m[1] === 'App' ? Number(m[2]) : 0));

        const total = Number(json.total_count);
        const remaining = Number.isFinite(total) ? total - start : Infinity;
        const want = Math.min(PAGE, Math.max(remaining, 1));
        if (rows.length >= want) return { rows, total: Number.isFinite(total) ? total : null };
      }
    } catch { /* network flake, same handling */ }

    if (attempt < MAX_ATTEMPTS) await sleep(DELAY_MS * attempt * 2);
  }
  return null;
}

/** How many announced games there are in total, ranked or not. */
async function upcomingTotal() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(searchUrl({ filter: 'comingsoon', ...GAMES_ONLY, start: '0', count: '1' }), { headers: UA });
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      if (Number.isFinite(json?.total_count)) return json.total_count;
    } catch { /* retry */ }
    await sleep(DELAY_MS * attempt * 2);
  }
  return null;
}

async function main() {
  const first = await page(0);
  if (!first) throw new Error('could not read the first page of the ordering');
  const total = first.total;
  if (!Number.isFinite(total) || total <= 0) throw new Error(`store reported no total (${total})`);

  const appids = [...first.rows];

  // Fixed stride, because the store rounds `start` down to a page boundary.
  // Advancing by however many rows came back looks more careful and silently
  // refetches page one forever the first time a page is short.
  for (let start = PAGE; start < total; start += PAGE) {
    await sleep(DELAY_MS);
    const next = await page(start);
    if (!next) throw new Error(`ordering stopped at ${appids.length} of ${total}: the page at ${start} never came back full`);
    appids.push(...next.rows);
  }

  const upcoming = await upcomingTotal();
  if (!Number.isFinite(upcoming) || upcoming < appids.length) {
    throw new Error(`could not read the announced-game total (${upcoming})`);
  }

  // Refuse to publish a short list. A truncated ordering does not look broken
  // downstream, it looks like a store where fewer games are wishlisted, which
  // moves every percentile. Every page had to come back full, so the only
  // slack left is a total that moved mid-crawl.
  const completeness = appids.length / total;
  if (completeness < 0.995) {
    throw new Error(`only ${appids.length} of ${total} positions read (${(completeness * 100).toFixed(1)}%); refusing to write a partial ordering`);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'https://store.steampowered.com/search/?filter=popularwishlist',
    region: REGION,
    // Positions actually recorded, which is what rank is out of. Includes the
    // holes where a package sits, because those are positions too.
    listed: appids.length,
    // What the store said the ordering holds, kept so a future short run is
    // visible in the file rather than only in the logs.
    reported: total,
    // Every game with a store page and no release date, ranked or not. The
    // ordering covers the top of this, and a game absent from it is bounded
    // by the position where the ordering stops.
    upcoming,
    appids
  };

  const out = resolve(OUT);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify(payload));

  const kb = (JSON.stringify(payload).length / 1024).toFixed(1);
  process.stderr.write(
    `${appids.length} positions of ${total} reported, out of ${upcoming} announced games `
    + `(${((appids.length / upcoming) * 100).toFixed(1)}% covered), ${kb} KB -> ${OUT}\n`
  );
}

main().catch((err) => {
  console.error(String(err.message ?? err));
  process.exit(1);
});
