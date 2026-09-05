/**
 * Matching a game's tags against a table of per-genre coefficients.
 *
 * Two tables need this — the review multiplier and the follower-to-wishlist
 * ratio — and both apply exactly one row, because stacking genre coefficients
 * compounds noise.
 *
 * Which one, though, is the whole question. Iterating the *table* and taking
 * the first row that matches anything means the answer is decided by the order
 * the rows happen to sit in, which is an implementation detail: a game tagged
 * Puzzle, Indie and Relaxing would score as Relaxing purely because that row
 * is listed first.
 *
 * Iterating the *game's tags* instead uses real information. Steam returns
 * store-page tags ranked by how many players applied them, so the first tag
 * that matches any row is the game's most-agreed-upon genre among the ones we
 * have a figure for. Tag order is the signal; table order is not.
 */

/**
 * @param {string[]} tags the game's tags, most-applied first
 * @param {Array<{match: string[]}>} rules table rows, each with substrings to look for
 * @returns {object|null} the matching row, or null
 */
export function matchTagRule(tags, rules) {
  if (!Array.isArray(tags) || !tags.length || !Array.isArray(rules)) return null;

  for (const tag of tags) {
    const lowered = String(tag).toLowerCase();
    const hit = rules.find((rule) => rule.match.some((m) => lowered.includes(m)));
    if (hit) return hit;
  }
  return null;
}
