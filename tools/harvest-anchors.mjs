#!/usr/bin/env node
/**
 * Collects wishlist numbers developers announce on their own store pages.
 *
 * Reads each ranked app's announcements from ISteamNews, which needs no key,
 * and records milestone posts — "100,000 Wishlists - Thank You!" — against the
 * position the game held that day.
 *
 *   node tools/harvest-anchors.mjs
 *   node tools/harvest-anchors.mjs --max-apps 300
 *   node tools/harvest-anchors.mjs --ranks data/wishlist-ranks.json
 *   node tools/harvest-anchors.mjs --deadline 75
 *
 * Rows are appended to data/wishlist-anchors.ndjson as they are found, one
 * JSON object a line, deduplicated on app + announcement. Running daily is
 * what produces same-day pairs: a disclosure is only a usable anchor when the
 * rank was read near the day it was made.
 *
 *   --deadline <min>     stop cleanly and exit 0 when the budget runs out
 *   --max-refusals <n>   abort when this many apps in a row are refused
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ANY_FIGURE, MILESTONE, clean, isAspirational, parseCount, rejectQuote } from './anchor-quote.mjs';

const argv = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const at = argv.indexOf(flag);
  return at === -1 ? fallback : argv[at + 1] ?? fallback;
};

const RANKS = valueOf('--ranks', 'data/wishlist-ranks.json');
const OUT = valueOf('--out', 'data/wishlist-anchors.ndjson');
const MAX_APPS = Number(valueOf('--max-apps', Infinity));
const DELAY_MS = Number(valueOf('--delay', 180));
const NEWS_ITEMS = Number(valueOf('--news-items', 50));
const DEADLINE_MIN = Number(valueOf('--deadline', Infinity));
const MAX_REFUSALS = Number(valueOf('--max-refusals', 25));
const MAX_ATTEMPTS = 4;
const MAX_BACKOFF_MS = 60_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (ms) => Math.round(ms * (0.75 + Math.random() * 0.5));

/** Whether a figure is a round milestone, which most of them are. */
function isRound(value) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return value % magnitude === 0 || value % (magnitude / 2) === 0;
}

export function milestonesIn(item) {
  const title = clean(item.title);
  const text = clean(`${item.title} . ${item.contents}`);
  // Where the headline ends in the joined text: " . " is three characters.
  const titleEnds = title ? title.length + 3 : 0;
  const out = [];
  /** Figures the body called a goal. The headline runs first, so this is applied after. */
  const wanted = new Set();

  for (const match of text.matchAll(MILESTONE)) {
    const value = parseCount(match[1]);
    // Below a thousand this is almost always a demo player count or a
    // giveaway, and above ten million nobody has been.
    if (value == null || value < 1_000 || value > 10_000_000) continue;

    const end = match.index + match[0].length;
    const opts = { inTitle: match.index < titleEnds, raw: match[1], value };
    const why = rejectQuote(text.slice(Math.max(0, match.index - 60), match.index), text.slice(end, end + 90), text, opts);
    if (why) {
      // A headline states the figure without a verb, so it is read as a claim.
      // "Community Quest: 250k Wishlists" is a headline too, and its body says
      // "we've set a huge community goal of 250,000 Wishlists". Remember which
      // figures the body called a goal, so the headline cannot resurrect them.
      if (!opts.inTitle && /^(?:goal|not-yet-reached|reward-tier)$/.test(why)) wanted.add(value);
      continue;
    }

    // A retrospective: "we hit 10,000 wishlists (18,000 now)". The larger
    // figure is today's, and this one describes the past \u2014 unless the larger
    // one is the studio looking ahead, which is how "200,000 Wishlists -
    // Thank You!" was lost to "we cannot wait to celebrate 300k wishlists".
    const larger = [...text.matchAll(ANY_FIGURE)].some((m) => {
      const other = parseCount(m[1]);
      if (other == null || other <= value) return false;
      return !isAspirational(text.slice(Math.max(0, m.index - 60), m.index));
    });
    if (larger) continue;

    out.push({
      wishlists: value,
      round: isRound(value),
      inTitle: opts.inTitle,
      // Wide enough to hold both windows the decision was made on: 60 before
      // and 90 after the word. A quote cut at match.index + 90 kept less trail
      // than rejectQuote had read, so the condenser re-judged four rows on
      // less evidence than the harvester and dropped them.
      quoted: text.slice(Math.max(0, match.index - 90), end + 95).trim()
    });
  }

  // One figure per post. A milestone announcement repeats its own number in
  // the title and the body, and celebrating two at once ("100k wishlists and
  // 50k followers") is a different number wearing the same words.
  const kept = out.filter((m) => !(m.inTitle && wanted.has(m.wishlists)));
  // A milestone post states its number twice, and the two windows are not
  // equally good. Keep the headline one: it is the cleanest sentence, and it
  // is the occurrence whose `inTitle` the condenser will need when it re-reads
  // the quote — storing the body copy made the condenser drop rows the
  // harvester had just accepted.
  const byValue = new Map();
  for (const m of kept) {
    const seen = byValue.get(m.wishlists);
    if (!seen || (m.inTitle && !seen.inTitle)) byValue.set(m.wishlists, m);
  }
  return byValue.size === 1 ? [...byValue.values()] : [];
}

