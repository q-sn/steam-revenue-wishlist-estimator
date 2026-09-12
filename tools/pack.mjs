#!/usr/bin/env node
/**
 * Builds the store uploads, and refuses to build when something in the tree
 * would be rejected at upload — a version the manifest and package.json
 * disagree about, a file the manifest names but does not ship, a `key` left
 * over from a local install. The dashboard reports those hours after you have
 * closed the laptop; this reports them now.
 *
 *   node tools/pack.mjs                # Chrome Web Store
 *   node tools/pack.mjs --firefox      # addons.mozilla.org
 *   node tools/pack.mjs --opera        # addons.opera.com
 *   node tools/pack.mjs --source       # the source archive AMO asks for
 *   node tools/pack.mjs --all          # all four
 *
 * The tree is Chrome-shaped, because that is where the extension is first
 * published: manifest.json is the file Chrome loads unmodified out of a
 * checkout, and the Chrome package ships those bytes untouched. The other two
 * targets are the same manifest with the smallest edit their store needs,
 * applied here rather than kept as a second file on disk — three manifests in
 * a repository are three manifests that drift.
 *
 * What --firefox changes, and why each one:
 *
 *   background   Firefox has no extension service workers (Firefox bug
 *                1573659) and runs an event page instead. Same file, different
 *                key, and `type: "module"` because the worker's imports are
 *                static — Firefox has read that key since 112.
 *   gecko.id     AMO will not publish an add-on without one, and it is
 *                permanent once it has: the first accepted upload binds this
 *                string to the listing for good.
 *   data_collection_permissions
 *                every extension submitted to AMO after 3 November 2025 must
 *                declare what it collects through Firefox's built-in consent.
 *                This one collects nothing, which is the literal `["none"]`.
 *                Only Firefox 140 and later reads the key, which is what pins
 *                strict_min_version — 140 is also the current ESR, so the
 *                floor costs no supported user.
 *   homepage_url the manifest's own link is the Chrome Web Store item, and a
 *                link to one store is the wrong front door for a listing in
 *                another. The Firefox package points at its own AMO listing;
 *                Opera, which has none yet, points at the source.
 *
 * Opera runs Chromium and takes the Chrome manifest as it is; only the
 * homepage moves. Its store refused Manifest V3 uploads until June 2026, so
 * the first upload there is worth watching rather than trusting.
 *
 * Four things ship: manifest.json, icons/, _locales/ and src/. Not `data/` —
 * those files are fetched from the CDN at runtime, and a snapshot inside the
 * package would be stale the day after it uploaded. Not tools/, test/, docs/
 * or .github/, which are how the numbers are checked and not how they are
 * shown.
 *
 * `_locales/` is regenerated first rather than trusted, because a package can
 * otherwise ship translations the master table has already moved past.
 *
 * The archive is written here instead of shelling out to `zip` or
 * `Compress-Archive`: neither exists on every platform this repo gets
 * developed on, and a project that promises no dependencies cannot install one
 * to put four folders in a file. manifest.json lands at the archive root —
 * nested one folder deep is the classic rejected upload.
 */

import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

const PAYLOAD = ['manifest.json', 'icons', '_locales', 'src'];

/**
 * What `--source` ships: the repository, minus what is generated or ignored.
 *
 * AMO asks for source whenever a tool "takes files, applies pre-processing,
 * and generates file(s) to include in the extension", and
 * tools/build-locales.mjs does exactly that for `_locales/`. The generated
 * files are plain translation strings a reviewer can read either way, but the
 * question on the submission form is about the process, not the output, so the
 * honest answer is yes and this is the archive that answers it.
 *
 * Not `dist/`, which is this script's own output, and not `data/`, which is
 * built by CI and fetched at runtime.
 */
const SOURCE = [
  'manifest.json', 'package.json', 'README.md', 'CONTRIBUTING.md', 'PRIVACY.md', 'LICENSE',
  'icons', '_locales', 'src', 'tools', 'test', 'docs', 'screenshots', '.github', '.gitignore'
];

/** Where a listing with no store page of its own should send a reader. */
const SOURCE_URL = 'https://github.com/q-sn/steam-revenue-wishlist-estimator';
/** The Firefox listing, live since September 2026. */
const AMO_URL = 'https://addons.mozilla.org/en-US/firefox/addon/wishlytic/';

/**
 * One entry per store. `manifest` is the edit that store needs, or null to
 * ship the file's own bytes — which is what keeps two Chrome packs of the same
 * tree byte-identical rather than merely equivalent.
 */
