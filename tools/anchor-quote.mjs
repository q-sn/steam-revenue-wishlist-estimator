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

/**
 * Announcement bodies are BBCode, not HTML, so stripping only `<tags>` left
 * `[p]`, `[b]` and whole `[img src="{STEAM_CLAN_IMAGE}/…png"]` blobs in the
 * text. That cost twice over: `[b]200,000[/b] wishlists` did not match at all,
 * and a single image filled the 60/90-character windows so the achievement
 * word that follows it was never seen. An audit of all 5,575 ranked games put
 * 246 of 292 `no-achievement-word` refusals on markup inside the window.
 *
 * Tags become a space and the whitespace collapses, so `200,000[/b] wishlists`
 * reads as one phrase while `wishlists[/p][p]Thank` does not become one word.
 */
export function clean(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[\/?[a-z][^\]]{0,300}\]/gi, ' ')
    .replace(/\{STEAM_CLAN_IMAGE\}\S*/gi, ' ')
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    // Posts are typed in editors that curl quotes, so every rule spelled with
    // a straight apostrophe — "let's", "we've", "they're" — was missing the
    // form actually written. "Let’s collect 100 likes and 2000 wishlists" read
    // as an achievement for want of one character.
    .replace(/[‘’ʼ]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A scale can be a letter or a word. "1.5M" matched and "1.5 million" did not,
 * because `[kKmM]\b` fails on the `i` that follows — and the spelled form is
 * how the biggest games announce. Nine of the thirteen games in the archive
 * above a million write it out.
 */
const SCALE = String.raw`(?:k|m|thousand|million)`;
const DIGITS = String.raw`\d{1,3}(?:[,.    ]\d{3})+|\d+(?:[.,]\d+)?\s*${SCALE}\b|\d{4,}`;
/** "one million", "half a million", "one hundred thousand". */
const WORDS = String.raw`(?:half\s+a|(?:a\s+)?quarter\s+of\s+a|a|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:hundred\s+)?(?:thousand|million)`;

export const COUNT = `(${DIGITS}|${WORDS})`;
export const MILESTONE = new RegExp(COUNT + String.raw`\s*\+?\s*(?:steam\s+)?wishlists?`, 'gi');

/** Any figure a post states, for spotting a retrospective that quotes an older one. */
export const ANY_FIGURE = new RegExp(COUNT + String.raw`\s*\+?\s*(?:steam\s+)?(?:wishlists?|wishlist mark|mark\b|now\b)`, 'gi');

const WORD_UNITS = { half: 0.5, quarter: 0.25, a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/** "650 000" / "1,000,000" / "100k" / "1.5M" / "half a million" -> a number. */
export function parseCount(raw) {
  const text = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

  const words = /^(half a|(?:a )?quarter of a|a|one|two|three|four|five|six|seven|eight|nine|ten) (hundred )?(thousand|million)$/.exec(text);
  if (words) {
    const unit = WORD_UNITS[words[1].split(' ')[0]] ?? null;
    if (unit == null) return null;
    const scale = (words[2] ? 100 : 1) * (words[3] === 'million' ? 1_000_000 : 1_000);
    return Math.round(unit * scale);
  }

  const suffix = /(?:^|[\d\s])(k|m|thousand|million)$/.exec(text)?.[1];
  const scale = suffix === 'm' || suffix === 'million' ? 1_000_000
    : suffix === 'k' || suffix === 'thousand' ? 1_000 : 1;
  const digits = text.replace(/\s*(?:k|m|thousand|million)$/, '').trim();
  const value = scale === 1
    ? Number(digits.replace(/[,.    ]/g, ''))
    : Number(digits.replace(/,/g, '.'));
  return Number.isFinite(value) ? Math.round(value * scale) : null;
}

const ACHIEVED = /\b(?:hits?|reach\w*|passe?[ds]?|surpass\w*|cross\w*|exceed\w*|smash\w*|gather\w*|collect\w*|amassed|received|milestone|thanks?|thank you|celebrat\w*|achiev\w*|blasted|broke|broken|climbed|now (?:at|has|have|sitting)|(?:we|they)(?:'re| are) (?:now )?at|we(?:'ve| have)|got|over|more than|almost|nearly|approach\w*|nearing|added to|wishlisted|of you|sitting at|currently at|up to|already|stands? at|sits? at)\b/i;

/** A figure the studio wants to reach. */
const GOAL = /\b(?:help (?:us|me|them)(?: to)? (?:reach|hit|get|gather|smash)|let'?s (?:hit|reach|get|collect|gather|smash|make it to)|we(?:'ll| will) hit|road to|on the (?:road|way) to|to the next|all the way to|if (?:we|they) [^.!?]{0,20}?(?:hit|reach|get|collect|gather)\b|once we (?:hit|reach)|when we (?:hit|reach)|until we (?:hit|reach|get)|aim(?:ing|ed)? (?:for|at)|toward|hoping to (?:hit|reach)|hope to (?:hit|reach)|next (?:milestone|goal|tier|target)|rewards?\b[^.!?]{0,40}\b(?:waiting|await\w*) at|(?:goal|target|dream|plan|quest|mission|journey)\b[^.!?]{0,40}\bto (?:hit|reach|get to|obtain|achieve|collect|gather))\b|\b(?:goal|target)s?\b[^.!?]{0,18}$/i;

/**
 * Explicitly short of the number. "Almost 40k" and "nearly 5,000" round to the
 * figure and stay; "a step away from 10,000" and "close to reaching 10,000"
 * say the opposite, and three such rows had been standing in the archive.
 */
const NOT_YET = /\b(?:away from|close to|closer to|closing in (?:on|to)|a step away|steps? away|shy of|short of)\b[^.!?]{0,60}$/i;

/**
 * A position in the chart, not a balance: "Restitched | Top 1,000 Wishlists!"
 * means the game is among the thousand most wishlisted, not that it has that
 * many.
 */
const RANK = /\btop\s*$/i;

/**
 * A number the studio is looking forward to. Anchored to the figure, unlike
 * the rest of GOAL: "we cannot wait to show you more." sitting in the previous
 * sentence took a genuine "250K Wishlists for the Sequel" with it.
 */
const HOPED_FOR = /\b(?:can(?:'t|not) wait to|looking forward to)\b[^.!?]{0,30}$/i;

/** A numbered rung on a reward ladder: "Milestone Three: 1,500,000 wishlists". */
const TIER = /\b(?:milestone|tier|goal|reward|stretch)\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s*[:–—-]/i;

/** Rescues a goal that was met: "we've reached our target of 10,000". */
const GOAL_MET = /\b(?:reach\w*|hit|passed|achieved|smashed|beat|exceeded|surpassed|cleared|met)\s+(?:our|the|my|its|a\s+\w+)?\s*(?:goal|target)\b/i;
const GOAL_TRAIL = /\b(?:if we (?:hit|reach)|once we (?:hit|reach)|will unlock|to unlock|help us (?:reach|hit|get))\b/i;

/**
 * A gain stated as one, right against the number. This overrides everything,
 * including a headline: "Gained 1000 overnight!" is a title, and the post that
 * carried it went on to say the balance was 1,166.
 *
 * Only the verbs that always mean a delta. "Earned over 10k wishlists" and
 * "racked up over 140,000 wishlists" are how studios state a total, and both
 * were in the archive correctly.
 */
const GAIN_LEAD = /\b(?:gained|added)\s+(?:another\s+|over\s+|about\s+|around\s+|nearly\s+|almost\s+|a further\s+)?$/i;
const GAIN_TRAIL = /^\W{0,3}(?:gained|earned)\b/i;

/** A gain over a period rather than a total. */
const DELTA_LEAD = /\bduring (?:the|our|this) (?:festival|event|fest|showcase|sale)\b[^.!?]{0,45}$/i;
const DELTA_TRAIL = /^\W{0,3}(?:over the weekend|during (?:the|our|this) \w+|in (?:one|a|the last|the past)\s+(?:week|weekend|day|month))\b/i;

/** Separates "we hit 100k wishlists over the weekend" from "35,000 wishlists over the weekend". */
const TOTAL_VERB = /\b(?:hits?|reach\w*|passe?[ds]?|surpass\w*|cross\w*|exceed\w*|smash\w*|broke|climbed|milestone|has|have|now)\b/i;

/**
 * Not this store's balance. Read off the sentence, not the post: a post that
 * mentions "millions of views across platforms" further down was killing a
 * plain "we reached 50,000 wishlists" five paragraphs above it.
 */
const PLATFORM = /\bacross (?:all )?(?:platforms|steam and|consoles)|\bon steam and (?:epic|gog|consoles?|xbox|playstation)|\b(?:combined|multi-?platform)\s+(?:total|wishlists?)/i;

/**
 * A release year wearing the shape of a count: "arrives in 2026 — Wishlist now
 * on Steam". Only bare four digits in living memory, only when what follows is
 * the call to action rather than a celebration, and only when nothing in the
 * lead claims the number was reached — "2000 Wishlists! Thank you" is one of
 * the forty genuine two-thousand milestones in the archive.
 */
const CTA_TRAIL = /^\W{0,3}(?:now\b|today\b|it\b|us\b|the game\b|on steam\b|and follow\b|here\b)/i;
const looksLikeYear = (raw, value) => value >= 1990 && value <= 2099 && /^\d{4}$/.test(String(raw ?? '').trim());

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
 * A figure the post is looking forward to rather than reporting. Used when
 * deciding whether a larger number elsewhere makes this one a retrospective:
 * "we cannot wait to celebrate 300k" does not make today's 200,000 stale.
 */
export function isAspirational(lead) {
  return GOAL.test(lead) || NOT_YET.test(lead) || HOPED_FOR.test(lead);
}

/**
 * @param {string} lead   text before the number
 * @param {string} trail  text after the word "wishlist(s)"
 * @param {string} post   the whole post, kept for callers that pass it
 * @param {object} [opts]
 * @param {boolean} [opts.inTitle] the figure stands in the post's own headline
 * @param {string}  [opts.raw]     the matched number as written
 * @param {number}  [opts.value]   the parsed figure
 * @returns {string|null} why it was rejected, or null to keep it
 */
export function rejectQuote(lead, trail, post, opts = {}) {
  const { inTitle = false, raw = null, value = null } = opts;

  if (startsMidNumber(lead)) return 'fragment-of-a-longer-number';
  if (looksLikeYear(raw, value) && CTA_TRAIL.test(trail) && !ACHIEVED.test(lead)) return 'release-year';
  if (RANK.test(lead)) return 'a-rank-not-a-count';
  if (GAIN_LEAD.test(lead) || GAIN_TRAIL.test(trail)) return 'period-gain';
  // "+1510 Wishlists" writes the plus against the number, which is the delta
  // notation — unless a verb already claims a total, because "has reached
  // +60,000 wishlists" is the other way of writing "60,000+". A headline
  // joining two topics writes "Trailer + 50K", with the space, and that plus
  // is a conjunction — see below.
  const verbClaimsTotal = TOTAL_VERB.test(lead.slice(-22));
  if (/\+$/.test(lead) && !verbClaimsTotal) return 'period-gain';
  if (TIER.test(lead)) return 'reward-tier';
  if (NOT_YET.test(lead)) return 'not-yet-reached';
  if (HOPED_FOR.test(lead)) return 'goal';
  if (GOAL.test(lead) && !GOAL_MET.test(lead)) return 'goal';
  if (GOAL_TRAIL.test(trail)) return 'goal';

  // A headline is the claim. "🚨 300,000 WISHLISTS! 🚨" carries no verb, and
  // requiring one refused 202 such posts across the ranked list.
  const claimsTotal = inTitle || verbClaimsTotal;
  if (DELTA_LEAD.test(lead) && !claimsTotal) return 'period-gain';
  if (/\+\s+$/.test(lead) && !claimsTotal) return 'period-gain';
  if (DELTA_TRAIL.test(trail) && !claimsTotal) return 'period-gain';
  if (PLATFORM.test(`${lead} ${trail}`)) return 'not-this-store';
  if (inTitle) return null;
  if (!ACHIEVED.test(lead) && !ACHIEVED.test(trail)) return 'no-achievement-word';
  return null;
}

/**
 * The same rules against a stored quote, which is a window around the number
 * rather than a whole post. Returns null when the value cannot be located,
 * which is not a reason to drop a row that was accepted when it was harvested.
 *
 * The quote is cleaned on the way in: rows harvested before BBCode was
 * stripped still carry it, and re-reading them through the old text would
 * refuse what a fresh harvest now keeps.
 */
export function rejectStoredQuote(quoted, wishlists, opts = {}) {
  const text = clean(quoted);
  let why = null;
  let found = false;
  // A quote is a window, and the figure it is centred on usually appears in it
  // twice. Any occurrence that reads as an achievement is enough; refusing on
  // the first one dropped rows whose headline copy was fine.
  for (const m of text.matchAll(new RegExp(MILESTONE.source, 'gi'))) {
    if (parseCount(m[1]) !== wishlists) continue;
    found = true;
    const end = m.index + m[0].length;
    why = rejectQuote(
      text.slice(Math.max(0, m.index - 60), m.index),
      text.slice(end, end + 90),
      text,
      { ...opts, raw: m[1], value: wishlists }
    );
    if (!why) return null;
  }
  return found ? why : null;
}
