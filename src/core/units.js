import {
  BASE_MULTIPLIER, ADJUSTMENTS, REVIEW_COUNT_BANDS, REVIEW_GATES,
  OWNERS_TO_UNITS, ENSEMBLE, CCU, PLAYTIME, RECENT_REVIEW_WINDOW_DAYS
} from './constants.js';
import { matchTagRule } from './tags.js';

/** @typedef {{lo:number, mid:number, hi:number}} Range */

function baseFor(releaseYear) {
  const year = Number.isFinite(releaseYear) ? releaseYear : new Date().getFullYear();
  return BASE_MULTIPLIER.find((b) => year >= b.from && year <= b.to) ?? BASE_MULTIPLIER[0];
}

function pickTiered(table, value, key) {
  return table.find((row) => value <= row[key]) ?? table[table.length - 1];
}

/**
 * Every multiplicative adjustment that applies to this game, as the combined
 * factor and the itemised list the "why this number" panel shows.
 */
export function collectAdjustments(game) {
  const applied = [];
  let factor = 1;

  const add = (entry) => {
    if (!entry || entry.factor === 1) return;
    applied.push(entry);
    factor *= entry.factor;
  };

  // List price, not `game.price`, which is whatever the store shows today.
  const listPrice = Number.isFinite(game.listPrice) ? game.listPrice : game.price;

  if (game.isFree) {
    add({ ...ADJUSTMENTS.isFree });
  } else if (Number.isFinite(listPrice)) {
    add({ ...pickTiered(ADJUSTMENTS.price, listPrice, 'maxPrice') });
  }

  if (Number.isFinite(game.positivePct)) {
    add({ ...pickTiered(ADJUSTMENTS.reviewScore, game.positivePct, 'maxPct') });
  }

  if (Number.isFinite(game.reviews) && game.reviews > 0) {
    add({ ...pickTiered(REVIEW_COUNT_BANDS, game.reviews, 'maxReviews') });
  }

  // One genre adjustment only, chosen by tag rank — see matchTagRule.
  const genre = matchTagRule(game.tags, ADJUSTMENTS.tags);
  if (genre) {
    add({ factor: genre.factor, label: genre.label, source: genre.source, derived: genre.derived });
  }

  if (Number.isFinite(game.discountPct) && game.discountPct >= ADJUSTMENTS.heavyDiscount.thresholdPct) {
    add({ ...ADJUSTMENTS.heavyDiscount });
  }

  return { factor, applied };
}

/**
 * Adjusted Boxleiter estimate of lifetime units. Per the Gamalytic benchmark
 * it lands within 30% on roughly half of games.
 *
 * @returns {{ok:boolean, reason?:string, range?:Range, multiplier?:Range, applied?:Array}}
 */
export function estimateUnits(game) {
  const reviews = game.reviews;

  if (!Number.isFinite(reviews)) {
    return { ok: false, reason: 'no-review-data' };
  }
  if (reviews < REVIEW_GATES.MIN_REVIEWS) {
    return { ok: false, reason: 'too-few-reviews', reviews };
  }

  const base = baseFor(game.releaseYear);
  const { factor, applied } = collectAdjustments(game);

  let lo = base.lo * factor;
  let mid = base.point * factor;
  let hi = base.hi * factor;

  // Small samples are noisier than the survey ranges imply, so widen the band.
  const lowSample = reviews < REVIEW_GATES.CONFIDENT_REVIEWS;
  if (lowSample) {
    lo *= REVIEW_GATES.LOW_SAMPLE_WIDEN.lo;
    hi *= REVIEW_GATES.LOW_SAMPLE_WIDEN.hi;
  }

  return {
    ok: true,
    method: 'boxleiter',
    lowSample,
    baseYearBand: base,
    multiplier: { lo, mid, hi },
    applied,
    range: { lo: reviews * lo, mid: reviews * mid, hi: reviews * hi }
  };
}

/**
 * Peak-CCU cross-check for week-one sales. Not a leg of the lifetime
 * ensemble. Declines unless `peakAt` and `releaseDate` are both known, since
 * the multiplier is only calibrated on a peak that fell at launch.
 *
 * @param {number} allTimePeak highest concurrent player count on record
 * @param {{hadPreorders?:boolean|null, peakAt?:number|null, releaseDate?:number|null}} ctx
 */
