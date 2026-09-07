/**
 * What the collapsed pill shows.
 *
 * The order is fixed and deliberate: reviews are the measured input, units and
 * the money are derived from them, and wishlists come from a separate signal
 * entirely. Read left to right the pill is a chain, not a pile of numbers, so
 * users choose which links to show rather than rearranging them.
 *
 * Of the two money figures, gross is the one that ships. It is what buyers
 * paid, so it is the figure a stranger to the store page can compare against
 * every "we made $X" post a developer has ever written; net answers a narrower
 * question — what this particular developer took home — and it depends on
 * assumptions the reader has not seen yet at pill width. Both are available,
 * and a reader who wants the pair can switch net back on beside it.
 *
 * Kept in core rather than the overlay so the selection logic is testable in
 * Node without a DOM.
 */

/** @typedef {'compact'|'money'|'integer'} FigureFormat */

export const PILL_ITEMS = [
  { key: 'reviews', labelKey: 'pillReviews', optionKey: 'optPillReviews', format: 'compact', defaultOn: true },
  { key: 'units', labelKey: 'pillUnits', optionKey: 'optPillUnits', format: 'compact', defaultOn: true },
  { key: 'gross', labelKey: 'pillGross', optionKey: 'optPillGross', format: 'money', defaultOn: true },
  { key: 'net', labelKey: 'pillNet', optionKey: 'optPillNet', format: 'money', defaultOn: false },
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
    // Both walk the same envelope, so showing the pair describes one scenario
    // read at two points rather than two competing estimates.
    case 'gross':
      return revenue?.ok ? revenue.gross.mid : null;
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
 * A short tail after a figure: another fact about the same number, never a
 * second number of its own.
 *
 * The wishlist estimate carries the game's place in Steam's wishlist ordering.
 * That position is the one thing on this row that is *measured* rather than
 * inferred — everything else in the pill is the output of a model — and it is
 * also what a reader can check for themselves in thirty seconds. It rides
 * along with the figure it helped produce rather than taking a slot of its
 * own, because it is not a peer of the other figures and a separator between
 * them would say it was.
 *
 * Returned as a message descriptor, like every other user-facing string
 * leaving the core: `#` is not a rank marker in every language this ships in.
 */
function suffixFor(key, result) {
  if (key !== 'wishlists') return null;
  const rank = result.wishlists?.rank?.rank;
  if (!Number.isFinite(rank)) return null;
  return { key: 'pillRank', value: rank, text: `#${rank}` };
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
    .map((item) => ({
      ...item,
      value: valueFor(item.key, result),
      suffix: suffixFor(item.key, result)
    }))
    .filter((item) => item.value != null);
}