const TARGETS = {
  chrome: {
    store: 'Chrome Web Store',
    suffix: '',
    edits: [],
    manifest: null
  },
  firefox: {
    store: 'addons.mozilla.org',
    suffix: '-firefox',
    edits: ['background.scripts (event page)', 'browser_specific_settings.gecko', 'homepage_url'],
    manifest: (m) => ({
      ...m,
      homepage_url: AMO_URL,
      background: { scripts: [m.background.service_worker], type: 'module' },
      browser_specific_settings: {
        gecko: {
          id: 'wishlytic@q-sn.github.io',
          strict_min_version: '140.0',
          data_collection_permissions: { required: ['none'] }
        },
        // Android got the consent key two releases later than desktop, and a
        // floor of 140 on both is what the AMO linter warns about: a build
        // that says 140 would install on an Android Firefox that cannot read
        // the declaration it is installing under.
        gecko_android: { strict_min_version: '142.0' }
      }
    })
  },
  opera: {
    store: 'addons.opera.com',
    suffix: '-opera',
    edits: ['homepage_url'],
    manifest: (m) => ({ ...m, homepage_url: SOURCE_URL })
  }
};

// Fixed 1980-01-01, so two packs of the same tree are byte-identical and a
// re-upload that changed nothing is visibly the same file.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

const CRC_TABLE = new Int32Array(256);
for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c;
}

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Minimal deflate-or-store zip. No directory entries: Chrome infers them. */
function zip(entries) {
  const local = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const deflated = deflateRawSync(data, { level: 9 });
    const stored = deflated.length >= data.length;
    const body = stored ? data : deflated;
    const method = stored ? 0 : 8;
    const crc = crc32(data);

    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(0, 6);
    head.writeUInt16LE(method, 8);
    head.writeUInt16LE(DOS_TIME, 10);
    head.writeUInt16LE(DOS_DATE, 12);
    head.writeUInt32LE(crc, 14);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(nameBuf.length, 26);
    head.writeUInt16LE(0, 28);
    local.push(head, nameBuf, body);

    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(body.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuf.length, 28);
    entry.writeUInt32LE(0, 30);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuf);

    offset += head.length + nameBuf.length + body.length;
  }

  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, dir, end]);
}

async function walk(rel) {
  const info = await stat(join(ROOT, rel));
  if (info.isFile()) return [rel];
  const names = (await readdir(join(ROOT, rel))).sort();
  const nested = await Promise.all(names.map((n) => walk(`${rel}/${n}`)));
  return nested.flat();
}

/** Everything the manifest points at by name, minus the glob patterns. */
function referencedFiles(manifest) {
  const out = new Set();
  for (const icons of [manifest.icons, manifest.action?.default_icon]) {
    for (const path of Object.values(icons ?? {})) out.add(path);
  }
  // A service worker under Chrome, an event page under Firefox, one file
  // either way — and both keys are read, because the package that dropped one
  // of them is exactly where a rename that missed the other would hide.
  if (manifest.background?.service_worker) out.add(manifest.background.service_worker);
  for (const script of manifest.background?.scripts ?? []) out.add(script);
  if (manifest.options_ui?.page) out.add(manifest.options_ui.page);
  for (const script of manifest.content_scripts ?? []) {
    for (const js of script.js ?? []) out.add(js);
    for (const css of script.css ?? []) out.add(css);
  }
  return [...out];
}

/**
 * The archive AMO asks for alongside a Firefox upload, with the two commands
 * that turn it back into the uploaded package written into it. A source
 * package a reviewer cannot build is the same as no source package.
 */
async function packSource(version) {
  const files = (await Promise.all(SOURCE.map(walk))).flat();
  const entries = await Promise.all(
    files.map(async (name) => ({ name, data: await readFile(join(ROOT, name)) }))
  );
  entries.unshift({ name: 'BUILD.md', data: Buffer.from(BUILD_NOTE, 'utf8') });

  const out = `dist/wishlytic-${version}-source.zip`;
  const archive = zip(entries);
  await writeFile(join(ROOT, out), archive);
  return { out, entries, archive };
}

const BUILD_NOTE = `# Building this extension

No bundler, no minifier, no transpiler, and no dependencies: every \`.js\` file
in the uploaded package is the file in \`src/\` unchanged. Node 18 or newer is
the only requirement, and nothing is installed.

    node tools/build-locales.mjs      # regenerates _locales/ from tools/locales.source.json
    node tools/pack.mjs --firefox     # writes dist/wishlytic-<version>-firefox.zip

The second command runs the first, so it is enough on its own. Its output is
the uploaded file.

## The one generated thing

\`_locales/<lang>/messages.json\` is written by \`tools/build-locales.mjs\` from
the single master table \`tools/locales.source.json\`. It is a reshaping of
translation strings — no code is generated, and the script's other job is
validation: it refuses to write when a locale is missing a key or when a
translation has dropped a \`$1\` placeholder.

## How the Firefox package differs from the Chrome one

Three keys in \`manifest.json\`, applied at pack time and listed at the top of
\`tools/pack.mjs\`: \`background.scripts\` with \`type: "module"\` in place of
Chrome's \`service_worker\`, \`browser_specific_settings.gecko\`, and a
\`homepage_url\` that points at the repository rather than the Chrome listing.
Everything else in the package is byte-identical between the two.

Source: https://github.com/q-sn/steam-revenue-wishlist-estimator
`;