export function weekOneFromCcu(allTimePeak, { hadPreorders = null, peakAt = null, releaseDate = null } = {}) {
  if (!Number.isFinite(allTimePeak) || allTimePeak <= 0) return { ok: false, reason: 'no-ccu' };

  // Fail closed: on a later viral peak the rule errs high, and nothing
  // downstream can tell that result from a correct one.
  if (!Number.isFinite(peakAt) || !Number.isFinite(releaseDate)) {
    return { ok: false, reason: 'peak-date-unknown' };
  }

  const daysAfterRelease = (peakAt - releaseDate) / 86_400_000;
  if (daysAfterRelease > CCU.launchPeakWindowDays) {
    return { ok: false, reason: 'peak-not-at-launch', daysAfterRelease: Math.round(daysAfterRelease) };
  }

  const point = hadPreorders === true
    ? CCU.multiplier.withPreorders
    : hadPreorders === false
      ? CCU.multiplier.withoutPreorders
      : CCU.multiplier.unknown;

  return {
    ok: true,
    method: 'ccu',
    multiplier: point,
    range: {
      lo: allTimePeak * point * (1 - CCU.variance),
      mid: allTimePeak * point,
      hi: allTimePeak * point * (1 + CCU.variance)
    }
  };
}

/**
 * SteamSpy owner band converted into paid units. Owners are not sales: the
 * band includes free keys, giveaways and bundle copies.
 *
 * `steamPurchaseShare` is the fraction of reviewers who bought on Steam rather
 * than activating a key; without it a flat factor is used. The weight is
 * size-dependent — SteamSpy's sample collapsed with the 2018 profile privacy
 * change.
 *
 * @param {{lo:number, hi:number}} band raw SteamSpy owner range
 */
export function unitsFromOwners(band, { steamPurchaseShare = null, recordEmpty = false } = {}) {
  if (!band || !Number.isFinite(band.lo) || !Number.isFinite(band.hi) || band.hi <= 0) {
    return { ok: false, reason: 'no-owners' };
  }

  // An unprocessed SteamSpy record looks exactly like a small game: owners
  // "0 .. 20,000" with every other field at zero. Distinguished so the reader
  // is told the source has no record rather than "no cross-check available".
  if (recordEmpty) {
    return { ok: false, reason: 'owner-record-empty' };
  }

  const measured = Number.isFinite(steamPurchaseShare)
    ? Math.min(Math.max(steamPurchaseShare, OWNERS_TO_UNITS.floor), OWNERS_TO_UNITS.ceiling)
    : null;
  const factor = measured ?? OWNERS_TO_UNITS.fallback;

  const lo = band.lo * factor;
  const hi = band.hi * factor;
  // Geometric midpoint: owner bands are wide and multiplicative, so the
  // arithmetic centre would sit too high. A band starting at zero means "under
  // hi", so its low end is taken as the rung below rather than as zero.
  const impliedLo = lo > 0 ? lo : hi / OWNERS_TO_UNITS.ladderStep;
  const mid = Math.sqrt(impliedLo * hi);

  const { minTrusted, maxTrusted, weightAtMin, weightAtMax } = ENSEMBLE.owners;
  const t = Math.min(Math.max((mid - minTrusted) / (maxTrusted - minTrusted), 0), 1);
  const weight = mid < minTrusted ? 0 : weightAtMin + t * (weightAtMax - weightAtMin);

  return {
    ok: true,
    method: 'owners',
    range: { lo, mid, hi },
    weight,
    keyShareFactor: factor,
    keyShareMeasured: measured != null,
    note: mid < minTrusted
      ? 'Owner band too small to trust after the 2018 profile privacy change'
      : null
  };
}

/**
 * Lifetime units from monthly concurrent-player history: total player-hours
 * divided by the hours an average owner puts in.
 *
 * A cross-check, never a leg of the ensemble. The divisor is a reviewer median
 * corrected by PLAYTIME.biasRange, and that correction was measured on a
 * different quantity — read the note on PLAYTIME before trusting the output.
 *
 * @param {Array<{year:number, monthIndex:number, avgPlayers:number}>} history monthly rows
 * @param {number} reviewerMedianHours median playtime among sampled reviewers
 */
