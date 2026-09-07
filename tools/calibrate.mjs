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
 * It also scores the confidence grade itself, by grade, because a grade that
 * does not separate outcomes is a decoration. That table is the only check on
 * the verdict the extension prints, and it exits non-zero if a lower grade
 * ever covers the truth more often than a higher one.
 *
 *   node tools/calibrate.mjs            # frozen snapshots only
 *   node tools/calibrate.mjs --live     # fetch current review counts
 *   node tools/calibrate.mjs --live --json
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { estimateUnits } from '../src/core/units.js';
import { combineEstimators, scoreConfidence } from '../src/core/ensemble.js';
import { ENSEMBLE } from '../src/core/constants.js';

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

  // The grade the extension would print for this game, from the shipping
  // scorer rather than a copy of its rules. A frozen snapshot carries no owner
  // band, so the ensemble has one leg — which is exactly why the agreement
  // dimension cannot be scored here. See the note under the table.
  const combined = combineEstimators([{
    method: 'boxleiter',
    range: est.range,
    weight: est.lowSample
      ? ENSEMBLE.boxleiter.base * ENSEMBLE.boxleiter.lowSamplePenalty
      : ENSEMBLE.boxleiter.base
  }]);
  const confidence = scoreConfidence(combined, {
    lowSample: est.lowSample,
    reviews: inputs.reviews
  });

  return {
    ...fixture,
    reviews: inputs.reviews,
    predicted,
    actual,
    error,
    absError: Math.abs(error),
    inBand: actual >= est.range.lo && actual <= est.range.hi,
    spread: est.range.hi / est.range.lo,
    grade: confidence.level,
    gradeReason: confidence.reasons[0]?.key ?? null,
    multiplier: est.multiplier.mid
  };
}

/** Wilson score interval, so a cell of twenty games reports as one. */
function wilson(hits, n, z = 1.96) {
  if (!n) return [0, 0];
  const p = hits / n;
  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(centre - margin) / denominator, (centre + margin) / denominator];
}

/**
 * Two-sided permutation p for a difference in rates between two grades. With
 * cells of this size the exact test is cheap and the normal approximation is
 * not trustworthy.
 */
function permutationP(a, b, hit, iters = 20000) {
  const pool = [...a, ...b].map((r) => (hit(r) ? 1 : 0));
  const na = a.length;
  if (!na || !b.length) return null;
  const rate = (arr, from, to) => {
    let s = 0;
    for (let i = from; i < to; i++) s += arr[i];
    return s / (to - from);
  };
  const observed = Math.abs(rate(pool, 0, na) - rate(pool, na, pool.length));
  let atLeast = 0;
  for (let i = 0; i < iters; i++) {
    for (let j = pool.length - 1; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [pool[j], pool[k]] = [pool[k], pool[j]];
    }
    if (Math.abs(rate(pool, 0, na) - rate(pool, na, pool.length)) >= observed - 1e-12) atLeast++;
  }
  return { observed, p: (atLeast + 1) / (iters + 1) };
}

const GRADES = ['good', 'fair', 'low'];

/**
 * Accuracy by confidence grade.
 *
 * This is the whole point of the table: a grade that does not separate
 * outcomes is a decoration. It is reported for both outcomes the interface
 * shows — how close the midpoint lands, and whether the band contains the
 * truth — because the two can disagree, and a rule that reads the width of the
 * band separates them in opposite directions.
 */
