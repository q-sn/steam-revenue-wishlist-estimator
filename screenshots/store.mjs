#!/usr/bin/env node
/**
 * Everything the Chrome Web Store listing needs, at the sizes it demands.
 *
 *   node screenshots/store.mjs             # all of them
 *   node screenshots/store.mjs 3 small     # just those
 *
 * Five listing screenshots at most, each exactly 1280 x 800 (or 640 x 400);
 * one small promotional tile at 440 x 280, which the store requires and ranks
 * listings without behind listings with; and the 1400 x 560 marquee, which is
 * optional but is what a featured placement needs. All of them JPEG or 24-bit
 * PNG with no alpha channel.
 *
 * So these render at a device scale factor of 1 — the pixel size *is* the
 * specification here, and a 2x capture would be rejected — and every file is
 * checked against all three rules before it is written. Chrome writes colour
 * type 2, 24-bit RGB, for a page that paints an opaque background, which
 * store/tiles.html does; a transparent one would come back as RGBA and be
 * refused at upload rather than here.
 *
 * The words and the layout live in store/tiles.html. The pictures are the
 * PNGs one level up, taken by take.mjs.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from './serve.mjs';
import { withPage, sleep } from './browser.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Every image the listing takes, keyed by the id tiles.html knows it as. */
const TILES = [
  { id: '1', file: '1-glance.png', width: 1280, height: 800 },
  { id: '2', file: '2-ranges.png', width: 1280, height: 800 },
  { id: '3', file: '3-waterfall.png', width: 1280, height: 800 },
  { id: '4', file: '4-wishlists.png', width: 1280, height: 800 },
  { id: '5', file: '5-sources.png', width: 1280, height: 800 },
  { id: 'small', file: 'promo-small-440x280.png', width: 440, height: 280 },
  { id: 'marquee', file: 'promo-marquee-1400x560.png', width: 1400, height: 560 }
];

const asked = process.argv.slice(2);
const wanted = asked.length ? TILES.filter((t) => asked.includes(t.id)) : TILES;

if (!wanted.length) {
  console.error(`no such tile. Known: ${TILES.map((t) => t.id).join(', ')}`);
  process.exit(1);
}

const server = await startServer();

try {
  for (const tile of wanted) {
    const size = { width: tile.width, height: tile.height };

    const png = await withPage({ viewport: size, deviceScaleFactor: 1 }, async (cdp) => {
      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', {
        url: `http://127.0.0.1:${server.port}/screenshots/store/tiles.html?tile=${tile.id}`
      });
      await Promise.race([loaded, sleep(15_000)]);
      // No web fonts, but the shots next door are <img> and background-image
      // alike, and a tile captured before they decode is a tile of empty
      // frames.
      await cdp.eval('document.fonts.ready.then(() => Promise.all('
        + '[...document.images].map((i) => i.decode().catch(() => {}))))');
      await sleep(500);

      const overflow = await cdp.eval(`(() => {
        const on = document.querySelector('.tile.on');
        return Math.max(0, Math.round(on.scrollHeight - on.getBoundingClientRect().height));
      })()`);
      if (overflow > 0) {
        throw new Error(`tile ${tile.id} overflows its ${tile.height}px by ${overflow}px`
          + ' — shorten it');
      }

      return cdp.png({ x: 0, y: 0, ...size, scale: 1 });
    });

    if (png.width !== tile.width || png.height !== tile.height) {
      throw new Error(`${tile.file} came out ${png.width}x${png.height},`
        + ` not ${tile.width}x${tile.height}`);
    }
    if (png.colourType !== 2) {
      throw new Error(`${tile.file} is PNG colour type ${png.colourType}; the store takes`
        + ' 24-bit RGB (type 2) with no alpha');
    }

    await writeFile(join(HERE, 'store', tile.file), png.data);
    console.log(`store/${tile.file}: ${png.width}x${png.height}, 24-bit RGB,`
      + ` ${(png.data.length / 1024).toFixed(0)} KB`);
  }
} finally {
  await server.close();
}