/** Which stores were asked for. No flag means the one this is published in. */
function chosenTargets(argv) {
  const known = [...Object.keys(TARGETS), 'source'];
  const unknown = argv.filter((a) => a !== '--all' && !known.includes(a.replace(/^--/, '')));
  if (unknown.length) {
    console.error(`\n  unknown option: ${unknown.join(' ')}`);
    console.error(`  usage: node tools/pack.mjs `
      + `[${known.map((n) => `--${n}`).join(' | ')} | --all]\n`);
    process.exit(1);
  }
  if (argv.includes('--all')) return { stores: Object.keys(TARGETS), source: true };
  const stores = Object.keys(TARGETS).filter((n) => argv.includes(`--${n}`));
  const source = argv.includes('--source');
  // `--source` on its own means the source archive and nothing else; no flag
  // at all means the store this is published in.
  return { stores: stores.length || source ? stores : ['chrome'], source };
}

async function main() {
  const { stores: targets, source } = chosenTargets(process.argv.slice(2));

  execFileSync(process.execPath, [join(HERE, 'build-locales.mjs')], { stdio: 'inherit' });

  const rawManifest = await readFile(join(ROOT, 'manifest.json'));
  const base = JSON.parse(rawManifest.toString('utf8'));
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const problems = [];

  // The manifest carries the version that ships, so it is the one that
  // decides; package.json agreeing is a check, not a second source.
  if (base.version !== pkg.version) {
    problems.push(`version: manifest says ${base.version}, package.json says ${pkg.version}`);
  }
  if (!/^\d{1,5}(\.\d{1,5}){0,3}$/.test(base.version)
      || base.version.split('.').some((n) => Number(n) > 65535)) {
    problems.push(`version: "${base.version}" is not 1-4 dot-separated integers under 65536`);
  }
  for (const field of ['key', 'update_url']) {
    if (field in base) problems.push(`manifest: remove "${field}" before uploading`);
  }

  const files = (await Promise.all(PAYLOAD.map(walk))).flat();
  const present = new Set(files);
  if (base.default_locale && !present.has(`_locales/${base.default_locale}/messages.json`)) {
    problems.push(`default_locale is "${base.default_locale}" with no _locales entry to match`);
  }

  // Every asked-for manifest is checked, not only the one on disk: a rename
  // that breaks two packages should not be reported by one of them.
  const built = targets.map((name) => {
    const target = TARGETS[name];
    const manifest = target.manifest ? target.manifest(base) : base;
    for (const path of referencedFiles(manifest)) {
      if (!present.has(path)) {
        problems.push(`${name}: manifest names ${path}, which the package does not ship`);
      }
    }
    const data = target.manifest
      ? Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
      : rawManifest;
    return { name, target, data };
  });

  if (problems.length) {
    console.error(`\n  ${problems.length} problem(s) blocking the package\n`);
    for (const p of problems) console.error(`   ✗ ${p}`);
    console.error('');
    process.exit(1);
  }

  // Everything but the manifest is the same bytes in every package, so it is
  // read once and zipped three times.
  const payload = await Promise.all(
    files
      .filter((name) => name !== 'manifest.json')
      .map(async (name) => ({ name, data: await readFile(join(ROOT, name)) }))
  );

  await mkdir(join(ROOT, 'dist'), { recursive: true });
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;

  for (const { target, data } of built) {
    const entries = [{ name: 'manifest.json', data }, ...payload];
    const archive = zip(entries);
    const out = `dist/wishlytic-${base.version}${target.suffix}.zip`;
    await writeFile(join(ROOT, out), archive);

    const raw = entries.reduce((sum, e) => sum + e.data.length, 0);
    console.log(`  ${out}  ->  ${target.store}`);
    console.log(`  ${entries.length} files, ${kb(raw)} -> ${kb(archive.length)}`);
    if (target.edits.length) console.log(`  manifest: ${target.edits.join(', ')}`);
    console.log('');
  }

  if (source) {
    const { out, entries, archive } = await packSource(base.version);
    const raw = entries.reduce((sum, e) => sum + e.data.length, 0);
    console.log(`  ${out}  ->  the source AMO asks for, with BUILD.md in it`);
    console.log(`  ${entries.length} files, ${kb(raw)} -> ${kb(archive.length)}\n`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
