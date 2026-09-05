#!/usr/bin/env node
/**
 * Unions two anchor archives on the dedupe key, in place.
 *
 * The publish step reads the data branch long after the restore step did, so
 * the branch copy can hold rows this run never saw. Copying one file over the
 * other loses whichever landed in between; merging keeps both.
 *
 *   node tools/merge-anchors.mjs --into publish/wishlist-anchors.ndjson \
 *     --from data/wishlist-anchors.ndjson
 *
 * Exits non-zero rather than writing fewer rows than --into already held.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const argv = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : argv[at + 1] ?? fallback;
};

const INTO = valueOf('--into', null);
const FROM = valueOf('--from', null);

const keyOf = (row) => `${row.appid}:${row.announcedAt}:${row.wishlists}`;

/** Rows of an NDJSON archive, keyed. A missing file reads as empty. */
async function load(path) {
  const rows = new Map();
  let lines = 0;
  if (!path || !existsSync(path)) return { rows, lines };

  for (const line of (await readFile(path, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    lines++;
    let row = null;
    try { row = JSON.parse(line); } catch { continue; } // half-written line from a killed run
    if (row && row.appid != null) rows.set(keyOf(row), line.trim());
  }
  return { rows, lines };
}

async function main() {
  if (!INTO || !FROM) throw new Error('need --into <path> and --from <path>');

  const target = await load(resolve(INTO));
  const source = await load(resolve(FROM));

  const merged = new Map(target.rows);
  let added = 0;
  for (const [key, line] of source.rows) {
    if (merged.has(key)) continue;
    merged.set(key, line);
    added++;
  }

  if (merged.size < target.rows.size) {
    throw new Error(`refusing to write ${merged.size} rows over the ${target.rows.size} already on the branch`);
  }

  await writeFile(resolve(INTO), merged.size ? [...merged.values()].join('\n') + '\n' : '');

  process.stderr.write(
    `${target.rows.size} rows on the branch + ${source.rows.size} from this run `
    + `= ${merged.size} (${added} new) -> ${INTO}\n`
  );
  const collapsed = target.lines - target.rows.size;
  if (collapsed > 0) {
    process.stderr.write(`${collapsed} duplicate keys on the branch collapsed\n`);
  }
}

main().catch((err) => {
  console.error(String(err.message ?? err));
  process.exit(1);
});
