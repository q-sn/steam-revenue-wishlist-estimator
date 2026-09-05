import { WISHLIST, WEEK_ONE, ENSEMBLE } from './constants.js';
import { matchTagRule } from './tags.js';
import { wishlistsFromRank } from './wishlist-rank.js';
import { combineEstimators } from './ensemble.js';

/**
 * The follower-to-wishlist multiplier for a game's genre, if we can see one.
 *
 * GDC_FOLLOWERS_2023 publishes per-tag multipliers next to the 7-20x range
 * this file already uses, so a game tagged Puzzle gets 15.9x rather than the
 * all-games median of 12x. Genre moves this ratio nearly as far as the whole
 * published range is wide — 7.5x for 4X strategy against 15.9x for puzzle —
 * which makes it the largest readable signal here by a wide margin, and
 * unlike promotion history it is written on the store page.
 *
 * One tag only, and it is the game's own most-applied one among those the
 * survey covers. Stacking two would invent a number neither row supports, and
 * picking by table order would answer with whichever row we happened to type
 * first: a game tagged Puzzle, Indie and Relaxing scored as Relaxing.
 */
export function wishlistMultiplierFor(tags) {
  const rule = matchTagRule(tags, WISHLIST.genres);
  if (!rule) return null;
  return { multiplier: rule.multiplier, label: rule.label, source: rule.source };
}

/**
 * Wishlists from follower count.
 *
 * Following a game joins a mostly hidden group whose member count is public,
 * which is the only public signal that tracks purchase intent rather than
 * completed purchases. That is also why wishlists cannot be derived from
 * reviews at any multiplier: a review is a function of a sale that already
 * happened.
 */
function fromFollowers(game, followers) {
  // Return the key that was actually applied, not the one that was requested.
  // If the two can drift apart, the caption will eventually describe a
  // multiplier the maths never used.
  const contextKey = WISHLIST.contexts[game.festivalContext] ? game.festivalContext : 'unknown';
  const context = WISHLIST.contexts[contextKey];

  const genre = wishlistMultiplierFor(game.tags);
  const base = genre ? genre.multiplier : WISHLIST.median;

  // Clamped into the published range. A genre at the bottom of the table
  // combined with a context factor below 1 can otherwise put the midpoint
  // underneath the low end of the band it sits in, which would draw a marker
  // outside its own scale.
  const multiplier = Math.min(Math.max(base * context.factor, WISHLIST.lo), WISHLIST.hi);

  return {
    followers,
    contextKey,
    context,
    genre,
    multiplier,
    range: {
      lo: followers * WISHLIST.lo,
      mid: followers * multiplier,
      hi: followers * WISHLIST.hi
    }
  };
}

/**
 * Wishlists, from two signals that share nothing.
 *
 * The follower ratio and the store's own wishlist ranking estimate the same
 * quantity from unrelated inputs — a hidden group's member count on one side,
 * a position in a published ordering on the other — so they combine under the
 * same rule everything else here does. Two legs are what make this figure
 * contradictable at all: a single one could only ever restate one survey's
 * published range.
 *
 * Valid before release only. Afterwards wishlists are consumed by purchases
 * while followers persist, and the balance typically peaks at 2-4x the
 * pre-launch count before decaying — a different regime with no stable ratio.
 * The store ordering agrees: released games are not in it at all.
 */
