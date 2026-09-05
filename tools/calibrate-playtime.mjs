#!/usr/bin/env node
/**
 * Where PLAYTIME.biasRange comes from.
 *
 * The player-hours estimator needs the average hours an owner puts into a
 * game. SteamSpy returns zero for every app, so the only free source is the
 * playtime attached to each review — and
 * people who write reviews play far more than people who do not. This
 * measures how much more.
 *
 * For each game in test/fixtures.json whose developer disclosed a unit count:
 *
 *   1. Sum SteamCharts average concurrents over every month up to the date
 *      the figure was announced, giving total player-hours to that date.
 *   2. Divide by the disclosed units. That is the true average playtime per
 *      owner at that moment — no estimation involved on either side.
 *   3. Take the median playtime-at-review over reviews written before the
 *      same date.
 *   4. The ratio of the two is the bias.
 *
 * Both inputs are anchored to the announcement date, so the result does not
 * drift as a game keeps selling. The output is a distribution, and the point
 * of carrying it as a range in constants.js is that it is a wide one.
 *
 *   node tools/calibrate-playtime.mjs
 *   node tools/calibrate-playtime.mjs --json
 *   node tools/calibrate-playtime.mjs --max-pages 60
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseMonthlyHistory, medianHours } from '../src/core/units.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const valueOf = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : Number(argv[at + 1]) || fallback;
};

const JSON_OUT = has('--json');
const MAX_PAGES = valueOf('--max-pages', 40);
const PAGE_SIZE = 100;
const SAMPLE_WINDOW_DAYS = valueOf('--window-days', 90);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { 'User-Agent': 'steam-revenue-wishlist-estimator/calibration (+https://github.com/q-sn/steam-revenue-wishlist-estimator)' };

/** Player-hours accumulated up to `until`, from the monthly concurrents table. */
function playerHoursUpTo(history, until) {
  const cutoff = new Date(until);
  let hours = 0;
  let months = 0;

  for (const row of history.months) {
    // Whole months only. A partial month would need daily data we do not have,
    // and counting it in full would credit the game with hours it had not
    // earned when the figure was announced.
    const monthEnd = Date.UTC(row.year, row.monthIndex + 1, 1);
    if (monthEnd > cutoff.getTime()) continue;
    if (!Number.isFinite(row.avgPlayers) || row.avgPlayers <= 0) continue;

    const days = new Date(Date.UTC(row.year, row.monthIndex + 1, 0)).getUTCDate();
    hours += row.avgPlayers * days * 24;
    months += 1;
  }

  return { hours, months };
}

async function fetchCharts(appId) {
  const res = await fetch(`https://steamcharts.com/app/${appId}`, { headers: UA });
  if (!res.ok) throw new Error(`SteamCharts HTTP ${res.status}`);
  const parsed = parseMonthlyHistory(await res.text());
  if (!parsed?.months?.length) throw new Error('no monthly history');
  return parsed;
}

/**
 * Playtime-at-review for reviews written in the months before `until`.
 *
 * The reviews endpoint takes `start_date` and `end_date` with
 * `date_range_type=include`, which is what the store's own review histogram
 * filters on, so the sample can be pulled straight from the right window
 * instead of paging backwards through years of newer reviews to reach it.
 *
 * `playtime_at_review` rather than `playtime_forever`: the whole point is to
 * compare against the average playtime as it stood on the announcement date,
 * and `playtime_forever` keeps growing after the review was written.
 */
async function fetchPlaytimeBefore(appId, until, windowDays = SAMPLE_WINDOW_DAYS) {
  const end = Math.floor(new Date(until).getTime() / 1000);
  const start = end - windowDays * 86_400;
  const sample = [];
  let cursor = '*';
  let pages = 0;

  while (pages < MAX_PAGES) {
    const url = `https://store.steampowered.com/appreviews/${appId}?json=1`
      + `&num_per_page=${PAGE_SIZE}&language=all&purchase_type=all&filter=recent`
      + `&start_date=${start}&end_date=${end}&date_range_type=include`
      + `&cursor=${encodeURIComponent(cursor)}`;

    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`appreviews HTTP ${res.status}`);
    const json = await res.json();
    const reviews = json?.reviews ?? [];
    if (!reviews.length) break;

    for (const r of reviews) {
      if (r.timestamp_created > end || r.timestamp_created < start) continue;
      const minutes = r.author?.playtime_at_review;
      if (Number.isFinite(minutes) && minutes > 0) sample.push(minutes);
    }

    if (sample.length >= PAGE_SIZE * 2) break;
    cursor = json.cursor;
    if (!cursor) break;
    pages += 1;
    await sleep(300);
  }

  return { sample, pages };
}

