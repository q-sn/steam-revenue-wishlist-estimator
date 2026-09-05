#!/usr/bin/env node
/**
 * What the SteamSpy owner band is worth.
 *
 * It is the only estimator in the ensemble with no published accuracy figure.
 * SteamSpy documents its method — extrapolation from a sample of public
 * profiles at 98% confidence — and documents that the April 2018 privacy
 * change cost it most of that sample, but nobody has published an error rate
 * for what came after. So this measures one.
 *
 * For every game in test/fixtures.json, it compares SteamSpy's bucket today
 * against the units the developer disclosed. Two things make that comparison
 * meaningful without knowing what any of them has sold since:
 *
 *   - Owners can only ever exceed units sold, since the count includes free
 *     keys, review copies and bundles.
 *   - Years have passed since each announcement, and games only accumulate
 *     owners.
 *
 * So the current bucket should comfortably contain or exceed every disclosed
 * figure. A bucket whose *top* falls below one is not imprecise, it is wrong.
 *
 * The test is one-sided and the output says so: it can prove a bucket too low
 * and never too high. That is why the weight curve in constants.js is not
 * fitted to this table — it is only checked for direction against it.
 *
 *   node tools/calibrate-owners.mjs
 *   node tools/calibrate-owners.mjs --json
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseOwnersBand } from '../src/core/units.js';
import { ENSEMBLE } from '../src/core/constants.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const JSON_OUT = process.argv.includes('--json');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Buckets the keyless API is known to answer on. Used to report the ladder
// rather than to constrain the parse.
const LADDER = [
  20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000,
  10_000_000, 20_000_000, 50_000_000, 100_000_000, 200_000_000
];

function sizeBand(units) {
  if (units >= 1_000_000) return '1M and above';
  if (units >= 100_000) return '100k to 1M';
  return 'under 100k';
}

function quantiles(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(Math.floor(q * sorted.length), sorted.length - 1)];
  const median = sorted.length % 2
    ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return { n: sorted.length, min: at(0), p25: at(0.25), median, p75: at(0.75), max: at(1) };
}

async function main() {
  const raw = JSON.parse(await readFile(join(HERE, '..', 'test', 'fixtures.json'), 'utf8'));
  const rows = [];

  for (const f of raw.games) {
    if (!f.reportedUnits || !f.reportedAt) continue;
    try {
      const res = await fetch(`https://steamspy.com/api.php?request=appdetails&appid=${f.appId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const band = parseOwnersBand((await res.json())?.owners ?? '');
      await sleep(1200);
      if (!band) { rows.push({ ...f, skipped: 'no owner band' }); continue; }

      const mid = Math.sqrt(Math.max(band.lo, band.hi / 2.5) * band.hi);
      rows.push({
        appId: f.appId,
        name: f.name,
        reportedUnits: f.reportedUnits,
        reportedAt: f.reportedAt,
        band,
        bucketWidth: band.hi / Math.max(band.lo, band.hi / 2.5),
        ratio: mid / f.reportedUnits,
        impossible: band.hi < f.reportedUnits,
        years: (Date.now() - Date.parse(f.reportedAt)) / (365.25 * 86_400_000),
        sizeBand: sizeBand(f.reportedUnits)
      });
    } catch (err) {
      rows.push({ ...f, skipped: err.message });
    }
  }

  const ok = rows.filter((r) => r.band);
  if (JSON_OUT) {
    console.log(JSON.stringify({ rows, summary: quantiles(ok.map((r) => r.ratio)) }, null, 2));
    return;
  }

  const n = (x) => Math.round(x).toLocaleString('en-US');
  console.log('\n  SteamSpy today against units the developer disclosed');
  console.log('  ' + '─'.repeat(84));
  console.log('  ' + 'Game'.padEnd(30) + 'disclosed'.padStart(12) + '  ' + 'bucket'.padEnd(26) + 'mid/disclosed');
  for (const r of rows) {
    if (r.skipped) { console.log(`  ${String(r.name).slice(0, 28).padEnd(30)}skipped: ${r.skipped}`); continue; }
    console.log(
      `  ${r.name.slice(0, 28).padEnd(30)}${n(r.reportedUnits).padStart(12)}  `
      + `${(n(r.band.lo) + ' .. ' + n(r.band.hi)).padEnd(26)}`
      + `${r.ratio.toFixed(2)}x`
      + (r.impossible ? '   IMPOSSIBLE: bucket top is below the disclosed figure' : '')
    );
  }
  console.log('  ' + '─'.repeat(84));

  console.log('\n  By disclosed size');
  for (const band of ['1M and above', '100k to 1M', 'under 100k']) {
    const group = ok.filter((r) => r.sizeBand === band);
    if (!group.length) continue;
    const q = quantiles(group.map((r) => r.ratio));
    console.log(`    ${band.padEnd(14)} n=${String(q.n).padStart(2)}  `
      + `min ${q.min.toFixed(2)}x  median ${q.median.toFixed(2)}x  max ${q.max.toFixed(2)}x`);
  }

  const impossible = ok.filter((r) => r.impossible);
  console.log(`\n  Buckets that cannot be right: ${impossible.length}`
    + (impossible.length ? ` (${impossible.map((r) => r.name).join(', ')})` : ''));
  console.log(`  Mean years since disclosure: ${(ok.reduce((a, r) => a + r.years, 0) / ok.length).toFixed(1)}`);
  console.log(`  Bucket widths seen: ${[...new Set(ok.map((r) => r.bucketWidth.toFixed(1)))].sort().join('x, ')}x`);
  console.log(`  Ladder the keyless API answers on: ${LADDER.map((v) => n(v)).join(', ')}`);

  console.log('\n  Reading this table: the top size band is the case for keeping the owner');
  console.log('  leg at all, and the bottom one is the case for its weight reaching zero.');
  console.log('  The test is one-sided — it can show a bucket too low, never too high — so');
  console.log(`  do not fit ENSEMBLE.owners to it. Current floor: ${n(ENSEMBLE.owners.minTrusted)} owners.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
