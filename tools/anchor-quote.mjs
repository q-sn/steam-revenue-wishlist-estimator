/**
 * Whether the sentence around a number says the game reached it.
 *
 * Shared by the harvester, which reads it out of a fresh post, and by the
 * condenser, which re-reads it off the stored quote so a rule fixed today also
 * cleans rows the archive already holds.
 *
 * The windows are positional — LEAD is what comes before the number, TRAIL is
 * what follows the word — because one window around both lets a goal word
 * anywhere nearby rescue a target and an achievement word anywhere nearby
 * rescue a goal.
 */

export const COUNT = String.raw`(\d{1,3}(?:[,.    ]\d{3})+|\d+(?:[.,]\d+)?\s*[kKmM]\b|\d{4,})`;
export const MILESTONE = new RegExp(COUNT + String.raw`\s*\+?\s*(?:steam\s+)?wishlists?`, 'gi');

const ACHIEVED = /\b(?:hits?|reach\w*|passe?[ds]?|surpass\w*|cross\w*|exceed\w*|smash\w*|gather\w*|collect\w*|amassed|received|milestone|thanks?|thank you|celebrat\w*|achiev\w*|blasted|broke|broken|climbed|now (?:at|has|have|sitting)|(?:we|they)(?:'re| are) (?:now )?at|we(?:'ve| have)|got|over|more than|almost|nearly|approach\w*|nearing|added to|wishlisted|of you|sitting at|currently at|up to|already)\b/i;

/** A figure the studio wants to reach. */
const GOAL = /\b(?:help (?:us|me|them)(?: to)? (?:reach|hit|get|gather|smash)|let'?s (?:hit|reach|get)|we(?:'ll| will) hit|road to|on the (?:road|way) to|to the next|all the way to|if we (?:hit|reach|get)|once we (?:hit|reach)|when we (?:hit|reach)|aim(?:ing)? for|toward|hoping to (?:hit|reach)|hope to (?:hit|reach)|next (?:milestone|goal|tier|target)|(?:goal|target|dream|plan)\b[^.!?]{0,40}\bto (?:hit|reach|get to))\b|\b(?:goal|target)s?\b[^.!?]{0,18}$/i;

/** A numbered rung on a reward ladder: "Milestone Three: 1,500,000 wishlists". */
const TIER = /\b(?:milestone|tier|goal|reward|stretch)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s*[:–—-]/i;

/** Rescues a goal that was met: "we've reached our target of 10,000". */
const GOAL_MET = /\b(?:reach\w*|hit|passed|achieved|smashed|beat|exceeded|surpassed|cleared|met)\s+(?:our|the|my|its|a\s+\w+)?\s*(?:goal|target)\b/i;
const GOAL_TRAIL = /\b(?:reaching (?:this|that) goal|if we (?:hit|reach)|once we (?:hit|reach)|will unlock|to unlock|help us (?:reach|hit|get))\b/i;

/** A gain over a period rather than a total. */
const DELTA_LEAD = /\bgained\s+another\s+$|\bduring (?:the|our|this) (?:festival|event|fest|showcase|sale)\b[^.!?]{0,45}$/i;
const DELTA_TRAIL = /^\W{0,3}(?:over the weekend|during (?:the|our|this) \w+|in (?:one|a|the last|the past)\s+(?:week|weekend|day|month))\b/i;

/** Separates "we hit 100k wishlists over the weekend" from "35,000 wishlists over the weekend". */
const TOTAL_VERB = /\b(?:hits?|reach\w*|passe?[ds]?|surpass\w*|cross\w*|exceed\w*|smash\w*|broke|climbed|milestone)\b/i;

/** Not this store's balance. */
const PLATFORM = /\bacross (?:all )?(?:platforms|steam and|consoles)|\bon steam and (?:epic|gog|consoles?|xbox|playstation)|\b(?:combined|multi-?platform)\s+(?:total|wishlists?)/i;

/**
 * The match began inside a longer numeric token, so the digits are a fragment.
 * "Weekly Changelog: v0.111" running into "2500 wishlists" reads as 1,112,500.
 * A count merely lacking a space after a sentence is fine — that is common and
 * the eight such rows in the archive are all correct.
 */
function startsMidNumber(lead) {
  const last = lead.slice(-1);
  if (/\d/.test(last)) return true;
  return /[.,]/.test(last) && /\d/.test(lead.slice(-2, -1));
}

/**
 * @param {string} lead   text before the number
 * @param {string} trail  text after the word "wishlist(s)"
 * @param {string} post   the whole post, for claims about other stores
 * @returns {string|null} why it was rejected, or null to keep it
 */
export function rejectQuote(lead, trail, post) {
  if (startsMidNumber(lead)) return 'fragment-of-a-longer-number';
  if (TIER.test(lead)) return 'reward-tier';
  if (GOAL.test(lead) && !GOAL_MET.test(lead)) return 'goal';
  if (GOAL_TRAIL.test(trail)) return 'goal';
  if (DELTA_LEAD.test(lead)) return 'period-gain';

  const claimsTotal = TOTAL_VERB.test(lead.slice(-22));
  if (/\+\s*$/.test(lead) && !claimsTotal) return 'period-gain';
  if (DELTA_TRAIL.test(trail) && !claimsTotal) return 'period-gain';
  if (PLATFORM.test(post)) return 'not-this-store';
  if (!ACHIEVED.test(lead) && !ACHIEVED.test(trail)) return 'no-achievement-word';
  return null;
}

/**
 * The same rules against a stored quote, which is a window around the number
 * rather than a whole post. Returns null when the value cannot be located,
 * which is not a reason to drop a row that was accepted when it was harvested.
 */
export function rejectStoredQuote(quoted, wishlists) {
  const text = String(quoted ?? '');
  for (const m of text.matchAll(MILESTONE)) {
    const digits = String(m[1]).toLowerCase();
    const scale = digits.endsWith('m') ? 1e6 : digits.endsWith('k') ? 1e3 : 1;
    const n = scale === 1
      ? Number(digits.replace(/[,.    ]/g, ''))
      : Math.round(Number(digits.replace(/[km]$/, '').replace(/,/g, '.')) * scale);
    if (n !== wishlists) continue;
    const end = m.index + m[0].length;
    return rejectQuote(text.slice(Math.max(0, m.index - 60), m.index), text.slice(end, end + 90), text);
  }
  return null;
}
