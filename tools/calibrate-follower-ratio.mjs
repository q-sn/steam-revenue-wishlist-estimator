#!/usr/bin/env node
/**
 * Measures the follower-to-wishlist multiplier, instead of citing it.
 *
 * WISHLIST.median is 12x, from GameDiscoverCo's June 2023 survey of 125+
 * developers. That number has a known problem and a suspected one.
 *
 * The known problem is age. The same survey run in February 2021 put the
 * median at 9.6x, so between two vintages the ratio moved 25% — it is not a
 * constant of nature, it is a property of how Steam surfaces unreleased games
 * that year. Three years have passed since the 2023 reading and nothing here
 * knows which way it went.
 *
 * The suspected problem is selection. Both surveys asked developers to
 * volunteer their own numbers, and a developer with a flattering ratio is a
 * developer more likely to answer.
 *
 * This measures the same quantity from data nobody was asked for. Every anchor
 * in data/wishlist-anchors.ndjson is a wishlist count a studio announced on
 * its own store page; the follower count for the same app is public. Dividing
 * one by the other is the multiplier, per game, with no survey in between.
 *
 *   node tools/calibrate-follower-ratio.mjs
 *   node tools/calibrate-follower-ratio.mjs --window 30
 *   node tools/calibrate-follower-ratio.mjs --json
 *
 * Read the result as a floor, not as a point. Two biases push it down and
 * neither pushes back:
 *
 *   1. An announcement is a threshold crossing. "100,000 wishlists!" means at
 *      least 100,000, so every numerator is slightly low.
 *   2. Follower counts are read today; the wishlist figure was true on the day
 *      it was posted. Followers only accumulate, so every denominator is
 *      slightly high.
 *
 * A measured median at or above the published 12x therefore says the published
 * figure is not too generous. A measured median below it says less than it
 * looks like it does, which is why the window matters and why it is tight.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WISHLIST } from '../src/core/constants.js';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : argv[at + 1] ?? fallback;
};

const ANCHORS = valueOf('--anchors', 'data/wishlist-anchors.ndjson');
const WINDOW_DAYS = Number(valueOf('--window', 14));
const DELAY_MS = Number(valueOf('--delay', 2500));
const MAX_ATTEMPTS = 4;
const JSON_OUT = has('--json');

const DAY_MS = 24 * 60 * 60 * 1000;
const UA = { 'User-Agent': 'steam-revenue-wishlist-estimator/calibration (+https://github.com/q-sn/steam-revenue-wishlist-estimator)' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const quantile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

/**
 * Followers, from the member count of the group a follow silently joins.
 *
 * Retried, and the retries are the whole point. steamcommunity.com throttles
 * by answering HTTP 200 with a page that has no member count in it — the same
 * shape of lie the store search tells, and the same trap. A first version of
 * this read that as "this game has no group keyed to its app ID", which is a
 * real condition that looks identical, and quietly dropped 77% of a 274-game
 * sample. The survivors were not a random 23%: they were whichever requests
 * happened to arrive between throttle windows, and the median computed from
 * them was a number about network timing.
 *
 * So a missing count is treated as a maybe until several attempts have said
 * otherwise, and the caller is told which of the two answers it got.
 */
async function followersFor(appid) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`https://steamcommunity.com/games/${appid}/memberslistxml/?xml=1`, { headers: UA });
      if (res.ok) {
        const match = (await res.text()).match(/<memberCount>(\d+)<\/memberCount>/);
        if (match) return { followers: Number(match[1]) };
      }
    } catch { /* same handling as an empty body */ }
    if (attempt < MAX_ATTEMPTS) await sleep(DELAY_MS * attempt * 2);
  }
  return { followers: null };
}

