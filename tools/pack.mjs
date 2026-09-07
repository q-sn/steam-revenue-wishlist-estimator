#!/usr/bin/env node
/**
 * Builds the Chrome Web Store upload, and refuses to build when something in
 * the tree would be rejected at upload — a version the manifest and
 * package.json disagree about, a file the manifest names but does not ship, a
 * `key` left over from a local install. The dashboard reports those hours
 * after you have closed the laptop; this reports them now.
 *
 *   node tools/pack.mjs
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
  if (manifest.background?.service_worker) out.add(manifest.background.service_worker);
  if (manifest.options_ui?.page) out.add(manifest.options_ui.page);
  for (const script of manifest.content_scripts ?? []) {
    for (const js of script.js ?? []) out.add(js);
    for (const css of script.css ?? []) out.add(css);
  }
  return [...out];
}

async function main() {
  execFileSync(process.execPath, [join(HERE, 'build-locales.mjs')], { stdio: 'inherit' });

  const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const problems = [];

  // The manifest carries the version that ships, so it is the one that
  // decides; package.json agreeing is a check, not a second source.
  if (manifest.version !== pkg.version) {
    problems.push(`version: manifest says ${manifest.version}, package.json says ${pkg.version}`);
  }
  if (!/^\d{1,5}(\.\d{1,5}){0,3}$/.test(manifest.version)
      || manifest.version.split('.').some((n) => Number(n) > 65535)) {
    problems.push(`version: "${manifest.version}" is not 1-4 dot-separated integers under 65536`);
  }
  for (const field of ['key', 'update_url']) {
    if (field in manifest) problems.push(`manifest: remove "${field}" before uploading`);
  }

  const files = (await Promise.all(PAYLOAD.map(walk))).flat();
  const present = new Set(files);
  for (const path of referencedFiles(manifest)) {
    if (!present.has(path)) problems.push(`manifest names ${path}, which the package does not ship`);
  }
  if (manifest.default_locale && !present.has(`_locales/${manifest.default_locale}/messages.json`)) {
    problems.push(`default_locale is "${manifest.default_locale}" with no _locales entry to match`);
  }

  if (problems.length) {
    console.error(`\n  ${problems.length} problem(s) blocking the package\n`);
    for (const p of problems) console.error(`   ✗ ${p}`);
    console.error('');
    process.exit(1);
  }

  const entries = await Promise.all(
    files.map(async (name) => ({ name, data: await readFile(join(ROOT, name)) }))
  );
  const archive = zip(entries);

  await mkdir(join(ROOT, 'dist'), { recursive: true });
  const out = `dist/wishlytic-${manifest.version}.zip`;
  await writeFile(join(ROOT, out), archive);

  const raw = entries.reduce((sum, e) => sum + e.data.length, 0);
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`  ${out}`);
  console.log(`  ${entries.length} files, ${kb(raw)} → ${kb(archive.length)}\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
