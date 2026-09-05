#!/usr/bin/env node
/**
 * Checks the rank-to-wishlists mapping against numbers developers announced.
 *
 * Nothing here fits anything. The mapping in src/core/wishlist-rank.js is a
 * published distribution inverted at a measured position, and it has no free
 * parameters to tune — which is the reason for it rather than a fitted curve.
 * What it does have is three assumptions that could each be wrong, and this
 * script is how they get found out:
 *
 *   1. That Steam's ordering ranks by wishlist balance. Valve does not say.
 *      If it weighted recent additions instead, rank would not be a function
 *      of the count at all and everything downstream would be noise.
 *   2. That VGI's distribution of launch wishlists describes the games
 *      currently on the ordering. Different population, different moment.
 *   3. That the accumulation curve corrects the gap between "at launch" and
 *      "today" — measured on the top 50 games and applied to everyone.
 *
 * Announcements are one-sided evidence and the report treats them that way. A
 * developer posting "100,000 wishlists!" has just crossed 100,000, so the true
 * figure is at or a little above the number, never below it. A model reading
 * 130,000 there is not wrong by 30%.
 *
 *   node tools/calibrate-wishlist-rank.mjs
 *   node tools/calibrate-wishlist-rank.mjs --window 7
 *   node tools/calibrate-wishlist-rank.mjs --json
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { wishlistsFromRank } from '../src/core/wishlist-rank.js';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : argv[at + 1] ?? fallback;
};

const ANCHORS = valueOf('--anchors', 'data/wishlist-anchors.ndjson');
const WINDOW_DAYS = Number(valueOf('--window', 14));
const JSON_OUT = has('--json');

const DAY_MS = 24 * 60 * 60 * 1000;
const RANK_BANDS = [
  { upTo: 100, label: 'rank 1-100' },
  { upTo: 500, label: 'rank 101-500' },
  { upTo: 1500, label: 'rank 501-1,500' },
  { upTo: 3000, label: 'rank 1,501-3,000' },
  { upTo: Infinity, label: 'rank 3,001+' }
];

const quantile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];

async function loadAnchors(path) {
  if (!existsSync(path)) return [];
  const text = await readFile(path, 'utf8');
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* skip */ }
  }
  return rows;
}

function evaluate(anchors) {
  const results = [];

  for (const anchor of anchors) {
    if (!Number.isFinite(anchor.rank) || !Number.isFinite(anchor.wishlists)) continue;

    // A figure is only comparable with a position read near the same day.
    // Everything else in this file depends on that pairing being honest.
    const drift = Math.abs(new Date(anchor.rankAt) - new Date(anchor.announcedAt)) / DAY_MS;
    if (!Number.isFinite(drift) || drift > WINDOW_DAYS) continue;

    // The anchor is a launch-relative fact with no release date attached, so
    // the estimate is taken without the accumulation correction and compared
    // on the same footing. Applying a correction here would test the curve
    // and the distribution at once and report one number for both.
    const estimate = wishlistsFromRank(anchor.rank, {
      listed: anchor.listed,
      upcoming: anchor.upcoming,
      at: Date.now()
    }, { releaseDate: null });

    if (!estimate.ok) continue;

    results.push({
      appid: anchor.appid,
      rank: anchor.rank,
      announced: anchor.wishlists,
      round: anchor.round,
      driftDays: Math.round(drift),
      mid: estimate.range.mid,
      lo: estimate.range.lo,
      hi: estimate.range.hi,
      ratio: estimate.range.mid / anchor.wishlists,
      // One-sided: an announcement is a floor, so the model is consistent
      // with it whenever the band reaches the announced figure at all.
      contains: anchor.wishlists >= estimate.range.lo && anchor.wishlists <= estimate.range.hi,
      under: estimate.range.hi < anchor.wishlists
    });
  }

  return results.sort((a, b) => a.rank - b.rank);
}

function summarise(results) {
  if (!results.length) return null;
  const ratios = results.map((r) => r.ratio).sort((a, b) => a - b);
  return {
    n: results.length,
    median: quantile(ratios, 0.5),
    p10: quantile(ratios, 0.1),
    p90: quantile(ratios, 0.9),
    contained: results.filter((r) => r.contains).length / results.length,
    under: results.filter((r) => r.under).length / results.length
  };
}