function summarise(rows) {
  const biases = rows.filter((r) => r.bias).map((r) => r.bias).sort((a, b) => a - b);
  if (!biases.length) return null;

  const at = (q) => biases[Math.min(Math.floor(q * biases.length), biases.length - 1)];
  const median = biases.length % 2
    ? biases[(biases.length - 1) / 2]
    : (biases[biases.length / 2 - 1] + biases[biases.length / 2]) / 2;

  return {
    games: biases.length,
    min: biases[0],
    p10: at(0.1),
    median,
    p90: at(0.9),
    max: biases[biases.length - 1]
  };
}

async function main() {
  const raw = JSON.parse(await readFile(join(HERE, '..', 'test', 'fixtures.json'), 'utf8'));
  const rows = [];

  for (const fixture of raw.games) {
    if (!fixture.reportedAt || !fixture.reportedUnits) continue;

    try {
      const history = await fetchCharts(fixture.appId);
      const { hours, months } = playerHoursUpTo(history, fixture.reportedAt);
      if (!months) {
        rows.push({ ...fixture, skipped: 'no months before the report date' });
        continue;
      }

      const impliedAvgHours = hours / fixture.reportedUnits;
      await sleep(300);

      const { sample, pages } = await fetchPlaytimeBefore(fixture.appId, fixture.reportedAt);
      const reviewerMedian = medianHours(sample);
      if (!reviewerMedian || sample.length < 20) {
        rows.push({ ...fixture, skipped: `playtime sample of ${sample.length}` });
        continue;
      }

      rows.push({
        appId: fixture.appId,
        name: fixture.name,
        reportedAt: fixture.reportedAt,
        reportedUnits: fixture.reportedUnits,
        months,
        playerHours: hours,
        impliedAvgHours,
        reviewerMedian,
        sampleSize: sample.length,
        pages,
        bias: reviewerMedian / impliedAvgHours
      });
    } catch (err) {
      rows.push({ ...fixture, skipped: err.message });
    }

    await sleep(500);
  }

  const summary = summarise(rows);

  if (JSON_OUT) {
    console.log(JSON.stringify({ summary, rows }, null, 2));
    return;
  }

  console.log('\n  Reviewer playtime against true average playtime');
  console.log('  ' + '─'.repeat(74));
  console.log(
    '  ' + 'Game'.padEnd(30) + 'reported'.padStart(10) + 'true avg'.padStart(10)
    + 'reviewer'.padStart(10) + 'bias'.padStart(8) + '  n'
  );
  for (const r of rows) {
    if (r.skipped) {
      console.log(`  ${String(r.name).slice(0, 28).padEnd(30)}skipped: ${r.skipped}`);
      continue;
    }
    console.log(
      `  ${r.name.slice(0, 28).padEnd(30)}`
      + `${r.reportedUnits.toLocaleString().padStart(10)}`
      + `${r.impliedAvgHours.toFixed(1).padStart(9)}h`
      + `${r.reviewerMedian.toFixed(1).padStart(9)}h`
      + `${r.bias.toFixed(2).padStart(7)}x`
      + `  ${r.sampleSize}`
    );
  }
  console.log('  ' + '─'.repeat(74));

  if (!summary) {
    console.log('\n  Nothing measurable. Every fixture was skipped.\n');
    process.exitCode = 1;
    return;
  }

  console.log(`\n  ${summary.games} games measured`);
  console.log(`  min ${summary.min.toFixed(2)}x  p10 ${summary.p10.toFixed(2)}x  `
    + `median ${summary.median.toFixed(2)}x  p90 ${summary.p90.toFixed(2)}x  max ${summary.max.toFixed(2)}x`);
  console.log('\n  PLAYTIME.biasRange carries the p10 / median / p90 of this table — the');
  console.log('  middle 80%, the same band GDC_NB_2020 publishes for the review multiple.');
  console.log('  Not the min and max: one outlier should not set the width of every band.');
  console.log('  Not the quartiles either: a band half the games fall outside of is not a');
  console.log('  band, it is a point estimate with decoration.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
