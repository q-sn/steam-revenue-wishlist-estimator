import { REVENUE_DEFAULTS, REGIONAL_PROFILES, REGIONAL_ORDER } from '../core/constants.js';
import { PILL_ITEMS, PILL_DEFAULTS } from '../core/pill.js';
import { estimateRevenue } from '../core/revenue.js';
import { setLocale, pct } from '../core/format.js';
import { t, initLocale, uiLanguage, LOCALES } from '../content/i18n.js';

// Top-level await: the page must not paint English and then correct itself.
const boot = await chrome.storage.local.get(['settings', 'ui']);
await initLocale(boot.ui?.language ?? 'auto');
setLocale(uiLanguage());
document.documentElement.lang = uiLanguage();

const $ = (id) => document.getElementById(id);

/** Translate everything marked up in the HTML, so markup carries no English. */
for (const node of document.querySelectorAll('[data-i18n]')) {
  node.textContent = t(node.dataset.i18n);
}

const REGION_KEY = { 'us-eu': 'regionUsEu', mixed: 'regionMixed', emerging: 'regionEmerging' };
const POSITIONS = { 'pos-br': 'posBR', 'pos-bl': 'posBL', 'pos-tr': 'posTR', 'pos-tl': 'posTL' };
const UI_DEFAULTS = { position: 'pos-br', scale: 1.25, language: 'auto', pill: { ...PILL_DEFAULTS } };

const els = {
  avgDiscount: $('avgDiscount'), avgDiscountOut: $('avgDiscountOut'),
  regionalProfile: $('regionalProfile'),
  refundRate: $('refundRate'), refundRateOut: $('refundRateOut'),
  scale: $('scale'), scaleOut: $('scaleOut'),
  position: $('position'),
  language: $('language'),
  pillItems: $('pillItems'),
  sanity: document.querySelector('.sanity'),
  saved: $('saved')
};

/** Audience profile, with "read it from the reviews" first and as default. */
{
  const auto = document.createElement('option');
  auto.value = 'auto';
  auto.textContent = t('regionAuto');
  els.regionalProfile.append(auto);
}
for (const value of REGIONAL_ORDER) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = `${t(REGION_KEY[value])} (\u00d7${REGIONAL_PROFILES[value].factor})`;
  els.regionalProfile.append(opt);
}
for (const { tag, endonym } of LOCALES) {
  const opt = document.createElement('option');
  opt.value = tag;
  opt.textContent = endonym ?? t('langAuto');
  els.language.append(opt);
}

for (const item of PILL_ITEMS) {
  const label = document.createElement('label');
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.dataset.pillKey = item.key;
  label.append(box, document.createTextNode(t(item.optionKey)));
  els.pillItems.append(label);
}

for (const [value, key] of Object.entries(POSITIONS)) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = t(key);
  els.position.append(opt);
}

const readSettings = () => ({
  avgDiscount: Number(els.avgDiscount.value) / 100,
  regionalProfile: els.regionalProfile.value,
  refundRate: Number(els.refundRate.value) / 100
});

const pillBoxes = () => [...els.pillItems.querySelectorAll('input[data-pill-key]')];

const readUi = () => ({
  language: els.language.value,
  position: els.position.value,
  scale: Number(els.scale.value) / 100,
  pill: Object.fromEntries(pillBoxes().map((b) => [b.dataset.pillKey, b.checked]))
});

/**
 * Live sanity check: what share of list price these settings keep. The sourced
 * scenarios are around 40% on a mixed audience, 45% on a US/EU-weighted one.
 */
function refresh() {
  const s = readSettings();
  els.avgDiscountOut.textContent = pct(s.avgDiscount);
  els.refundRateOut.textContent = pct(s.refundRate, 1);
  els.scaleOut.textContent = `${els.scale.value}%`;

  // With no game in front of it, 'auto' has no review languages to read and
  // falls back to the mixed profile.
  const probe = estimateRevenue(1000, 20, s);
  els.sanity.replaceChildren();
  const marker = probe.ok ? pct(probe.takeHomeRatio) : '\u2014';
  const text = t('optSanity', [marker]);
  // Located rather than assumed to be at the front: word order differs by
  // language.
  const at = text.indexOf(marker);
  if (at === -1) {
    els.sanity.append(document.createTextNode(text));
  } else {
    els.sanity.append(text.slice(0, at));
    const b = document.createElement('b');
    b.textContent = marker;
    els.sanity.append(b, text.slice(at + marker.length));
  }

  if (s.regionalProfile === 'auto') {
    const note = document.createElement('div');
    note.className = 'sanity-note';
    note.textContent = t('optRegionAutoNote');
    els.sanity.append(note);
  }
}

function flash(message) {
  els.saved.textContent = message;
  els.saved.classList.add('on');
  setTimeout(() => els.saved.classList.remove('on'), 1800);
}

for (const el of [els.avgDiscount, els.refundRate, els.regionalProfile, els.scale]) {
  el.addEventListener('input', refresh);
}

// Overlay preferences apply immediately, without waiting for Save.
for (const el of [els.position, els.scale, els.language, ...pillBoxes()]) {
  el.addEventListener('change', async () => {
    await chrome.storage.local.set({ ui: readUi() });
    flash(t('optPositionSaved'));
  });
}

$('save').addEventListener('click', async () => {
  await chrome.storage.local.set({ settings: readSettings() });
  flash(t('optSaved'));
});

// Reset must persist, not merely refill the form, or the overlay keeps the
// previous values. Scoped to what Save covers, so it leaves the ui key alone.
$('reset').addEventListener('click', async () => {
  const defaults = { ...REVENUE_DEFAULTS };
  applySettings(defaults);
  refresh();
  await chrome.storage.local.set({ settings: defaults });
  flash(t('optResetDone'));
});

$('clear').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'clearCaches' }, (res) => {
    flash(res?.removed ? t('optCleared', [res.removed]) : t('optNothingToClear'));
  });
});

function applySettings(s) {
  els.avgDiscount.value = Math.round(s.avgDiscount * 100);
  els.regionalProfile.value = s.regionalProfile;
  els.refundRate.value = (s.refundRate * 100).toFixed(1);
}

{
  const { settings, ui } = boot;
  applySettings({ ...REVENUE_DEFAULTS, ...(settings ?? {}) });
  const u = { ...UI_DEFAULTS, ...(ui ?? {}) };
  els.language.value = u.language;
  els.position.value = u.position;
  els.scale.value = Math.round(u.scale * 100);
  const pill = { ...PILL_DEFAULTS, ...(u.pill ?? {}) };
  for (const box of pillBoxes()) box.checked = Boolean(pill[box.dataset.pillKey]);
  refresh();
}
