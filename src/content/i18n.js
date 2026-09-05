/**
 * Message resolution.
 *
 * The core returns descriptors like { key, params, text } rather than finished
 * sentences, so the same estimator can serve twelve languages and still be
 * readable in Node, where chrome.i18n does not exist. This module is the only
 * place that turns a descriptor into words.
 *
 * chrome.i18n is locked to the browser UI language and cannot be redirected at
 * runtime, so an explicit language choice is served by loading that locale's
 * table ourselves and substituting positionally, exactly as Chrome would.
 */

const hasChromeI18n = typeof chrome !== 'undefined' && chrome.i18n?.getMessage;

/** Locales shipped in _locales/, labelled in their own language. */
export const LOCALES = [
  { tag: 'auto', endonym: null },
  { tag: 'en', endonym: 'English' },
  { tag: 'ru', endonym: 'Русский' },
  { tag: 'zh_CN', endonym: '简体中文' },
  { tag: 'es', endonym: 'Español' },
  { tag: 'pt_BR', endonym: 'Português (BR)' },
  { tag: 'de', endonym: 'Deutsch' },
  { tag: 'fr', endonym: 'Français' },
  { tag: 'ja', endonym: '日本語' },
  { tag: 'ko', endonym: '한국어' },
  { tag: 'tr', endonym: 'Türkçe' },
  { tag: 'pl', endonym: 'Polski' },
  { tag: 'it', endonym: 'Italiano' }
];

/** Loaded table when the user picked a language other than the browser's. */
let overrideTable = null;
let activeTag = null;

const norm = (tag) => String(tag ?? '').replace('-', '_').toLowerCase();

function substitute(message, params) {
  return params.reduce(
    (out, value, i) => out.replaceAll(`$${i + 1}`, String(value)),
    message
  );
}

/**
 * Choose the language. Pass 'auto' or nothing to follow the browser.
 * Resolves once the table is ready, so callers can render synchronously after.
 */
export async function initLocale(tag) {
  overrideTable = null;
  activeTag = null;

  if (!tag || tag === 'auto' || !hasChromeI18n) return uiLanguage();
  if (norm(tag) === norm(chrome.i18n.getUILanguage())) return tag;

  try {
    const res = await fetch(chrome.runtime.getURL(`_locales/${tag}/messages.json`));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    overrideTable = await res.json();
    activeTag = tag;
  } catch (err) {
    // A missing table must not blank the interface; fall back to the browser
    // language rather than rendering bare keys.
    console.warn('[srwe] locale', tag, 'unavailable, using browser language:', err);
  }
  return activeTag ?? uiLanguage();
}

/** Resolve a raw key with positional substitutions. */
export function t(key, params = []) {
  if (overrideTable) {
    const entry = overrideTable[key];
    if (entry?.message) return substitute(entry.message, params);
  }
  if (!hasChromeI18n) return key;
  return chrome.i18n.getMessage(key, params.map(String)) || key;
}

/**
 * Resolve a descriptor from the core, falling back to the English wording it
 * carries. A missing translation should degrade to a real sentence, never to
 * a bare key staring at the user.
 */
export function tr(descriptor) {
  if (descriptor == null) return '';
  if (typeof descriptor === 'string') return t(descriptor);
  const { key, params = [], text } = descriptor;
  const resolved = t(key, params);
  return resolved === key ? (text ?? key) : resolved;
}

/** Locale-aware relative time, used by the trend caption. */
export function humanise(ms) {
  const days = Math.floor(ms / 86_400_000);
  if (days === 1) return t('tYesterday');
  if (days > 1) return t('tDaysAgo', [days]);
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 1) return t('tHoursAgo', [hours]);
  return t('tJustNow');
}

/** The language actually in effect, for number formatting and <html lang>. */
export function uiLanguage() {
  if (activeTag) return activeTag.replace('_', '-');
  return hasChromeI18n ? chrome.i18n.getUILanguage() : 'en';
}
