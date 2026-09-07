#!/usr/bin/env node
/**
 * Generates _locales/<lang>/messages.json from the single master table in
 * tools/locales.source.json.
 *
 * One table beats twelve files: a contributor adding a string edits one place,
 * and the validation below catches the two mistakes that actually happen —
 * a locale silently missing a key, and a translation that dropped a $1
 * placeholder so the number never appears.
 *
 *   node tools/build-locales.mjs
 *   node tools/build-locales.mjs --check   # validate without writing
 */

import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const CHECK_ONLY = process.argv.includes('--check');

const placeholdersIn = (s) => (s.match(/\$\d/g) ?? []).sort().join(',');

// Chrome caps the two strings that leave the manifest for the store listing,
// and rejects the upload in whichever locale happens to be over. Twelve
// translations of one sentence do not come out the same length, so the cap is
// checked here rather than discovered at submission.
const STORE_LIMITS = { extName: 75, extDesc: 132 };

async function main() {
  const src = JSON.parse(await readFile(join(HERE, 'locales.source.json'), 'utf8'));
  const locales = src._locales;
  const keys = Object.keys(src).filter((k) => !k.startsWith('_'));

  const problems = [];

  for (const key of keys) {
    const entry = src[key];
    const reference = placeholdersIn(entry.en ?? '');

    for (const locale of locales) {
      const value = entry[locale];
      if (typeof value !== 'string' || !value.trim()) {
        problems.push(`${key}: missing translation for ${locale}`);
        continue;
      }
      const found = placeholdersIn(value);
      if (found !== reference) {
        problems.push(
          `${key} [${locale}]: placeholders are "${found || 'none'}" but English has "${reference || 'none'}"`
        );
      }
      const limit = STORE_LIMITS[key];
      if (limit && value.length > limit) {
        problems.push(`${key} [${locale}]: ${value.length} characters, Chrome allows ${limit}`);
      }
      // A lone $ that is not a placeholder would be swallowed by Chrome.
      if (/\$(?!\d|\$)/.test(value)) {
        problems.push(`${key} [${locale}]: contains an unescaped "$"`);
      }
      // **emphasis** must come in pairs, or the asterisks reach the reader.
      const stars = (value.match(/\*\*/g) ?? []).length;
      if (stars % 2 !== 0) {
        problems.push(`${key} [${locale}]: unbalanced ** emphasis marker`);
      }
      if (stars > 0 && !String(src[key].en).includes('**')) {
        problems.push(`${key} [${locale}]: emphasis marker not present in the English source`);
      }
    }
  }

  if (problems.length) {
    console.error(`\n  ${problems.length} problem(s) in locales.source.json\n`);
    for (const p of problems) console.error(`   \u2717 ${p}`);
    console.error('');
    process.exit(1);
  }

  console.log(`\n  ${keys.length} keys \u00d7 ${locales.length} locales validated`);

  if (CHECK_ONLY) {
    console.log('  Check only, nothing written.\n');
    return;
  }

  await rm(join(ROOT, '_locales'), { recursive: true, force: true });

  for (const locale of locales) {
    const messages = {};
    for (const key of keys) {
      messages[key] = { message: src[key][locale] };
      const desc = src[key]._desc;
      if (desc) messages[key].description = desc;
    }
    const dir = join(ROOT, '_locales', locale);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'messages.json'), JSON.stringify(messages, null, 2) + '\n', 'utf8');
  }

  console.log(`  Wrote _locales/ for: ${locales.join(', ')}\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
