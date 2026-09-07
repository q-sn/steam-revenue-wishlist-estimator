#!/usr/bin/env node
/**
 * Every picture in the project README, with the framing each one uses.
 *
 *   node screenshots/take.mjs                 # from the inputs in inputs/
 *   node screenshots/take.mjs --collect       # refetch today's figures first
 *   node screenshots/take.mjs released.png    # just one, by file name
 *
 * The games are named here rather than passed in because the framing is
 * chosen for the page behind each one — where the artwork sits, how tall the
 * panel grows — and a different game needs a different frame, not a different
 * argument. Both are pages nobody has to be logged in to see.
 */
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from './serve.mjs';
import { shoot } from './shoot.mjs';
import { collect, INPUTS } from './collect.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Tactical Breach Wizards: released, paid, with a full player history. */
const RELEASED = 1043810;
/** Haunted Paws: unreleased, ranked, and its studio published a figure. */
const UNRELEASED = 2861080;
/**
 * The Wandering Village, for the multiplier chain alone: its review count and
 * its discount history both move the multiple, so the panel shows a chain
 * with two steps and the two studies behind them rather than a bare band.
 */
const ADJUSTED = 1121640;

const SHOTS = [
  {
    // The pill in place, with enough of the store page around it to show
    // what it sits on. A literal region rather than the pill's own box: the
    // subject here is the page as much as the overlay.
    file: 'steam-page.png',
    appId: RELEASED,
    viewport: { width: 1440, height: 880 },
    clip: [700, 478, 740, 402]
  },
  {
    // The same page and pill, framed for the store listing's first tile:
    // wider than the README's crop, and cut where the tile needs it rather
    // than where a README column does.
    file: 'steam-page-wide.png',
    appId: RELEASED,
    viewport: { width: 1440, height: 880 },
    clip: [700, 576, 740, 304]
  },
  {
    file: 'released.png',
    appId: RELEASED,
    expanded: true,
    position: 'pos-tr',
    viewport: { width: 1440, height: 1500 },
    // No vertical margin: a top-right panel is 16px under Steam's own
    // header, and a sliver of it in frame reads as a mistake.
    pad: [12, 0]
  },
  {
    file: 'waterfall.png',
    appId: RELEASED,
    expanded: true,
    open: 'money',
    clip: 'foldout',
    pad: [0, 0],
    position: 'pos-tr',
    // The whole panel with the waterfall unfolded is taller than a laptop
    // screen; the viewport only has to be tall enough that it is not
    // scrolling when the section is measured.
    viewport: { width: 1440, height: 2400 }
  },
  {
    // The claim the whole project rests on, made visible: the chain from a
    // published multiplier band to this game's, with the studies it cites.
    file: 'multiplier.png',
    appId: ADJUSTED,
    expanded: true,
    open: 'multiplier',
    clip: 'foldout',
    pad: [0, 0],
    position: 'pos-tr',
    viewport: { width: 1440, height: 2400 }
  },
  {
    file: 'wishlists.png',
    appId: UNRELEASED,
    expanded: true,
    open: 'wishlist methods',
    position: 'pos-tr',
    viewport: { width: 1440, height: 1500 },
    pad: [12, 0]
  }
];

const args = process.argv.slice(2);
const refetch = args.includes('--collect');
const only = args.filter((a) => !a.startsWith('--'));
const wanted = only.length ? SHOTS.filter((s) => only.includes(s.file)) : SHOTS;

if (!wanted.length) {
  console.error(`no such shot. Known: ${SHOTS.map((s) => s.file).join(', ')}`);
  process.exit(1);
}

const appIds = [...new Set(wanted.map((s) => s.appId))];

for (const appId of appIds) {
  const path = join(INPUTS, `game-${appId}.json`);
  const have = await access(path).then(() => true, () => false);
  if (!refetch && have) continue;

  console.log(`collecting ${appId}${have ? ' again' : ''}`);
  const game = await collect(appId);
  console.log(`  ${game.name}: ${game.reviews ?? 'no'} reviews, ${game.followers ?? 'no'}`
    + ` followers, rank ${game.wishlistRank ?? '—'}, owners ${game.owners ?? '—'}`);
}

const server = await startServer();

try {
  for (const shot of wanted) {
    const png = await shoot({ ...shot, out: join(HERE, shot.file), port: server.port });
    console.log(`${shot.file}: ${png.width}x${png.height}, ${(png.bytes / 1024).toFixed(0)} KB`);
  }
} finally {
  await server.close();
}