export function unitsFromPlaytime(history, reviewerMedianHours, { sampleSize = null } = {}) {
  if (!Array.isArray(history) || !history.length) return { ok: false, reason: 'no-history' };
  if (!Number.isFinite(reviewerMedianHours) || reviewerMedianHours <= 0) {
    return { ok: false, reason: 'no-playtime' };
  }
  if (Number.isFinite(sampleSize) && sampleSize < PLAYTIME.minSample) {
    return { ok: false, reason: 'playtime-sample-too-small', sampleSize };
  }

  let playerHours = 0;
  let months = 0;
  for (const row of history) {
    if (!Number.isFinite(row?.avgPlayers) || row.avgPlayers < PLAYTIME.minMonthlyAverage) continue;
    if (!Number.isFinite(row.year) || !Number.isFinite(row.monthIndex)) continue;
    const days = new Date(Date.UTC(row.year, row.monthIndex + 1, 0)).getUTCDate();
    playerHours += row.avgPlayers * days * 24;
    months += 1;
  }

  if (!months || playerHours <= 0) return { ok: false, reason: 'no-history' };

  // A larger bias means the same hours spread over more owners.
  const { lo, mid, hi } = PLAYTIME.biasRange;
  const unitsAt = (bias) => (playerHours * bias) / reviewerMedianHours;

  return {
    ok: true,
    method: 'playtime',
    playerHours,
    months,
    reviewerMedianHours,
    range: { lo: unitsAt(lo), mid: unitsAt(mid), hi: unitsAt(hi) }
  };
}

/**
 * Read one labelled stat out of a SteamCharts app page.
 *
 * The page prints three figures in identical markup, so the label is matched
 * rather than the position. No digits may fall between number and label, or
 * the match starts at an earlier figure and skips over its own label.
 */
function readChartsStat(html, label) {
  const patterns = [
    new RegExp(`>\\s*([\\d][\\d,\\s\\u00a0]{0,15})\\s*<\\/[a-z]+>[^\\d]{0,160}?${label}`, 'i'),
    new RegExp(`${label}[^\\d]{0,160}?>\\s*([\\d][\\d,\\s\\u00a0]{0,15})\\s*<`, 'i')
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (!m) continue;
    const n = Number(m[1].replace(/[,\s\u00a0]/g, ''));
    if (Number.isFinite(n) && n >= 0) return n;
  }
  return null;
}

/**
 * Concurrent player figures from a SteamCharts app page. Exact rather than
 * sampled — SteamCharts derives them from Valve's API. Null when unreadable.
 */
export function parseChartsStats(html) {
  if (typeof html !== 'string' || html.length > 4_000_000) return null;

  const stats = {
    peak24h: readChartsStat(html, '24-hour\\s+peak'),
    allTimePeak: readChartsStat(html, 'all-time\\s+peak')
  };
  return stats.peak24h == null && stats.allTimePeak == null ? null : stats;
}

/** The all-time peak alone, as its own entry point. */
export function parseAllTimePeak(html) {
  if (typeof html !== 'string' || html.length > 4_000_000) return null;
  const n = readChartsStat(html, 'all-time\\s+peak');
  return Number.isFinite(n) && n > 0 ? n : null;
}

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'
];

/**
 * The monthly table from a SteamCharts app page.
 *
 * Columns are month, average players, gain, percentage gain and peak players,
 * read by position within the row — the class names are presentational.
 *
 * The first row is a rolling "Last 30 Days" summary rather than a month, so it
 * is returned separately; folding it into the months double-counts the current
 * one.
 */
export function parseMonthlyHistory(html) {
  if (typeof html !== 'string' || html.length > 4_000_000) return null;

  const strip = (s) => s
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#43;/g, '+')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const num = (s) => {
    const cleaned = String(s).replace(/[,\s\u00a0+]/g, '').replace(/\u2212/g, '-');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  };

  const months = [];
  let recent = null;

  for (const [, body] of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...body.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => strip(m[1]));
    if (cells.length < 5) continue; // the header row has no <td> cells

    const avgPlayers = num(cells[1]);
    const changePct = num(String(cells[3]).replace('%', ''));
    const peakPlayers = num(cells[4]);

    const dated = cells[0].match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (dated) {
      const monthIndex = MONTH_NAMES.indexOf(dated[1].toLowerCase());
      if (monthIndex === -1) continue;
      months.push({
        year: Number(dated[2]),
        monthIndex,
        label: cells[0],
        avgPlayers,
        peakPlayers,
        changePct
      });
    } else if (!recent && Number.isFinite(avgPlayers)) {
      // The rolling row, identified by not being a month: its label is the one
      // string here that would have to be matched untranslated.
      recent = { label: cells[0], avgPlayers, peakPlayers, changePct };
    }
  }

  if (!months.length && !recent) return null;
  return { months, recent };
}

