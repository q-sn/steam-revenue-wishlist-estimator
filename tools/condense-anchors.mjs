#!/usr/bin/env node
/**
 * The anchor archive cut to the bytes an extension needs: one figure per game.
 *
 * data/wishlist-anchors.ndjson keeps every disclosure ever found together with
 * the sentence it came from. This writes the few bytes per game the extension
 * reads: what the studio said, and when.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { rejectStoredQuote } from './anchor-quote.mjs';

const argv = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : argv[at + 1] ?? fallback;
};

const ANCHORS = valueOf('--anchors', 'data/wishlist-anchors.ndjson');
const OUT = valueOf('--out', 'data/wishlist-said.json');

/** First 120 characters of the collapsed quote, for spotting cross-posts. */
const fingerprint = (quoted) => String(quoted ?? '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, 120);

async function main() {
  const path = resolve(ANCHORS);
  if (!existsSync(path)) {
    process.stderr.write(`no archive at ${ANCHORS}; nothing to condense\n`);
    process.exit(1);
  }

  const rows = [];
  for (const line of (await readFile(path, 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    try { rows.push(JSON.parse(line)); } catch { /* half-written line */ }
  }

  // A studio publishing one post to several app hubs makes the same figure look
  // like evidence about every game it landed on. Which game it is about cannot
  // be recovered, so none of the copies is usable.
  const appsPerQuote = new Map();
  for (const r of rows) {
    const key = fingerprint(r.quoted);
    if (!key) continue;
    if (!appsPerQuote.has(key)) appsPerQuote.set(key, new Set());
    appsPerQuote.get(key).add(r.appid);
  }
  let crossPosted = 0;
  const rejected = new Map();

  // Largest figure per game, tie-broken to the most recent, which is what the
  // model in src/core/constants.js is fitted on. A wishlist balance does not
  // fall before release, so a later smaller figure is the weaker reading.
  const best = new Map();
  for (const r of rows) {
    if (!Number.isFinite(r.appid) || r.appid <= 0) continue;
    if (!Number.isFinite(r.wishlists) || r.wishlists <= 0) continue;
    if (typeof r.announcedAt !== 'string' || !r.announcedAt) continue;
    if ((appsPerQuote.get(fingerprint(r.quoted))?.size ?? 1) > 1) { crossPosted++; continue; }

    // The archive is raw and append-only, so a rule fixed after a row landed
    // has to be applied here rather than by rewriting history.
    const why = rejectStoredQuote(r.quoted, r.wishlists, { inTitle: r.inTitle === true });
    if (why) { rejected.set(why, (rejected.get(why) ?? 0) + 1); continue; }

    const seen = best.get(r.appid);
    const better = !seen
      || r.wishlists > seen.wishlists
      || (r.wishlists === seen.wishlists && r.announcedAt > seen.announcedAt);
    if (better) best.set(r.appid, r);
  }

  if (!best.size) {
    process.stderr.write('archive parsed but held no usable disclosure; refusing to write an empty file\n');
    process.exit(1);
  }

  const said = {};
  for (const [appid, r] of [...best.entries()].sort((a, b) => a[0] - b[0])) {
    said[appid] = [r.wishlists, r.announcedAt];
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/',
    fields: ['wishlists', 'announcedAt'],
    games: Object.keys(said).length,
    said
  };

  const out = resolve(OUT);
  await mkdir(dirname(out), { recursive: true });
  const text = JSON.stringify(payload);
  await writeFile(out, text);

  process.stderr.write(
    `${rows.length} disclosures -> ${payload.games} games, ${(text.length / 1024).toFixed(1)} KB -> ${OUT}`
    + (crossPosted ? `, ${crossPosted} cross-posted` : '')
    + [...rejected].map(([w, n]) => `, ${n} ${w}`).join('')
    + '\n'
  );
}

main().catch((err) => {
  console.error(String(err.message ?? err));
  process.exit(1);
});
