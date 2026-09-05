/**
 * What the collapsed pill shows.
 *
 * The order is fixed and deliberate: reviews are the measured input, units and
 * net revenue are derived from them, and wishlists come from a separate signal
 * entirely. Read left to right the pill is a chain, not a pile of numbers, so
 * users choose which links to show rather than rearranging them.
 *
 * Kept in core rather than the overlay so the selection logic is testable in
 * Node without a DOM.
 */

/** @typedef {'compact'|'money'|'integer'} FigureFormat */

export const PILL_ITEMS = [
  { key: 'reviews', labelKey: 'pillReviews', optionKey: 'optPillReviews', format: 'compact', defaultOn: true },
  { key: 'units', labelKey: 'pillUnits', optionKey: 'optPillUnits', format: 'compact', defaultOn: true },
  { key: 'net', labelKey: 'pillNet', optionKey: 'optPillNet', format: 'money', defaultOn: true },
  { key: 'wishlists', labelKey: 'pillWishlists', optionKey: 'optPillWishlists', format: 'compact', defaultOn: true },
  { key: 'players', labelKey: 'pillPlayers', optionKey: 'optPillPlayers', format: 'compact', defaultOn: false }
];

export const PILL_DEFAULTS = Object.fromEntries(
  PILL_ITEMS.map((item) => [item.key, item.defaultOn])
);

/** Pull the value for one item out of a result, or null if it is unavailable. */
function valueFor(key, result) {
  const { game, units, revenue, wishlists } = result;
  switch (key) {
    case 'reviews':
      // Zero is an absence, not a figure. "0 reviews" occupies a slot in a
      // glance surface to communicate nothing.
      return Number.isFinite(game?.reviews) && game.reviews > 0 ? game.reviews : null;
    case 'units':
      return units?.ok ? units.range.mid : null;
    case 'net':
      return revenue?.ok ? revenue.net.mid : null;
    case 'wishlists':
      return wishlists?.ok ? wishlists.range.mid : null;
    case 'players': {
      // Live count where we have it, yesterday's peak as the fallback. Zero is
      // an absence rather than a figure, same rule as the review count: nobody
      // needs a glance surface to tell them "In-Game 0".
      const live = game?.currentPlayers;
      if (Number.isFinite(live) && live > 0) return live;
      const peak = game?.peak24h ?? game?.peakCcuYesterday;
      return Number.isFinite(peak) && peak > 0 ? peak : null;
    }
    default:
      return null;
  }
}

/**
 * Figures to render, in canonical order.
 *
 * An item appears only when it is both switched on and actually available, so
 * turning something on never produces a dash in the pill — the pill is a
 * glance surface, and a placeholder there is worse than an absence.
 *
 * @param {object} result output of estimateAll
 * @param {Record<string, boolean>} [config] per-key visibility
 */
export function pillFigures(result, config = {}) {
  const merged = { ...PILL_DEFAULTS, ...config };

  return PILL_ITEMS
    .filter((item) => merged[item.key])
    .map((item) => ({ ...item, value: valueFor(item.key, result) }))
    .filter((item) => item.value != null);
}