async function loadAnchors(path) {
  if (!existsSync(path)) return [];
  const rows = [];
  for (const line of (await readFile(path, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* half-written line */ }
  }
  return rows;
}

/**
 * One disclosure per app: the most recent.
 *
 * A studio that announced 100k, 200k and 500k contributes one data point, not
 * three. Counting every milestone would weight loud studios by how often they
 * post, and the older two are stale against a follower count read today.
 */
function newestPerApp(anchors) {
  const best = new Map();
  for (const row of anchors) {
    const seen = best.get(row.appid);
    if (!seen || row.announcedAt > seen.announcedAt) best.set(row.appid, row);
  }
  return [...best.values()];
}

async function main() {
  const all = await loadAnchors(resolve(ANCHORS));
  const fresh = newestPerApp(all).filter((row) => {
    const drift = Math.abs(Date.now() - new Date(row.announcedAt)) / DAY_MS;
    return Number.isFinite(drift) && drift <= WINDOW_DAYS;
  });

  const measured = [];
  const unreadable = [];

  for (const row of fresh) {
    const { followers } = await followersFor(row.appid);
    await sleep(DELAY_MS);
    if (!followers) { unreadable.push(row.appid); continue; }
    measured.push({
      appid: row.appid,
      rank: row.rank,
      announcedAt: row.announcedAt,
      ageDays: Math.round((Date.now() - new Date(row.announcedAt)) / DAY_MS),
      wishlists: row.wishlists,
      followers,
      ratio: row.wishlists / followers
    });
  }

  measured.sort((a, b) => a.ratio - b.ratio);
  const ratios = measured.map((r) => r.ratio);
  const summary = ratios.length ? {
    n: ratios.length,
    min: ratios[0],
    p10: quantile(ratios, 0.1),
    median: quantile(ratios, 0.5),
    p90: quantile(ratios, 0.9),
    max: ratios[ratios.length - 1],
    insidePublished: measured.filter((r) => r.ratio >= WISHLIST.lo && r.ratio <= WISHLIST.hi).length / ratios.length
  } : null;

  if (JSON_OUT) {
    console.log(JSON.stringify({
      anchorsOnFile: all.length,
      appsInWindow: fresh.length,
      windowDays: WINDOW_DAYS,
      unreadableFollowers: unreadable.length,
      published: { lo: WISHLIST.lo, median: WISHLIST.median, hi: WISHLIST.hi },
      summary,
      measured
    }, null, 2));
    return;
  }

  console.log('\n  Follower-to-wishlist multiplier, measured against announced figures');
  console.log(`  ${all.length} disclosures on file, ${fresh.length} apps announced within ${WINDOW_DAYS} days, `
    + `${measured.length} with a readable follower count\n`);

  // Games whose community group is not keyed to their app ID are a small
  // minority. A large one means the run was throttled and the survivors are
  // whichever requests got through, which is not a sample of anything.
  const dropout = fresh.length ? unreadable.length / fresh.length : 0;
  if (dropout > 0.15) {
    console.log(`  WARNING: ${(dropout * 100).toFixed(0)}% of follower counts came back empty.`);
    console.log('  That is far above the rate of games without an app-keyed group, so this');
    console.log('  run was rate-limited and what survived is not a random subset. Raise');
    console.log('  --delay and run it again before believing any figure below.\n');
  }

  if (!measured.length) {
    console.log('  Nothing measurable yet.\n');
    console.log('  This needs disclosures fresh enough that a follower count read today');
    console.log('  still describes the same week. Run tools/harvest-anchors.mjs daily and');
    console.log('  the window fills on its own; roughly one in eight archived disclosures');
    console.log('  is recent on any given day.\n');
    return;
  }

  console.log('     app      rank    followers    announced WL     ratio   age');
  console.log('  ' + '─'.repeat(64));
  for (const r of measured) {
    console.log(
      `  ${String(r.appid).padStart(8)}`
      + `${String(r.rank ?? '-').padStart(8)}`
      + `${r.followers.toLocaleString('en-US').padStart(13)}`
      + `${r.wishlists.toLocaleString('en-US').padStart(16)}`
      + `${r.ratio.toFixed(1).padStart(9)}x`
      + `${String(r.ageDays).padStart(5)}d`
    );
  }
  console.log('  ' + '─'.repeat(64));

  console.log(`\n  ${summary.n} games measured`);
  console.log(`  min ${summary.min.toFixed(1)}x  p10 ${summary.p10.toFixed(1)}x  `
    + `median ${summary.median.toFixed(1)}x  p90 ${summary.p90.toFixed(1)}x  max ${summary.max.toFixed(1)}x`);
  console.log(`  inside the published ${WISHLIST.lo}x-${WISHLIST.hi}x band: ${(summary.insidePublished * 100).toFixed(0)}%`);
  console.log(`\n  In use: median ${WISHLIST.median}x, band ${WISHLIST.lo}x-${WISHLIST.hi}x `
    + `(GameDiscoverCo, June 2023, 125+ self-reported games)`);

  const drift = summary.median / WISHLIST.median;
  console.log(`  Measured median sits at ${drift.toFixed(2)}x the figure in use.`);

  console.log('\n  Both biases here point downward — an announcement is a threshold, and');
  console.log('  follower counts are read later than the figure they are divided into —');
  console.log('  so this median is a floor. Above the published number it is evidence the');
  console.log('  published number is not too high; below it, the sample is telling you');
  console.log('  less than the arithmetic suggests.\n');
  console.log('  Do not move WISHLIST.median on a handful of games. The surveys behind it');
  console.log('  had 113 and 125+; a dozen anchors is a direction, not a replacement.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