/** How many 429s the run has seen. Reported at the end. */
let rateLimited = 0;

/** `Retry-After` in ms — seconds or an HTTP date — or null if absent. */
function retryAfterMs(res) {
  const raw = res.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, MAX_BACKOFF_MS);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.min(Math.max(at - Date.now(), 0), MAX_BACKOFF_MS) : null;
}

/**
 * A game's announcements: an array on success, null when every attempt was
 * refused. 429 backs off exponentially with jitter, or by `Retry-After`.
 *
 * An empty array is returned as-is and is not trusted: Steam soft-throttles
 * with HTTP 200 and no items, which is indistinguishable from a game that has
 * never posted. main() re-checks empty apps in a second pass.
 */
async function newsFor(appid) {
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}`
    + `&count=${NEWS_ITEMS}&maxlength=8000`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let wait = DELAY_MS * attempt * 3;
    try {
      const res = await fetch(url);
      if (res.status === 429) {
        rateLimited++;
        wait = retryAfterMs(res) ?? jitter(Math.min(1_000 * 2 ** attempt, MAX_BACKOFF_MS));
      } else if (res.ok) {
        const json = await res.json();
        const items = json?.appnews?.newsitems;
        if (Array.isArray(items)) return { items };
      } else {
        wait = jitter(wait);
      }
    } catch { /* network flake, handled as a refusal */ }
    if (attempt < MAX_ATTEMPTS) await sleep(wait);
  }
  return { items: null };
}

async function existingKeys(path) {
  if (!existsSync(path)) return new Set();
  const text = await readFile(path, 'utf8');
  const keys = new Set();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      keys.add(`${row.appid}:${row.announcedAt}:${row.wishlists}`);
    } catch { /* a half-written line from a killed run */ }
  }
  return keys;
}

async function main() {
  const ranks = JSON.parse(await readFile(resolve(RANKS), 'utf8'));
  const rankOf = new Map(ranks.appids.map((id, i) => [id, i + 1]));
  const rankAt = new Date(ranks.generatedAt).toISOString().slice(0, 10);

  const out = resolve(OUT);
  await mkdir(dirname(out), { recursive: true });
  const seen = await existingKeys(out);

  const apps = ranks.appids.slice(0, Number.isFinite(MAX_APPS) ? MAX_APPS : undefined)
    .filter(Boolean);

  const startedAt = Date.now();
  const deadlineAt = Number.isFinite(DEADLINE_MIN) ? startedAt + DEADLINE_MIN * 60_000 : Infinity;
  const outOfTime = () => Date.now() >= deadlineAt;
  const minutesIn = () => ((Date.now() - startedAt) / 60_000).toFixed(1);

  let found = 0;
  let sameDay = 0;
  let scanned = 0;
  let refused = 0;
  let inARow = 0;
  let stopped = null;
  const emptyApps = [];

  /** Extracts one app's anchors and appends them straight away. */
  const record = async (appid, items) => {
    const rows = [];
    for (const item of items) {
      const announcedAt = new Date(item.date * 1000).toISOString().slice(0, 10);
      for (const hit of milestonesIn(item)) {
        const key = `${appid}:${announcedAt}:${hit.wishlists}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          appid,
          // Today's position, recorded for reference. The model re-attaches
          // ranks by appid against one snapshot rather than trusting this.
          rank: rankOf.get(appid) ?? null,
          rankAt,
          announcedAt,
          wishlists: hit.wishlists,
          round: hit.round,
          // The condenser re-reads the stored quote, which is a window rather
          // than a post, so it cannot see that the figure was the headline.
          inTitle: hit.inTitle,
          listed: ranks.listed,
          upcoming: ranks.upcoming,
          url: item.url ?? null,
          quoted: hit.quoted.slice(0, 240)
        });
      }
    }
    if (!rows.length) return;
    // Appended per app, so a timeout kill costs the rest of the scan and not
    // the part already done.
    await writeFile(out, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', { flag: 'a' });
    found += rows.length;
    sameDay += rows.filter((r) => r.announcedAt === rankAt).length;
  };

  for (const appid of apps) {
    if (outOfTime()) { stopped = 'deadline'; break; }
    scanned++;
    const { items } = await newsFor(appid);

    if (items == null) {
      refused++;
      if (++inARow >= MAX_REFUSALS) { stopped = 'refusals'; break; }
      await sleep(DELAY_MS);
      continue;
    }
    inARow = 0;
    if (items.length) await record(appid, items);
    else emptyApps.push(appid);

    if (scanned % 250 === 0) {
      process.stderr.write(`  ${scanned}/${apps.length} scanned, ${found} new`
        + `${refused ? `, ${refused} refused` : ''}, ${minutesIn()} min\n`);
    }
    await sleep(DELAY_MS);
  }

  // Second pass over the apps that answered with no announcements. The gap is
  // the length of the scan, which is long enough to have left any throttle
  // window: an app still empty here has genuinely never posted.
  let silent = 0;
  let recovered = 0;
  let rechecked = 0;
  if (stopped !== 'refusals') {
    for (const appid of emptyApps) {
      if (outOfTime()) { stopped ??= 'deadline'; break; }
      rechecked++;
      const { items } = await newsFor(appid);
      if (items == null) refused++;
      else if (items.length) { recovered++; await record(appid, items); }
      else silent++;
      await sleep(DELAY_MS);
    }
  }

  process.stderr.write(
    `${scanned} of ${apps.length} games scanned in ${minutesIn()} min, ${found} new disclosures, `
    + `${sameDay} of them announced today (those pair cleanly with a rank) -> ${OUT}\n`
  );

  if (emptyApps.length) {
    process.stderr.write(
      `${emptyApps.length} games answered with no announcements; ${rechecked} rechecked, `
      + `${silent} still silent, ${recovered} answered the second time`
      + `${recovered ? ' (the first read was throttled)' : ''}\n`
    );
  }

  if (stopped === 'deadline') {
    process.stderr.write(
      `deadline of ${DEADLINE_MIN} min reached: reached app ${scanned} of ${apps.length}, `
      + `${apps.length - scanned} skipped, ${emptyApps.length - rechecked} left unrechecked. `
      + `Everything found is already on disk; tomorrow's run continues.\n`
    );
  }

  // A refused game contributes nothing, which is exactly what a game with no
  // announcements contributes, so this has to be said out loud.
  if (refused) {
    const share = (refused / Math.max(scanned, 1)) * 100;
    process.stderr.write(
      `${refused} games (${share.toFixed(1)}%) never answered after ${MAX_ATTEMPTS} attempts`
      + `${rateLimited ? `, ${rateLimited} responses were 429` : ''}. `
      + `${share > 5 ? 'That is a throttled run: raise --delay and repeat it.' : 'Small enough to be ordinary failures.'}\n`
    );
  }

  if (stopped === 'refusals') {
    process.stderr.write(
      `ABORTED: ${MAX_REFUSALS} refusals in a row at app ${scanned} of ${apps.length}. `
      + `Steam is refusing this run rather than throttling it; the ${found} disclosures `
      + `found before that are on disk.\n`
    );
    process.exitCode = 1;
  }
}

// Importing this module must not start a crawl; the tests read milestonesIn.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
  console.error(String(err.message ?? err));
  process.exit(1);
  });
}
