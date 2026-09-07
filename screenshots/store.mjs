#!/usr/bin/env node
/**
 * The Chrome Web Store listing screenshots.
 *
 *   node screenshots/store.mjs          # all five
 *   node screenshots/store.mjs 3        # just that one
 *
 * The store takes at most five, each exactly 1280 x 800 (or 640 x 400), as a
 * JPEG or a 24-bit PNG with no alpha channel. So these are rendered at 1280 x
 * 800 with a device scale factor of 1 — the pixel size *is* the specification
 * here, and a 2x capture would be rejected — and every file is checked
 * against all three rules before it is written.
 *
 * Chrome writes colour type 2, 24-bit RGB, for a page that paints an opaque
 * background, which store/tiles.html does. A transparent one would come back
 * as RGBA and be refused at upload; the check below is what catches that.
 *
 * The words live in store/tiles.html. The pictures are the PNGs one level up,
 * taken by take.mjs.
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from './serve.mjs';
import { withPage, sleep } from './browser.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SIZE = { width: 1280, height: 800 };

/** Tile number to file name; the number is the order they appear in the listing. */
const TILES = [
  '1-glance.png',
  '2-ranges.png',
  '3-waterfall.png',
  '4-wishlists.png',
  '5-sources.png'
];

const only = process.argv.slice(2).map(Number).filter(Boolean);
const wanted = only.length ? only : TILES.map((_, i) => i + 1);

const server = await startServer();

try {
  for (const n of wanted) {
    const file = TILES[n - 1];
    if (!file) throw new Error(`no tile ${n}; there are ${TILES.length}`);

    const png = await withPage({ viewport: SIZE, deviceScaleFactor: 1 }, async (cdp) => {
      const loaded = cdp.once('Page.loadEventFired');
      await cdp.send('Page.navigate', {
        url: `http://127.0.0.1:${server.port}/screenshots/store/tiles.html?tile=${n}`
      });
      await Promise.race([loaded, sleep(15_000)]);
      // Web fonts are not used, but the four PNGs are, and a tile captured
      // before they decode is a tile of empty frames.
      await cdp.eval('document.fonts.ready.then(() => Promise.all('
        + '[...document.images].map((i) => i.decode().catch(() => {}))))');
      await sleep(400);

      const overflow = await cdp.eval(`(() => {
        const tile = document.querySelector('.tile.on');
        const r = tile.getBoundingClientRect();
        return Math.max(0, Math.round(tile.scrollHeight - r.height));
      })()`);
      if (overflow > 0) {
        throw new Error(`tile ${n} overflows its 800px by ${overflow}px — shorten it`);
      }

      return cdp.png({ x: 0, y: 0, ...SIZE, scale: 1 });
    });

    if (png.width !== SIZE.width || png.height !== SIZE.height) {
      throw new Error(`${file} came out ${png.width}x${png.height}, not 1280x800`);
    }
    if (png.colourType !== 2) {
      throw new Error(`${file} is PNG colour type ${png.colourType}; the store takes`
        + ' 24-bit RGB (type 2) with no alpha');
    }

    await writeFile(join(HERE, 'store', file), png.data);
    console.log(`store/${file}: ${png.width}x${png.height}, 24-bit RGB,`
      + ` ${(png.data.length / 1024).toFixed(0)} KB`);
  }
} finally {
  await server.close();
}
