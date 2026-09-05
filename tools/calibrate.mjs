#!/usr/bin/env node
/**
 * Calibration harness.
 *
 * Runs the shipping estimator against games whose real sales are public, and
 * reports the same metrics published benchmarks use, so our number is directly
 * comparable rather than self-graded on a private scale.
 *
 * Reference points from Gamalytic's benchmark on ~120 games:
 *   flat review multiple      42.7% of games within 30% error
 *   adjusted review multiples 50.4%
 *   full ensemble             76.9%
 *
 * If we land under ~50% we are not beating a plain multiplier and should fix
 * the coefficients before shipping, not after.
 *
 * Scores the review-multiple leg only. The owner band and the player-hours
 * route need state as it stood on the disclosure date, which a frozen snapshot
 * does not carry.
 *
 *   node tools/calibrate.mjs            # frozen snapshots only
 *   node tools/calibrate.mjs --live     # fetch current review counts
 *   node tools/calibrate.mjs --live --json
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { estimateUnits } from '../src/core/units.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const LIVE = args.has('--live');
const JSON_OUT = args.has('--json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchLiveInputs(appId) {
  const reviewsUrl = `https://store.steampowered.com/appreviews/${appId}?json=1&num_per_page=0&language=all&purchase_type=all&filter=summary`;
  const detailsUrl = `https://store.steampowered.com/api/appdetails?appids=${appId}&cc=us&l=en`;

  const [rRes, dRes] = await Promise.all([fetch(reviewsUrl), fetch(detailsUrl)]);
  const rJson = await rRes.json();
  const dJson = await dRes.json();

  const q = rJson?.query_summary ?? {};
  const d = dJson?.[String(appId)]?.data ?? {};
  const total = q.total_reviews;

  return {
    reviews: Number.isFinite(total) ? total : null,
    positivePct: total > 0 ? (q.total_positive / total) * 100 : null,
    // `initial` is the list price and `final` is today's. Calibrating on
    // `final` would score the estimator against whichever games happened to
    // be on sale on the day the harness ran.
    listPrice: d.price_overview ? d.price_overview.initial / 100 : d.is_free ? 0 : null,
    price: d.price_overview ? d.price_overview.final / 100 : d.is_free ? 0 : null,
    isFree: Boolean(d.is_free),
    discountPct: d.price_overview?.discount_percent ?? 0,
    releaseYear: Number(String(d.release_date?.date ?? '').match(/(19|20)\d{2}/)?.[0]) || null,
    tags: (d.genres ?? []).map((g) => g.description)
  };
}

function scoreOne(fixture, inputs) {
  const est = estimateUnits({ ...inputs, appId: fixture.appId, released: true });
  if (!est.ok) return { ...fixture, skipped: est.reason };

  const actual = fixture.reportedUnits;
  const predicted = est.range.mid;
  const error = (predicted - actual) / actual;

  return {
    ...fixture,
    reviews: inputs.reviews,
    predicted,
    actual,
    error,
    absError: Math.abs(error),
    inBand: actual >= est.range.lo && actual <= est.range.hi,
    multiplier: est.multiplier.mid
  };
}

function summarise(rows) {
  const scored = rows.filter((r) => !r.skipped);
  const n = scored.length;
  if (!n) return null;

  const within = (t) => scored.filter((r) => r.absError <= t).length / n;
  const totalPredicted = scored.reduce((a, r) => a + r.predicted, 0);
  const totalActual = scored.reduce((a, r) => a + r.actual, 0);
  const meanAccuracy = scored.reduce((a, r) => a + Math.max(0, 1 - r.absError), 0) / n;

  return {
    games: n,
    skipped: rows.length - n,
    aggregateAccuracy: totalPredicted / totalActual,
    averageAccuracy: meanAccuracy,
    within10: within(0.1),
    within30: within(0.3),
    within50: within(0.5),
    within70: within(0.7),
    bandCoverage: scored.filter((r) => r.inBand).length / n
  };
}

function bar(value, width = 28) {
  const filled = Math.round(value * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

function report(summary, rows) {
  const p = (v) => `${(v * 100).toFixed(1)}%`;

  console.log('\n  Calibration: adjusted Boxleiter estimator');
  console.log('  ' + '─'.repeat(52));
  console.log(`  Games scored          ${summary.games}${summary.skipped ? `  (${summary.skipped} skipped)` : ''}`);
  console.log(`  Aggregate accuracy    ${p(summary.aggregateAccuracy)}   (100% = perfect in total)`);
  console.log(`  Average accuracy      ${p(summary.averageAccuracy)}`);
  console.log('');
  console.log(`  Within 10% error      ${bar(summary.within10)}  ${p(summary.within10)}`);
  console.log(`  Within 30% error      ${bar(summary.within30)}  ${p(summary.within30)}`);
  console.log(`  Within 50% error      ${bar(summary.within50)}  ${p(summary.within50)}`);
  console.log(`  Within 70% error      ${bar(summary.within70)}  ${p(summary.within70)}`);
  console.log('');
  console.log(`  Actual inside our band ${p(summary.bandCoverage)}  (target: 80%+)`);
  console.log('  ' + '─'.repeat(52));
  console.log(`  Reference — flat multiple 42.7% · adjusted 50.4% · ensemble 76.9% within 30%`);

  const worst = rows.filter((r) => !r.skipped).sort((a, b) => b.absError - a.absError).slice(0, 5);
  if (worst.length) {
    console.log('\n  Worst misses');
    for (const r of worst) {
      const dir = r.error > 0 ? 'over ' : 'under';
      console.log(
        `   ${dir} ${(r.absError * 100).toFixed(0).padStart(4)}%  ${r.name.slice(0, 28).padEnd(30)}` +
        `pred ${Math.round(r.predicted).toLocaleString().padStart(11)}  actual ${r.actual.toLocaleString()}`
      );
    }
  }
  console.log('');
}

async function main() {
  const raw = JSON.parse(await readFile(join(HERE, '..', 'test', 'fixtures.json'), 'utf8'));
  const fixtures = raw.games;

  const usable = LIVE ? fixtures : fixtures.filter((f) => f.snapshot);
  if (!usable.length) {
    console.error(
      '\n  No frozen snapshots in fixtures.json yet.\n' +
      '  Run with --live to fetch current review counts, or fill in `snapshot` fields.\n'
    );
    process.exit(1);
  }

  if (LIVE) {
    console.error(
      '\n  ⚠  Live mode compares TODAY\'s review count against sales reported on a PAST date.\n' +
      '     Reviews kept accumulating after each announcement, so this run is biased toward\n' +
      '     overestimating. Treat the output as a smoke test, not a calibration. For real\n' +
      '     numbers, freeze inputs into `snapshot` at the moment a figure is announced.\n'
    );
  }

  const rows = [];
  for (const f of usable) {
    let inputs = f.snapshot;
    if (!inputs && LIVE) {
      try {
        inputs = await fetchLiveInputs(f.appId);
        await sleep(350); // polite to Valve
      } catch (err) {
        rows.push({ ...f, skipped: `fetch failed: ${err.message}` });
        continue;
      }
    }
    if (!inputs) { rows.push({ ...f, skipped: 'no snapshot' }); continue; }
    rows.push(scoreOne(f, inputs));
  }

  const summary = summarise(rows);
  if (!summary) {
    console.error('  Nothing scored. Every fixture was skipped.\n');
    process.exit(1);
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
  } else {
    report(summary, rows);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
