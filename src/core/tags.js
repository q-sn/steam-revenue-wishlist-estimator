/**
 * Match a game's tags against a table of per-genre coefficients; exactly one
 * row applies. Iterates the tags, not the table — Steam ranks tags by how many
 * players applied them, so the first match is the game's strongest genre.
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
