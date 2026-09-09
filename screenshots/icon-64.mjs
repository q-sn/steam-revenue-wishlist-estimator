#!/usr/bin/env node
/**
 * The 64 x 64 icon Opera's listing asks for.
 *
 *   node screenshots/icon-64.mjs
 *
 * The manifest carries 16, 32, 48 and 128 — the sizes Chrome and Firefox ask
 * for — and Opera wants one the manifest has no reason to hold. So this is a
 * listing asset like the tiles next door, written to store/opera/ rather than
 * to icons/, which keeps a file no browser loads out of every shipped package.
 *
 * 128 halves to 64 exactly, so the reduction is a clean 2:1 and the result is
 * the drawing rather than an interpolation of it. It is done on a canvas
 * instead of by screenshot because the icon has an alpha channel and a
 * captured frame would come back composited onto the page behind it — a white
 * or black square where the rounded corners should be transparent.
 *
 * The source is passed in as a data: URL, which is same-origin and therefore
 * does not taint the canvas; nothing is served over HTTP and no file is
 * written anywhere but the output.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { withPage } from './browser.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const SIZE = 64;
const FROM = 'icons/icon-128.png';
const TO = 'screenshots/store/opera/icon-64.png';

const source = await readFile(join(ROOT, FROM));
const dataUrl = `data:image/png;base64,${source.toString('base64')}`;

const encoded = await withPage(
  { viewport: { width: 128, height: 128 }, deviceScaleFactor: 1 },
  (cdp) => cdp.eval(`(async () => {
    const img = new Image();
    img.src = ${JSON.stringify(dataUrl)};
    await img.decode();

    const canvas = document.createElement('canvas');
    canvas.width = ${SIZE};
    canvas.height = ${SIZE};
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, ${SIZE}, ${SIZE});

    return canvas.toDataURL('image/png').split(',')[1];
  })()`)
);

const png = Buffer.from(encoded, 'base64');
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
const colourType = png[25];

if (width !== SIZE || height !== SIZE) {
  throw new Error(`came out ${width}x${height}, not ${SIZE}x${SIZE}`);
}
// 6 is RGBA. Anything else means the transparency was flattened on the way
// through, which is the one failure that looks fine until it is on a listing
// whose background is not the one it was flattened against.
if (colourType !== 6) {
  throw new Error(`came out PNG colour type ${colourType}; the icon needs 6 (RGBA)`);
}

await mkdir(join(ROOT, dirname(TO)), { recursive: true });
await writeFile(join(ROOT, TO), png);

console.log(`${TO}: ${width}x${height}, RGBA, ${(png.length / 1024).toFixed(1)} KB`);