/** Recent player trend, from the rolling row of the monthly table. */
export function parseRecentTrend(html) {
  const parsed = parseMonthlyHistory(html);
  const row = parsed?.recent;
  if (!row || !Number.isFinite(row.changePct)) return null;
  return {
    changePct: row.changePct,
    avgPlayers: Number.isFinite(row.avgPlayers) ? Math.round(row.avgPlayers) : null
  };
}

/**
 * When the all-time peak happened, to month precision. Returned as the first
 * instant of that month — the earliest the peak could have occurred, so the
 * week-one rule never accepts a peak by rounding.
 */
export function allTimePeakMonth(history) {
  const months = (history?.months ?? []).filter((m) => Number.isFinite(m.peakPlayers) && m.peakPlayers > 0);
  if (!months.length) return null;

  const top = months.reduce((best, row) => (row.peakPlayers > best.peakPlayers ? row : best));
  return {
    year: top.year,
    monthIndex: top.monthIndex,
    peak: top.peakPlayers,
    at: Date.UTC(top.year, top.monthIndex, 1)
  };
}

/**
 * Pull a percentage and a review count out of a Steam summary tooltip, e.g.
 * "94% of the 1,234 user reviews in the last 30 days are positive".
 *
 * The wording is translated, so only shapes are matched. Turkish writes %94
 * rather than 94%, hence both orders.
 *
 * The recent-window sentence also carries the window length, which outranks
 * the count on any game with fewer than thirty reviews, so one occurrence of
 * it is dropped — and only when something else is left to read, so a game with
 * exactly thirty still reports thirty. `windowed` is also what tells the two
 * summary rows apart without reading their translated labels.
 */
export function parseReviewSummary(tooltip, { windowDays = RECENT_REVIEW_WINDOW_DAYS } = {}) {
  if (typeof tooltip !== 'string') return null;

  const pctMatch = tooltip.match(/(\d{1,3})\s*%/) ?? tooltip.match(/%\s*(\d{1,3})/);
  if (!pctMatch) return null;
  const pct = Number(pctMatch[1]);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;

  const numbers = (tooltip.replace(pctMatch[0], ' ').match(/\d[\d.,\s\u00a0\u202f]*/g) ?? [])
    .map((n) => Number(n.replace(/[.,\s\u00a0\u202f]/g, '')))
    .filter((n) => Number.isFinite(n));

  let windowed = false;
  if (numbers.length > 1) {
    const at = numbers.indexOf(windowDays);
    if (at !== -1) {
      numbers.splice(at, 1);
      windowed = true;
    }
  }

  return { pct, count: numbers.length ? Math.max(...numbers) : null, windowed };
}

/** Parse SteamSpy's "1,000,000 .. 2,000,000" owner string into a band. */
export function parseOwnersBand(raw) {
  if (typeof raw !== 'string') return null;
  const nums = raw.replace(/,/g, '').match(/\d+/g);
  if (!nums || nums.length < 2) return null;
  const lo = Number(nums[0]);
  const hi = Number(nums[1]);
  return Number.isFinite(lo) && Number.isFinite(hi) && hi >= lo ? { lo, hi } : null;
}

/** Median of a playtime sample, in hours. Input is minutes. */
export function medianHours(minutes) {
  const values = (minutes ?? [])
    .map((m) => Number(m))
    .filter((m) => Number.isFinite(m) && m > 0)
    .sort((a, b) => a - b);
  if (!values.length) return null;

  const middle = Math.floor(values.length / 2);
  const median = values.length % 2
    ? values[middle]
    : (values[middle - 1] + values[middle]) / 2;
  return median / 60;
}