async function main() {
  const anchors = await loadAnchors(resolve(ANCHORS));
  const results = evaluate(anchors);

  if (JSON_OUT) {
    console.log(JSON.stringify({
      anchorsOnFile: anchors.length,
      comparable: results.length,
      windowDays: WINDOW_DAYS,
      overall: summarise(results),
      byBand: RANK_BANDS.map((band, i) => {
        const from = i === 0 ? 0 : RANK_BANDS[i - 1].upTo;
        return { band: band.label, ...summarise(results.filter((r) => r.rank > from && r.rank <= band.upTo)) };
      }),
      results
    }, null, 2));
    return;
  }

  console.log(`\n  Rank-to-wishlists check, against developer announcements`);
  console.log(`  ${anchors.length} disclosures on file, ${results.length} paired with a rank read within ${WINDOW_DAYS} days\n`);

  if (!results.length) {
    console.log('  Nothing comparable yet.\n');
    console.log('  This is the expected state of a fresh checkout, and of the first weeks');
    console.log('  of the daily job. An anchor needs a wishlist figure and a rank read at');
    console.log('  about the same time, and the only way to get those together is to keep');
    console.log('  snapshotting both until a developer posts a number. Roughly one in eight');
    console.log('  disclosures in the archive is fresh enough on any given day.\n');
    console.log('  Run tools/crawl-wishlist-ranks.mjs and tools/harvest-anchors.mjs daily,');
    console.log('  then come back. Nothing in the extension depends on the result: this');
    console.log('  checks the mapping, it does not build it.\n');
    return;
  }

  console.log('  rank    announced      model mid    ratio   in band   drift');
  console.log('  ' + '─'.repeat(62));
  for (const r of results.slice(0, 40)) {
    console.log(
      `  ${String(r.rank).padStart(5)}`
      + `${r.announced.toLocaleString('en-US').padStart(13)}`
      + `${Math.round(r.mid).toLocaleString('en-US').padStart(15)}`
      + `${r.ratio.toFixed(2).padStart(9)}x`
      + `${(r.contains ? 'yes' : r.under ? 'UNDER' : 'over').padStart(9)}`
      + `${String(r.driftDays).padStart(7)}d`
    );
  }
  if (results.length > 40) console.log(`  ... and ${results.length - 40} more`);
  console.log('  ' + '─'.repeat(62));

  const overall = summarise(results);
  console.log(`\n  ${overall.n} comparable anchors`);
  console.log(`  model / announced: p10 ${overall.p10.toFixed(2)}x  median ${overall.median.toFixed(2)}x  p90 ${overall.p90.toFixed(2)}x`);
  console.log(`  announced figure inside the model band: ${(overall.contained * 100).toFixed(0)}%`);
  console.log(`  model band entirely below the announced figure: ${(overall.under * 100).toFixed(0)}%`);

  console.log('\n  By rank band:');
  for (let i = 0; i < RANK_BANDS.length; i++) {
    const from = i === 0 ? 0 : RANK_BANDS[i - 1].upTo;
    const slice = results.filter((r) => r.rank > from && r.rank <= RANK_BANDS[i].upTo);
    const s = summarise(slice);
    if (!s) continue;
    console.log(`    ${RANK_BANDS[i].label.padEnd(18)} n=${String(s.n).padStart(4)}  median ${s.median.toFixed(2)}x  in band ${(s.contained * 100).toFixed(0)}%`);
  }

  console.log('\n  How to read this.\n');
  console.log('  A median near 1x with most figures inside the band means the published');
  console.log('  distribution describes the ranked population well enough to invert.');
  console.log('  A median comfortably above 1x is expected and not a fault: announcements');
  console.log('  are floors, so a game that just crossed 100,000 holds a little more.');
  console.log('  A high "band entirely below" share is the one real alarm — the model');
  console.log('  would be claiming a ceiling that games are demonstrably above, which');
  console.log('  points at the ordering not ranking by balance at all.\n');
  console.log('  Nothing in src/ changes automatically from this. If the mapping is off,');
  console.log('  the fix is a better distribution or an honest note in METHODOLOGY.md,');
  console.log('  not a fudge factor fitted to whichever games happened to post.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
