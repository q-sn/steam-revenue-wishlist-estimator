/** Locale-aware number formatting, delegated to Intl. */

let locale = 'en';

/** Set once, from the browser UI language. */
export function setLocale(tag) {
  if (typeof tag === 'string' && tag) locale = tag;
}

const cache = new Map();
function formatter(kind, options) {
  const cacheKey = `${locale}|${kind}`;
  let f = cache.get(cacheKey);
  if (!f) {
    f = new Intl.NumberFormat(locale, options);
    cache.set(cacheKey, f);
  }
  return f;
}

/** Compact counts: 1234 -> 1.2K, 4500000 -> 4.5M, localised. */
export function compact(n) {
  if (!Number.isFinite(n)) return '\u2014';
  return formatter('compact', { notation: 'compact' }).format(n);
}

/** Compact money. Prices are read with cc=us, so the figure is always USD. */
export function money(n) {
  if (!Number.isFinite(n)) return '\u2014';
  const sign = n < 0 ? '\u2212' : '';
  return sign + formatter('money', {
    notation: 'compact',
    style: 'currency',
    currency: 'USD'
  }).format(Math.abs(n));
}

export function pct(n, digits = 0) {
  if (!Number.isFinite(n)) return '\u2014';
  return formatter(`pct${digits}`, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  }).format(n);
}

/** Plain integer with locale grouping, for exact counts like followers. */
export function integer(n) {
  if (!Number.isFinite(n)) return '\u2014';
  return formatter('int', { maximumFractionDigits: 0 }).format(n);
}