export function estimateWishlists(game, opts = {}) {
  const followers = Number.isFinite(game.followers) && game.followers > 0 ? game.followers : null;

  // Release state is checked first on purpose. For a released game "no
  // wishlist estimate because it shipped" is the true and useful answer, and
  // reporting a missing follower count instead would send the reader looking
  // for a problem that is not there.
  if (game.released) {
    return {
      ok: false,
      reason: 'released',
      followers,
      noteKey: 'wReleased',
      note: 'Wishlists are consumed by purchases at launch while followers persist, so the ratio no longer holds. The balance typically peaks at 2-4x the pre-launch count shortly after release, then decays.'
    };
  }

  const followerLeg = followers != null ? fromFollowers(game, followers) : null;
  const rankLeg = wishlistsFromRank(
    Number.isFinite(game.wishlistRank) ? game.wishlistRank : null,
    game.wishlistListing ?? null,
    { releaseDate: game.releaseDate ?? null, now: opts.now }
  );

  const estimators = [];
  if (followerLeg) {
    estimators.push({
      method: 'followers',
      label: { key: 'mFollowerRatio', text: 'Followers x published ratio' },
      range: followerLeg.range,
      weight: ENSEMBLE.wishlists.followers
    });
  }
  if (rankLeg.ok) {
    estimators.push({
      method: 'rank',
      label: { key: 'mWishlistRank', text: 'Position in Steam\'s wishlist ranking' },
      range: rankLeg.range,
      weight: ENSEMBLE.wishlists.rank
    });
  }

  // A ceiling, not an estimate. Absence from the ordering says the game is
  // below every ranked position and nothing more, so it never joins the
  // average — it can only contradict one.
  const ceiling = rankLeg.reason === 'below-list' ? rankLeg.ceiling : null;

  if (!estimators.length) {
    return {
      ok: false,
      reason: 'no-followers',
      followers,
      rank: null,
      rankReason: rankLeg.reason,
      ceiling
    };
  }

  const combined = combineEstimators(estimators);

  // The follower estimate says the game holds more wishlists than the bottom
  // of a list it is not on. One of the two is wrong and the reader should be
  // told which two numbers are in conflict rather than shown their average —
  // there is no average here, because a bound was never in it.
  const ceilingBreached = ceiling != null && combined.range.lo > ceiling;

  return {
    ok: true,
    followers,
    // Follower-leg detail, kept flat so the overlay's caption and the
    // history delta keep reading the same fields they always have.
    contextKey: followerLeg?.contextKey ?? null,
    context: followerLeg?.context ?? null,
    genre: followerLeg?.genre ?? null,
    multiplier: followerLeg?.multiplier ?? null,
    followerRange: followerLeg?.range ?? null,
    rank: rankLeg.ok ? rankLeg : null,
    rankReason: rankLeg.ok ? null : rankLeg.reason,
    ceiling,
    ceilingBreached,
    range: combined.range,
    contributors: combined.contributors,
    widened: combined.widened,
    gap: combined.gap,
    common: combined.common,
    disagreement: combined.disagreement
  };
}

/**
 * Two published routes from public data to week-one sales.
 *
 * Chained together these disagree by roughly 2x: followers x 12 x 0.11 gives
 * ~1.32x followers, while Birkett's older direct rule gives 2.5x. The gap is
 * explainable — wishlist conversion has fallen since the direct rule was
 * written — but it is the cleanest available demonstration that two respected
 * heuristics, composed, produce a 2x spread. We show both rather than picking.
 *
 * There is deliberately no midpoint here. `span` is where the two answers sit,
 * not a range with a centre: the whole point of showing both is that nobody
 * knows which is right, and anything called `mid` eventually gets rendered as
 * though somebody did.
 */
export function weekOneSales(game, wishlistRange) {
  const out = [];

  if (wishlistRange?.mid) {
    out.push({
      key: 'via-wishlists',
      labelKey: 'pathWishlists',
      label: WEEK_ONE.fromWishlists.label,
      source: WEEK_ONE.fromWishlists.source,
      value: wishlistRange.mid * WEEK_ONE.fromWishlists.factor
    });
  }

  if (Number.isFinite(game.followers) && game.followers > 0) {
    out.push({
      key: 'via-followers',
      labelKey: 'pathFollowers',
      label: WEEK_ONE.fromFollowers.label,
      source: WEEK_ONE.fromFollowers.source,
      value: game.followers * WEEK_ONE.fromFollowers.factor
    });
  }

  if (out.length < 2) return { ok: out.length > 0, paths: out };

  const values = out.map((p) => p.value);

  return {
    ok: true,
    paths: out,
    disagreement: Math.max(...values) / Math.min(...values),
    span: { lo: Math.min(...values), hi: Math.max(...values) }
  };
}