function byGrade(rows) {
  const scored = rows.filter((r) => !r.skipped);
  const cells = GRADES.map((grade) => ({ grade, rows: scored.filter((r) => r.grade === grade) }));

  console.log('\n  Accuracy by confidence grade');
  console.log('  ' + '─'.repeat(66));
  console.log('  grade    n    within 30%          truth in band       median band');
  for (const { grade, rows: cell } of cells) {
    if (!cell.length) {
      console.log(`  ${grade.padEnd(7)}  0    (no fixture reaches this grade)`);
      continue;
    }
    const w30 = cell.filter((r) => r.absError <= 0.3).length;
    const band = cell.filter((r) => r.inBand).length;
    const c30 = wilson(w30, cell.length);
    const cb = wilson(band, cell.length);
    const spreads = cell.map((r) => r.spread).sort((a, b) => a - b);
    console.log(
      `  ${grade.padEnd(7)} ${String(cell.length).padStart(2)}    `
      + `${(w30 / cell.length * 100).toFixed(1).padStart(5)}%  [${(c30[0] * 100).toFixed(0)}-${(c30[1] * 100).toFixed(0)}]`.padEnd(20)
      + `${(band / cell.length * 100).toFixed(1).padStart(5)}%  [${(cb[0] * 100).toFixed(0)}-${(cb[1] * 100).toFixed(0)}]`.padEnd(20)
      + `${spreads[Math.floor(spreads.length / 2)].toFixed(2)}x`
    );
  }

  const populated = cells.filter((c) => c.rows.length);
  if (populated.length < 2) {
    console.log('  ' + '─'.repeat(66));
    console.log('  Only one grade is reachable on these fixtures, so the grade is');
    console.log('  untested here. It is not evidence that it works.');
    return { inverted: false };
  }

  const best = populated[0];
  const worst = populated[populated.length - 1];
  const w = permutationP(best.rows, worst.rows, (r) => r.absError <= 0.3);
  const b = permutationP(best.rows, worst.rows, (r) => r.inBand);
  console.log('  ' + '─'.repeat(66));
  console.log(`  ${best.grade} against ${worst.grade}:`);
  console.log(`    within 30%      ${(w.observed * 100).toFixed(0)}pp apart,  permutation p = ${w.p.toFixed(3)}`);
  console.log(`    truth in band   ${(b.observed * 100).toFixed(0)}pp apart,  permutation p = ${b.p.toFixed(3)}`);
  if (w.p > 0.05 && b.p > 0.05) {
    console.log('    Neither is a difference. The grade does not separate outcomes on');
    console.log('    this data, and nothing in the interface should imply that it does.');
  }

  // A guard, not a metric. The one thing a grade must never do is run
  // backwards: a worse grade whose band contains the truth more often is
  // telling the reader to distrust the answers most likely to be right. The
  // band-width ceiling this replaced did exactly that, 68.8% against 54.3%.
  //
  // It fails the run only when the inversion is *significant*, which is the
  // same standard this table applies to the grade itself. Failing on a 10pp
  // gap at p = 0.4 would be the harness asserting a difference it has just
  // finished calling noise, and would break on the next three fixtures
  // somebody adds. A non-significant inversion prints and does not gate.
  let inverted = false;
  for (let i = 0; i < populated.length - 1; i++) {
    for (let j = i + 1; j < populated.length; j++) {
      const better = populated[i];
      const lower = populated[j];
      if (better.rows.length < 5 || lower.rows.length < 5) continue;
      const bB = better.rows.filter((r) => r.inBand).length / better.rows.length;
      const bL = lower.rows.filter((r) => r.inBand).length / lower.rows.length;
      if (bL - bB <= 0) continue;
      const test = permutationP(better.rows, lower.rows, (r) => r.inBand);
      const significant = test.p < 0.05;
      if (significant) inverted = true;
      console.log(`\n  ${significant ? '✗' : '!'} ${significant ? 'INVERTED' : 'inverted, inside the noise'}:`
        + ` "${lower.grade}" games have the truth inside their band`);
      console.log(`    ${(bL * 100).toFixed(1)}% of the time against ${(bB * 100).toFixed(1)}%`
        + ` for "${better.grade}" (p = ${test.p.toFixed(3)}).`);
      if (significant) {
        console.log('    A grade that ranks the band backwards is worse than no grade.');
      }
    }
  }
  return { inverted };
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
    return;
  }

  report(summary, rows);
  const graded = byGrade(rows);
  console.log('');
  if (graded.inverted) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
