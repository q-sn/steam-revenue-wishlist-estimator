#!/usr/bin/env node
/**
 * Collects real wishlist numbers from the places developers publish them.
 *
 * Steam's ranking is ordinal and the distribution it is inverted through is
 * somebody else's dataset, so the mapping in src/core/wishlist-rank.js needs
 * something to be checked against. The check is games where the actual figure
 * is known — and developers announce it themselves, on their own store page,
 * every time they cross a round number:
 *
 *   "100,000 Wishlists - Thank You!"
 *   "over the hill has just hit 1,000,000 wishlists on Steam"
 *
 * Those posts come back from ISteamNews, which needs no key. Measured over a
 * sample of 300 ranked games, 18% of them have posted at least one such
 * number, which extrapolates to roughly 900 across the whole ordering. The
 * yield falls with rank — about a quarter of the top of the list against one
 * in twenty-five near the bottom — but it does not run out, so the check has
 * coverage everywhere the estimate does.
 *
 *   node tools/harvest-anchors.mjs
 *   node tools/harvest-anchors.mjs --max-apps 300
 *   node tools/harvest-anchors.mjs --ranks data/wishlist-ranks.json
 *
 * Output is appended to data/wishlist-anchors.ndjson, one JSON object a line,
 * deduplicated on the app and the announcement. Appending rather than
 * rewriting is the whole design: a disclosure is only a usable anchor when
 * the rank was read near the day it was made, and running daily is what
 * produces same-day pairs. Retrofitting an old announcement to today's rank
 * pairs a number from March with a position from September.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const argv = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : argv[at + 1] ?? fallback;
};

const RANKS = valueOf('--ranks', 'data/wishlist-ranks.json');
const OUT = valueOf('--out', 'data/wishlist-anchors.ndjson');
const MAX_APPS = Number(valueOf('--max-apps', Infinity));
const DELAY_MS = Number(valueOf('--delay', 180));
const NEWS_ITEMS = Number(valueOf('--news-items', 50));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A count immediately before the word "wishlist".
 *
 * Only that order. The mirror form — "wishlist" and then a number — reads
 * game titles as data: "Wishlist Warhammer 40,000: Dawn of War" scores as
 * forty thousand wishlists, and titles with numbers in them are common enough
 * that the pattern costs more than the handful of "wishlists: 50,000" posts
 * it would catch.
 */
const COUNT = String.raw`(\d{1,3}(?:[,.  ]\d{3})+|\d+(?:[.,]\d+)?\s*[kKmM]\b|\d{4,})`;
const MILESTONE = new RegExp(COUNT + String.raw`\s*\+?\s*(?:steam\s+)?wishlists?`, 'gi');

/**
 * Most mentions of "wishlist" on a store page are a request, not a report:
 * "wishlist us now", "add to your wishlist". A number near one of those is
 * usually a price, a date or a player count. Requiring a word that reports an
 * achievement is what separates the two.
 */
const ACHIEVEMENT = /\b(hit|hits|reach|reached|reaching|passed|surpass|surpassed|crossed|milestone|thank|thanks|celebrat|achiev|now at|we(?:'ve| have)|just got|over)\b/i;

const stripHtml = (html) => String(html ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ')
  .trim();

/** "650 000" / "1,000,000" / "100k" / "1.5M" -> a number. */
function parseCount(raw) {
  const text = raw.trim().toLowerCase();
  const scale = text.endsWith('m') ? 1_000_000 : text.endsWith('k') ? 1_000 : 1;
  const digits = text.replace(/[km]$/, '').trim();
  const value = scale === 1
    ? Number(digits.replace(/[,.  ]/g, ''))
    : Number(digits.replace(/,/g, '.'));
  return Number.isFinite(value) ? Math.round(value * scale) : null;
}

/** Whether a figure is a round milestone, which most of them are. */
function isRound(value) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return value % magnitude === 0 || value % (magnitude / 2) === 0;
}

function milestonesIn(item) {
  const text = stripHtml(`${item.title} . ${item.contents}`);
  const out = [];

  for (const match of text.matchAll(MILESTONE)) {
    const value = parseCount(match[1]);
    // Below a thousand this is almost always a demo player count or a
    // giveaway, and above ten million nobody has been.
    if (value == null || value < 1_000 || value > 10_000_000) continue;

    const around = text.slice(Math.max(0, match.index - 90), match.index + 90);
    if (!ACHIEVEMENT.test(around)) continue;

    out.push({ wishlists: value, round: isRound(value), quoted: around.trim() });
  }

  // One figure per post. A milestone announcement repeats its own number in
  // the title and the body, and celebrating two at once ("100k wishlists and
  // 50k followers") is a different number wearing the same words.
  const byValue = new Map(out.map((m) => [m.wishlists, m]));
  return byValue.size === 1 ? [...byValue.values()] : [];
}

async function newsFor(appid) {
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}`
    + `&count=${NEWS_ITEMS}&maxlength=8000`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return json?.appnews?.newsitems ?? [];
  } catch {
    return [];
  }
}

async function existingKeys(path) {
  if (!existsSync(path)) return new Set();
  const text = await readFile(path, 'utf8');
  const keys = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      keys.add(`${row.appid}:${row.announcedAt}:${row.wishlists}`);
    } catch { /* a half-written line from a killed run */ }
  }
  return keys;
}

async function main() {
  const ranks = JSON.parse(await readFile(resolve(RANKS), 'utf8'));
  const rankOf = new Map(ranks.appids.map((id, i) => [id, i + 1]));
  const rankAt = new Date(ranks.generatedAt).toISOString().slice(0, 10);

  const out = resolve(OUT);
  await mkdir(dirname(out), { recursive: true });
  const seen = await existingKeys(out);

  const apps = ranks.appids.slice(0, Number.isFinite(MAX_APPS) ? MAX_APPS : undefined);
  const fresh = [];
  let scanned = 0;

  for (const appid of apps) {
    scanned++;
    for (const item of await newsFor(appid)) {
      const announcedAt = new Date(item.date * 1000).toISOString().slice(0, 10);
      for (const found of milestonesIn(item)) {
        const key = `${appid}:${announcedAt}:${found.wishlists}`;
        if (seen.has(key)) continue;
        seen.add(key);
        fresh.push({
          appid,
          // Today's position. Only comparable with a figure announced near
          // today; tools/calibrate-wishlist-rank.mjs is where that is enforced.
          rank: rankOf.get(appid) ?? null,
          rankAt,
          announcedAt,
          wishlists: found.wishlists,
          round: found.round,
          listed: ranks.listed,
          upcoming: ranks.upcoming,
          url: item.url ?? null,
          quoted: found.quoted.slice(0, 200)
        });
      }
    }
    if (scanned % 250 === 0) {
      process.stderr.write(`  ${scanned}/${apps.length} scanned, ${fresh.length} new\n`);
    }
    await sleep(DELAY_MS);
  }

  if (fresh.length) {
    const body = fresh.map((row) => JSON.stringify(row)).join('\n') + '\n';
    await writeFile(out, body, { flag: 'a' });
  }

  const sameDay = fresh.filter((r) => r.announcedAt === r.rankAt).length;
  process.stderr.write(
    `${scanned} games scanned, ${fresh.length} new disclosures, ${sameDay} of them announced today `
    + `(those are the ones that pair cleanly with a rank) -> ${OUT}\n`
  );
}

main().catch((err) => {
  console.error(String(err.message ?? err));
  process.exit(1);
});
