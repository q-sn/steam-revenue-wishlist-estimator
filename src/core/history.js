import { HISTORY } from './constants.js';

/**
 * Local snapshot history, held in chrome.storage.local.
 * Pure functions only; the storage calls live in the service worker.
 */

/** @typedef {{at:number, reviews:number|null, followers:number|null, units:number|null}} Snapshot */

export function makeSnapshot(game, result) {
  return {
    at: Date.now(),
    reviews: Number.isFinite(game.reviews) ? game.reviews : null,
    followers: Number.isFinite(game.followers) ? game.followers : null,
    units: result?.units?.ok ? Math.round(result.units.range.mid) : null
  };
}


/** Append a snapshot, collapsing writes less than HISTORY.minGapMs apart. */
export function appendSnapshot(series, snapshot) {
  const list = Array.isArray(series) ? [...series] : [];
  const last = list[list.length - 1];

  if (last && snapshot.at - last.at < HISTORY.minGapMs) {
    list[list.length - 1] = snapshot;
  } else {
    list.push(snapshot);
  }

  return list.slice(-HISTORY.maxPoints);
}

/** What changed since the previous distinct visit. */
export function diffSince(series, current) {
  if (!Array.isArray(series) || series.length < 1) return null;

  const previous = series
    .filter((s) => current.at - s.at >= HISTORY.minGapMs)
    .pop() ?? (series.length > 1 ? series[series.length - 2] : null);

  if (!previous) return null;

  const delta = (key) =>
    Number.isFinite(current[key]) && Number.isFinite(previous[key])
      ? current[key] - previous[key]
      : null;

  return {
    since: previous.at,
    elapsedMs: current.at - previous.at,
    reviews: delta('reviews'),
    followers: delta('followers'),
    units: delta('units')
  };
}

/** Normalise a series to 0..1 for the sparkline. Null below two points. */
export function sparklinePoints(series, key = 'reviews') {
  const values = (series ?? [])
    .map((s) => ({ at: s.at, v: s[key] }))
    .filter((p) => Number.isFinite(p.v));

  if (values.length < 2) return null;

  const vs = values.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const t0 = values[0].at;
  const tSpan = values[values.length - 1].at - t0 || 1;

  return {
    min,
    max,
    points: values.map((p) => ({
      x: (p.at - t0) / tSpan,
      y: (p.v - min) / span
    }))
  };
}

