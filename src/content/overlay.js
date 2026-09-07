import { compact, money, pct, integer } from '../core/format.js';
import { SOURCES, REVIEW_GATES } from '../core/constants.js';
import { sparklinePoints } from '../core/history.js';
import { pillFigures } from '../core/pill.js';
import { comparableScopes } from './scrape.js';
import { t, tr, humanise } from './i18n.js';

const HOST_ID = 'srwe-overlay-host';

/** Divider between peer figures in the collapsed row. */
const SEPARATOR_CHAR = '|';
/** Joiner between clauses of one sentence. Always an element, never text. */
const clauseSep = () => el('span', 'sep', '\u00b7');

/** Message keys for the confidence word and its tooltip legend. */
const CONFIDENCE_WORD = {
  good: 'confReliable',
  fair: 'confRough',
  low: 'confUnreliable',
  none: 'confNoData'
};
const CONFIDENCE_LEGEND = {
  good: 'legendGood',
  fair: 'legendFair',
  low: 'legendLow',
  none: 'legendNone'
};

const CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }

.root {
  position: fixed;
  z-index: 2147483000;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 13px;
  line-height: 1.45;
  color: #dfe4ee;
  font-variant-numeric: tabular-nums;
}
.root.pos-br { right: 16px; bottom: 16px; }
.root.pos-bl { left: 16px; bottom: 16px; }
.root.pos-tr { right: 16px; top: 16px; }
.root.pos-tl { left: 16px; top: 16px; }

.pill {
  display: flex; flex-direction: column; align-items: stretch; gap: 6px;
  background: rgba(16, 19, 26, .78);
  backdrop-filter: blur(18px) saturate(135%);
  -webkit-backdrop-filter: blur(18px) saturate(135%);
  padding: 5px 10px; cursor: pointer;
}
.pill:hover { background: rgba(28, 33, 44, .82); }
.pill:focus-visible { outline: 2px solid #67c1f5; outline-offset: 2px; }

.conf { font-weight: 600; white-space: nowrap; }
.conf.good { color: #4ec9a5; }
.conf.fair { color: #ffb02e; }
.conf.low  { color: #e8654f; }
.conf.none { color: #7c8698; }
.pill-meta {
  display: flex; align-items: baseline; justify-content: flex-end; gap: 10px;
  font-size: 10.5px; line-height: 1.2; 
}
.pill-brand { color: #454e60; font-size: 9px; white-space: nowrap; font-weight: 900; opacity: 0.6; text-transform: uppercase; font-style: italic; }
.pill-version { color: #454e60; font-size: 9px; white-space: nowrap; font-weight: 700; opacity: 0.6; font-variant-numeric: tabular-nums; }

/* Figures stack: the reading on top, the verdict for that reading below it. */
.pill-fig { display: flex; flex-direction: column; gap: 1px; }
.pill-fig-sub { font-size: 9px; font-weight: 600; line-height: 1.1; }
.pill-sep { align-self: center; }
/* Any figure with a verdict beneath it, so cells shrink together. */
.pill-fig:has(.pill-fig-sub) > span:first-child { font-size: 11px; }

.pill-figures { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.pill-figures b { font-weight: 600; }
.pill-fig-rank { color: #7c8698; font-weight: 600; }
.pill-sep { color: #39414f; font-weight: 400; }
/* Steam's own review bands and colours, so the count reads the same here as
   on the page behind it. The boundary is 70% ("Mixed" below, "Mostly
   Positive" above), not 80%. */
.rev-positive,  .rev-positive b  { color: #66c0f4; }
.rev-mixed,     .rev-mixed b     { color: #b9a074; }
.rev-negative,  .rev-negative b  { color: #a34c25; }
/* Steam's in-game green, primary light steel and discount lime. */
.fig-players,   .fig-players b   { color: #7cc53f; }
.fig-wishlists, .fig-wishlists b { color: #66c0f4; }
.fig-units,     .fig-units b     { color: #c7d5e0; }
.fig-revenue,   .fig-revenue b   { color: #beee11; }

/* Emphasis inside notes. */
.hl { color: #c9d1e0; }
.hl-accent   { color: #66c0f4; }
.hl-players  { color: #7cc53f; }
.hl-positive { color: #66c0f4; }
.hl-mixed    { color: #b9a074; }
.hl-negative { color: #a34c25; }
.hl-revenue  { color: #beee11; }
/* Direction of travel, in SteamCharts' colours. */
.trend-up   { color: #4ec9a5; }
.trend-down { color: #e8654f; }
.trend-flat { color: #7c8698; }
.em { font-weight: 700; color: #c9d1e0; }

.panel {
  width: 356px; overflow-y: auto;
  /* The saturation bump keeps Steam's artwork from greying out under blur. */
  background: rgba(16, 19, 26, .78);
  backdrop-filter: blur(18px) saturate(135%);
  -webkit-backdrop-filter: blur(18px) saturate(135%);
  /* The root is zoomed, so viewport units here render multiplied by that
     factor; dividing keeps the panel on screen as content grows. */
  max-height: calc((100vh - 32px) / var(--zoom, 1));
  /* Do not hand the wheel to the store page at the end of the list. */
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,.18) transparent;
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .panel, .pill { background: #10131a; }
}

.panel::-webkit-scrollbar { width: 10px; }
.panel::-webkit-scrollbar-track { background: transparent; }
.panel::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,.14); border-radius: 5px;
  border: 3px solid transparent; background-clip: padding-box;
}
.panel::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.24); background-clip: padding-box;
}

.head { display: flex; align-items: center; gap: 10px; padding: 13px 14px 11px; border-bottom: 1px solid rgba(255,255,255,.09); }
.head-text { flex: 1; min-width: 0; }
/* A baseline flex row, so a long game name truncates on its own instead of
   swallowing the separator and the link with it. */
.title {
  display: flex; align-items: baseline; min-width: 0;
  font-size: 13px; font-weight: 600;
}
.title-name {
  color: #dfe4ee; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* Shared by every clause joiner in the interface. */
.sep { color: #6b7688; font-weight: 700; margin: 0 7px; }
.title-sep { flex: none; }
.title-link { flex: none; color: #7c8698; text-decoration: none; font-weight: 400; font-size: 12px; }
.title-link:hover { color: #c9d1e0; text-decoration: underline; }
.title-link:focus-visible { outline: 2px solid #67c1f5; outline-offset: 2px; }
.conf-tag { font-size: 10.5px; font-weight: 600; color: #4b5568; }
.verdict { margin-top: 3px; font-size: 12px; }
.verdict-why { color: #8b95a8; }
.subtitle { font-size: 11.5px; color: #7c8698; margin-top: 2px; }
.subtitle a, .note a { color: #67c1f5; text-decoration: none; }
.subtitle a:hover, .note a:hover { text-decoration: underline; }
.subtitle a:focus-visible, .note a:focus-visible { outline: 2px solid #67c1f5; outline-offset: 2px; }
.close {
  /* The head centres its text; the close button belongs in the corner. */
  align-self: flex-start;
  background: none; border: none; color: #6f7889; cursor: pointer;
  font-size: 26px; line-height: 1; padding: 4px 10px; margin: -4px -8px -4px 0;
  border-radius: 4px;
}
.close:hover { color: #dfe4ee; background: #1a1f2b; }
.close:focus-visible { outline: 2px solid #67c1f5; outline-offset: 1px; }

.metric { padding: 13px 14px; border-bottom: 1px solid rgba(255,255,255,.06); }
.metric-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; margin-bottom: 9px; }
.metric-name { color: #9aa4b6; font-size: 12px; }
.metric-right { display: flex; align-items: baseline; gap: 7px; }
.metric-mid { font-size: 16px; font-weight: 600; }

.delta { font-size: 11.5px; }
.delta.up { color: #4ec9a5; }
.delta.down { color: #e8654f; }

/* Bar width reads as uncertainty. */
.scale { position: relative; height: 22px; }
.track { position: absolute; top: 7px; left: 0; right: 0; height: 4px; background: #1e2431; border-radius: 2px; }
.band { position: absolute; top: 7px; left: 0; right: 0; height: 4px; border-radius: 2px;
        background: linear-gradient(90deg, #2c5f80, #67c1f5, #2c5f80); }
.band.wide { background: linear-gradient(90deg, #6b2a1f, #e8654f, #6b2a1f); }
.marker { position: absolute; top: 3px; width: 3px; height: 12px; background: #cfeaff; border-radius: 1px; transform: translateX(-1.5px); }
/* A 2px mark is impossible to hover, so it sits in a larger hit target. */
.tick-hit {
  position: absolute; top: -4px; width: 26px; height: 26px;
  transform: translateX(-13px); cursor: help;
  display: flex; justify-content: center; align-items: flex-start;
  z-index: 3;
}
.tick-hit:focus-visible { outline: 2px solid #67c1f5; outline-offset: -2px; border-radius: 3px; }
.tick { width: 2px; height: 12px; margin-top: 7px; background: #cfeaff; opacity: .55; border-radius: 1px; }
.tick-hit:hover .tick, .tick-hit:focus-visible .tick { opacity: 1; height: 16px; margin-top: 5px; }
.marker { cursor: help; }

/* Anchored to the viewport: the panel scrolls, and a scroll container clips
   its children on both axes. */
.tip {
  position: fixed; left: 0; top: 0;
  background: #05070b; color: #dfe4ee; border: 1px solid #2b3242;
  padding: 5px 9px; font-size: 11.5px; white-space: nowrap;
  opacity: 0; pointer-events: none; z-index: 2147483001;
}
.tip.on { opacity: 1; }
.ends { position: absolute; top: 0; left: 0; right: 0; display: flex; justify-content: space-between; font-size: 11px; color: #6f7889; }
.ends span { transform: translateY(14px); }

.note { font-size: 11.5px; color: #7c8698; margin-top: 8px; }
.subfact {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 10px; margin-top: 7px; font-size: 11.5px;
}
.subfact-label { color: #7c8698; }
.subfact-right { display: flex; align-items: baseline; gap: 8px; }
.subfact-value { font-weight: 600; }
.subfact-badge { font-size: 10.5px; font-weight: 600; }
.note.warn { color: #ffb02e; }

.spark { margin-top: 10px; }
.spark svg { display: block; width: 100%; height: 26px; }
.spark-cap { font-size: 11px; color: #6f7889; margin-top: 3px; }

details { border-bottom: 1px solid rgba(255,255,255,.06); }
summary { padding: 11px 14px; cursor: pointer; font-size: 12px; color: #9aa4b6;
          list-style: none; display: flex; justify-content: space-between; gap: 10px; }
summary::-webkit-details-marker { display: none; }
summary::after {
  content: '+'; color: #8b95a8; font-size: 17px; line-height: .9;
  width: 16px; text-align: center; flex: none;
}
summary:hover::after { color: #67c1f5; }
details[open] summary::after { content: '\\2212'; }
summary:hover { color: #dfe4ee; }
summary:focus-visible { outline: 2px solid #67c1f5; outline-offset: -2px; }
.details-body { padding: 2px 14px 13px; }

.row { display: flex; justify-content: space-between; gap: 12px; padding: 4px 0; font-size: 12px; }
.row-label { color: #8b95a8; min-width: 0; }
.row-value { flex: none; }
.row-value.neg { color: #e8654f; }
.row-value.tot { font-weight: 600; color: #4ec9a5; }
.row.total { border-top: 1px solid rgba(255,255,255,.09); margin-top: 6px; padding-top: 8px; }
.row-sub { font-size: 11px; color: #5b6478; }

.chip { display: inline-block; font-size: 11px; color: #c9d1e0; background: #1a1f2b;
        border: 1px solid #2b3242; border-radius: 5px; padding: 2px 7px; margin: 4px 4px 0 0; }

.foot { display: flex; justify-content: space-between; align-items: center;
        padding: 11px 14px; font-size: 11.5px; color: #6f7889; }
.foot-brand { display: inline-flex; align-items: baseline; gap: 10px; font-size: 9px; }
.foot a { color: #8b95a8; text-decoration: none; border-bottom: 1px solid #2b3242; cursor: pointer; }
.foot a:hover { color: #67c1f5; border-color: #67c1f5; }
.foot a:focus-visible { outline: 2px solid #67c1f5; outline-offset: 2px; }

@media (prefers-reduced-motion: no-preference) {
  .pill, .close, .foot a { transition: border-color .12s ease, color .12s ease; }
}
`;

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function svgEl(tag, attrs = {}) {
  const n = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

/** The wordmark shown in the corner of the collapsed pill. */
const BRAND = 'Wishlytic';

/**
 * The shipped version, from the manifest. Empty outside the extension, where
 * chrome does not exist (the smoke tests import this in Node); both display
 * sites fall back to showing nothing.
 */
const VERSION = typeof chrome !== 'undefined' && chrome.runtime?.getManifest
  ? `v${chrome.runtime.getManifest().version}`
  : '';

/** Per-figure colouring in the collapsed pill. */
function figureClass(key, game) {
  if (key === 'reviews') return sentimentClass(game.positivePct);
  if (key === 'players') return 'fig-players';
  if (key === 'wishlists') return 'fig-wishlists';
  if (key === 'units') return 'fig-units';
  if (key === 'gross' || key === 'net') return 'fig-revenue';
  return null;
}

/** Map a sentiment class onto its note-highlight counterpart. */
function toneHighlight(tone) {
  return tone ? tone.replace('rev-', 'hl-') : 'hl';
}

/**
 * Emphasise one substring inside an already-translated sentence. The marker is
 * located rather than assumed to be at the front: word order differs by
 * language. Returns the sentence unchanged when the marker is absent.
 */
function splitAround(sentence, marker, className) {
  const at = sentence.indexOf(marker);
  if (at === -1) return sentence;
  return [
    sentence.slice(0, at),
    [marker, className],
    sentence.slice(at + marker.length)
  ];
}

/** Steam's own review-score thresholds, used to colour the count. */
function sentimentClass(positivePct) {
  if (!Number.isFinite(positivePct)) return null;
  if (positivePct >= 70) return 'rev-positive';   // Mostly Positive and up
  if (positivePct >= 40) return 'rev-mixed';      // Mixed
  return 'rev-negative';
}

/** The small verdict that sits beside a metric name, with its reasons. */
function confidenceTag(conf, withSeparator = false) {
  if (!conf || conf.level === 'none') return document.createDocumentFragment();
  const wrap = el('span', 'conf-tag');
  if (withSeparator) wrap.append(clauseSep());
  const word = el('span', `conf ${conf.level}`, t(CONFIDENCE_WORD[conf.level] ?? 'confNoData'));
  word.title = [t(CONFIDENCE_LEGEND[conf.level] ?? 'legendNone'),
                ...(conf.reasons ?? []).map(tr)].join('\n');
  wrap.append(word);
  return wrap;
}

function confidenceWord(level) {
  const span = el('span', `conf ${level}`, t(CONFIDENCE_WORD[level] ?? 'confNoData'));
  span.title = t(CONFIDENCE_LEGEND[level] ?? 'legendNone');
  return span;
}

/**
 * Tooltips live in a layer outside the panel, since a scroll container would
 * clip them. The root carries a CSS zoom, which multiplies the coordinates of
 * fixed descendants while getBoundingClientRect still reports real viewport
 * pixels, so the measured rect is divided back down before use.
 */
let tipLayer = null;

/** No-op until an overlay exists, so scale() never has to check. */
function attachTip(anchor, text) {
  tipLayer?.attach(anchor, text);
}

function makeTipLayer(root, zoom) {
  const tip = el('div', 'tip');
  root.append(tip);
  let current = null;

  const place = (anchor, text) => {
    tip.textContent = text;
    tip.classList.add('on');

    const r = anchor.getBoundingClientRect();
    const own = tip.getBoundingClientRect();
    const margin = 8;

    let left = r.left + r.width / 2 - own.width / 2;
    left = Math.min(Math.max(left, margin), window.innerWidth - own.width - margin);

    // Above the anchor by default, below it when there is no room up top.
    let top = r.top - own.height - 6;
    if (top < margin) top = r.bottom + 6;

    tip.style.left = `${left / zoom}px`;
    tip.style.top = `${top / zoom}px`;
  };

  return {
    attach(anchor, text) {
      const show = () => { current = anchor; place(anchor, text); };
      const hide = () => { if (current === anchor) { current = null; tip.classList.remove('on'); } };
      anchor.addEventListener('mouseenter', show);
      anchor.addEventListener('mouseleave', hide);
      anchor.addEventListener('focus', show);
      anchor.addEventListener('blur', hide);
    },
    hide() { current = null; tip.classList.remove('on'); }
  };
}

/**
 * A labelled range scale, optionally with a tick mark for where each
 * individual estimator landed.
 */
function scale(range, fmt, { ticks = [], wide = false } = {}) {
  const wrap = el('div', 'scale');
  wrap.append(el('div', 'track'));

  const span = Math.max(range.hi - range.lo, 1e-9);
  const posOf = (v) => Math.min(Math.max((v - range.lo) / span, 0), 1);

  wrap.append(el('div', `band${wide ? ' wide' : ''}`));

  for (const tick of ticks) {
    if (!Number.isFinite(tick.value)) continue;
    const hit = el('div', 'tick-hit');
    hit.style.left = `${posOf(tick.value) * 100}%`;
    hit.append(el('div', 'tick'));

    // The tooltip names where the method's coefficient came from.
    const text = tick.origin
      ? `${tr(tick.label)}: ${fmt(tick.value)} \u2014 ${tr(tick.origin)}`
      : `${tr(tick.label)}: ${fmt(tick.value)}`;
    hit.tabIndex = 0;
    hit.setAttribute('role', 'img');
    hit.setAttribute('aria-label', text);
    attachTip(hit, text);

    wrap.append(hit);
  }

  const marker = el('div', 'marker');
  marker.style.left = `${posOf(range.mid) * 100}%`;
  attachTip(marker, t('tipMidpoint', [fmt(range.mid)]));
  wrap.append(marker);

  const ends = el('div', 'ends');
  ends.append(el('span', null, fmt(range.lo)), el('span', null, fmt(range.hi)));
  wrap.append(ends);
  return wrap;
}

/** A signed change in percentage points, coloured by direction. */
function deltaBadgeFor(pp) {
  if (!Number.isFinite(pp)) return null;
  const dir = pp >= 1 ? 'up' : pp <= -1 ? 'down' : 'flat';
  const sign = pp > 0 ? '+' : pp < 0 ? '\u2212' : '';
  return { text: t('nPp', [`${sign}${Math.abs(pp)}`]), className: `trend-${dir}` };
}

function deltaBadge(value, fmt = compact) {
  if (!Number.isFinite(value) || value === 0) return null;
  const sign = value > 0 ? '+' : '\u2212';
  return el('span', `delta ${value > 0 ? 'up' : 'down'}`, `${sign}${fmt(Math.abs(value))}`);
}

function metric(name, range, fmt, opts = {}) {
  const box = el('div', 'metric');
  const head = el('div', 'metric-head');
  const nameCell = el('span', 'metric-name', name);
  if (opts.confidence) nameCell.append(confidenceTag(opts.confidence, true));
  head.append(nameCell);

  const right = el('div', 'metric-right');
  const badge = opts.delta != null ? deltaBadge(opts.delta, fmt) : null;
  if (badge) right.append(badge);
  right.append(el('span', 'metric-mid', fmt(range.mid)));
  head.append(right);

  if (opts.valueClass) right.lastChild.classList.add(opts.valueClass);

  box.append(head, scale(range, fmt, { ticks: opts.ticks, wide: opts.wide }));
  if (opts.note) box.append(noteNode(opts.note, opts.noteWarn));
  for (const reason of opts.reasons ?? []) box.append(reasonNode(reason, 'note warn'));
  return box;
}

/** Append note pieces, each either a plain string or [text, className]. */
function appendPieces(target, pieces) {
  for (const piece of Array.isArray(pieces) ? pieces : [pieces]) {
    if (piece == null) continue;
    if (Array.isArray(piece)) target.append(el('span', piece[1], piece[0]));
    else target.append(document.createTextNode(String(piece)));
  }
  return target;
}

function noteNode(note, warn = false) {
  return appendPieces(el('div', `note${warn ? ' warn' : ''}`), note);
}

/**
 * Turn a translated sentence into note pieces, emphasising any `**marked**`
 * span plus each value in `emphasise`.
 */
function richText(sentence, emphasise = []) {
  const pieces = [];
  let rest = String(sentence);

  // Explicit markers first, so a translator can emphasise a fixed phrase.
  // The dynamic values are then split out of whichever plain piece holds them.
  const marked = rest.split(/\*\*(.+?)\*\*/s);
  for (let i = 0; i < marked.length; i++) {
    if (i % 2 === 1) pieces.push([marked[i], 'em']);
    else if (marked[i]) pieces.push(marked[i]);
  }

  if (!emphasise.length) return pieces;

  return pieces.flatMap((piece) => {
    if (Array.isArray(piece)) return [piece];
    let out = [piece];
    for (const value of emphasise.map(String).filter(Boolean)) {
      out = out.flatMap((part) => {
        if (Array.isArray(part)) return [part];
        const at = part.indexOf(value);
        if (at === -1) return [part];
        return [part.slice(0, at), [value, 'em'], part.slice(at + value.length)].filter((x) => x !== '');
      });
    }
    return out;
  });
}

/** A translated descriptor rendered with its substitutions emphasised. */
function reasonNode(descriptor, className = 'subtitle') {
  // Only a reason that caused a downgrade gets its number emphasised.
  const alarming = (descriptor?.severity ?? 0) >= 2;
  const params = (alarming && descriptor?.params) || [];
  const box = el('div', className);
  for (const piece of richText(tr(descriptor), params)) {
    if (Array.isArray(piece)) box.append(el('span', piece[1], piece[0]));
    else box.append(document.createTextNode(piece));
  }
  return box;
}

/** Join note pieces with the interpunct the rest of the interface uses. */
function joinPieces(groups) {
  const out = [];
  for (const group of groups.filter(Boolean)) {
    if (out.length) out.push(['\u00b7', 'sep']);
    out.push(...(Array.isArray(group) && !(typeof group[1] === 'string' && group.length === 2)
      ? group : [group]));
  }
  return out;
}

/**
 * A measured fact: no scale, no error bars, no confidence verdict — those are
 * reserved for estimates, so the two never look alike.
 */
function fact(name, value, fmt, note, delta, valueClass) {
  const box = el('div', 'metric');
  const head = el('div', 'metric-head');
  head.append(el('span', 'metric-name', name));

  const right = el('div', 'metric-right');
  const badge = delta != null ? deltaBadge(delta, fmt) : null;
  if (badge) right.append(badge);
  const mid = el('span', 'metric-mid', fmt(value));
  if (valueClass) mid.classList.add(valueClass);
  right.append(mid);
  head.append(right);

  box.append(head);
  if (note) box.append(noteNode(note));
  return box;
}

/** A secondary figure under a fact, aligned to the same right-hand column. */
function subFact(label, value, valueClass, badge) {
  const row = el('div', 'subfact');
  row.append(el('span', 'subfact-label', label));
  const right = el('span', 'subfact-right');
  if (badge) right.append(el('span', `subfact-badge ${badge.className ?? ''}`, badge.text));
  right.append(el('span', `subfact-value ${valueClass ?? ''}`, value));
  row.append(right);
  return row;
}

/**
 * A statement about the page, with no figure and no label. Distinct from
 * `unavailable`, which labels a figure that is missing.
 */
function notice(text) {
  const box = el('div', 'metric');
  box.append(noteNode(richText(text)));
  return box;
}

function unavailable(name, text) {
  const box = el('div', 'metric');
  const head = el('div', 'metric-head');
  head.append(el('span', 'metric-name', name), el('span', 'metric-mid', '\u2014'));
  box.append(head, noteNode(richText(text)));
  return box;
}

function sparkline(series, key, label) {
  const data = sparklinePoints(series, key);
  if (!data) return null;

  const wrap = el('div', 'spark');
  const w = 320;
  const h = 26;
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });

  const d = data.points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${(p.x * w).toFixed(1)} ${(h - 2 - p.y * (h - 4)).toFixed(1)}`)
    .join(' ');

  svg.append(svgEl('path', { d, fill: 'none', stroke: '#67c1f5', 'stroke-width': '1.5', 'stroke-linejoin': 'round' }));
  const last = data.points[data.points.length - 1];
  svg.append(svgEl('circle', { cx: (last.x * w).toFixed(1), cy: (h - 2 - last.y * (h - 4)).toFixed(1), r: '2', fill: '#cfeaff' }));

  wrap.append(svg);
  wrap.append(el('div', 'spark-cap',
    t('nSparkCap', [label, compact(data.min), compact(data.max), data.points.length])));
  return wrap;
}

function collapsible(label, buildBody) {
  const d = el('details');
  const s = el('summary');
  s.append(el('span', null, label));
  s.tabIndex = 0;
  d.append(s);
  const body = el('div', 'details-body');
  buildBody(body);
  d.append(body);
  return d;
}

function row(label, value, { negative = false, total = false, sub = null } = {}) {
  const r = el('div', `row${total ? ' total' : ''}`);
  const left = el('span', 'row-label');
  left.append(document.createTextNode(label));
  if (sub) {
    left.append(document.createElement('br'));
    left.append(appendPieces(el('span', 'row-sub'), sub));
  }
  const right = el('span', `row-value${negative ? ' neg' : ''}${total ? ' tot' : ''}`);
  r.append(left, appendPieces(right, value));
  return r;
}

/** Setting values are kebab-case; message keys are camelCase. */
const REGION_KEY = { 'us-eu': 'regionUsEu', mixed: 'regionMixed', emerging: 'regionEmerging' };
const CONTEXT_KEY = {
  none: 'ctxNone', nextFest: 'ctxNextFest', featured: 'ctxFeatured'
};

/** splitAround returns a string when the marker is absent, an array when not. */
const asPieces = (value) => (Array.isArray(value) ? value : [value]);

/**
 * What the wishlist figure was read from, in one line. Names both signals when
 * both answered, since the figure is their average.
 */
function wishlistNote(w) {
  const pieces = [];

  if (w.followers != null && w.multiplier != null) {
    // The genre multiplier is disclosed in the confidence reasons, not here:
    // a coefficient in the headline is a number the reader cannot act on.
    const sentence = w.contextKey !== 'unknown'
      ? t('nFromFollowers', [integer(w.followers), t(CONTEXT_KEY[w.contextKey])])
      : t('nFromFollowersOnly', [integer(w.followers)]);
    pieces.push(...asPieces(splitAround(sentence, integer(w.followers), 'hl-accent')));
  }

  if (w.rank) {
    if (pieces.length) pieces.push(' · ');
    const rank = integer(w.rank.rank);
    const sentence = w.rank.announcedShare != null
      ? t('nWishlistRank', [rank, integer(w.rank.listed), (w.rank.announcedShare * 100).toFixed(1)])
      : t('nWishlistRankOnly', [rank, integer(w.rank.listed)]);
    pieces.push(...asPieces(splitAround(sentence, rank, 'hl-accent')));
  } else if (w.ceiling != null) {
    if (pieces.length) pieces.push(' · ');
    pieces.push(t('nWishlistBelowList', [compact(w.ceiling)]));
  }

  return pieces;
}

/**
 * Why the player-count cross-check is not showing. Only the knowably-absent
 * cases; `no-ccu` is deliberately not among them.
 */
const CCU_SKIP_KEY = {
  'peak-not-at-launch': 'nCcuLatePeak',
  'peak-date-unknown': 'nCcuNoPeakDate'
};

/**
 * Thresholds quoted in a refusal come from the constant, so lowering a gate
 * cannot leave a stale number in twelve translations.
 */
const REASON_PARAMS = {
  'too-few-reviews': () => [integer(REVIEW_GATES.MIN_REVIEWS)]
};

/** Why this kind of store page gets no estimate — see APP_TYPES. */
const TYPE_KEY = {
  demo: 'wTypeDemo',
  dlc: 'wTypeDlc',
  music: 'wTypeMusic',
  video: 'wTypeVideo',
  series: 'wTypeVideo',
  episode: 'wTypeVideo',
  hardware: 'wTypeHardware',
  mod: 'wTypeMod',
  advertising: 'wTypeAdvertising'
};

const reasonText = (section, fallbackKey) => {
  const reason = section?.reason;
  if (reason === 'unsupported-type') {
    return t(TYPE_KEY[section.appType] ?? 'wUnsupportedType');
  }
  return t(REASON_KEY[reason] ?? fallbackKey, REASON_PARAMS[reason]?.() ?? []);
};

/** A link to another store page, for pointing at the game a page belongs to. */
function storeLink(appId, label) {
  const a = el('a', null, label);
  a.href = `https://store.steampowered.com/app/${appId}/`;
  a.rel = 'noopener noreferrer';
  return a;
}

const REASON_KEY = {
  'too-few-reviews': 'wTooFewReviews',
  'no-review-data': 'wNoReviewData',
  'no-estimators': 'wNoEstimators',
  'no-followers': 'wNoFollowers',
  'free-to-play': 'wFreeToPlay',
  'no-price': 'wNoPrice',
  'no-units': 'wNoPrice'
};

export function renderOverlay(result, opts = {}) {
  const {
    onOpenOptions, history = null, delta = null,
    position = 'pos-br', scale: uiScale = 1.25, pill: pillConfig = {}
  } = opts;

  document.getElementById(HOST_ID)?.remove();

  const host = el('div');
  host.id = HOST_ID;
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.append(style);

  const root = el('div', `root ${position}`);
  // Scales text, padding, controls and bars together. `--zoom` mirrors it for
  // the rules that have to divide viewport units back down.
  root.style.zoom = String(uiScale);
  root.style.setProperty('--zoom', String(uiScale));
  shadow.append(root);
  document.body.append(host);

  const { units, revenue, wishlists, weekOne, confidence, game, crossChecks } = result;
  let expanded = false;

  const draw = () => {
    root.replaceChildren();
    tipLayer = makeTipLayer(root, uiScale);
    root.append(expanded ? buildPanel() : buildPill());
  };

  /** The trend line under a measured figure in the collapsed row. */
  function pillTrendFor(key) {
    if (key === 'reviews') {
      const pp = reviewTrendPp();
      return Number.isFinite(pp) ? deltaBadgeFor(pp) : null;
    }
    if (key === 'players') {
      const change = game.trend?.changePct;
      if (!Number.isFinite(change)) return null;
      const dir = change > 0 ? 'up' : change < 0 ? 'down' : 'flat';
      const sign = change > 0 ? '+' : change < 0 ? '\u2212' : '';
      return { text: `${sign}${Math.abs(change).toFixed(1)}%`, className: `trend-${dir}` };
    }
    return null;
  }

  function buildPill() {
    const pill = el('div', 'pill');
    pill.tabIndex = 0;
    pill.setAttribute('role', 'button');
    pill.setAttribute('aria-label', t('ariaOpen'));
    const figs = el('div', 'pill-figures');
    const FORMATTERS = { compact, money, integer };
    const items = pillFigures(result, pillConfig);

    // Which figures carry a verdict; measured facts take none. Gross and net
    // share one: the width of either is set by the unit estimate feeding them,
    // not by the two deductions that separate them.
    const CONF_FOR = { units: 'units', gross: 'revenue', net: 'revenue', wishlists: 'wishlists' };

    for (const item of items) {
      if (figs.childNodes.length) figs.append(el('span', 'pill-sep', SEPARATOR_CHAR));

      const cell = el('div', 'pill-fig');
      const line = el('span', figureClass(item.key, game));
      line.append(
        el('b', null, (FORMATTERS[item.format] ?? compact)(item.value)),
        document.createTextNode(' ' + t(item.labelKey))
      );
      // Qualifies the figure rather than being one, so it sits inside the same
      // cell and keeps the separator meaning "next reading".
      if (item.suffix) {
        line.append(el('span', 'pill-fig-rank', ' ' + t(item.suffix.key, [integer(item.suffix.value)])));
      }
      cell.append(line);

      // Estimates carry a verdict underneath; measured figures carry their
      // direction of travel.
      const conf = confidence[CONF_FOR[item.key]];
      if (conf && conf.level !== 'none') {
        cell.append(el('span', `pill-fig-sub conf ${conf.level}`,
          t(CONFIDENCE_WORD[conf.level] ?? 'confNoData')));
      } else {
        const sub = pillTrendFor(item.key);
        if (sub) cell.append(el('span', `pill-fig-sub ${sub.className}`, sub.text));
      }
      figs.append(cell);
    }

    if (figs.childNodes.length) pill.append(figs);

    const meta = el('div', 'pill-meta');
    if (BRAND) meta.append(el('span', 'pill-brand', BRAND));
    meta.append(el('span', 'pill-version', VERSION));
    pill.append(meta);

    const open = () => { expanded = true; draw(); };
    pill.addEventListener('click', open);
    pill.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
    return pill;
  }

  /**
   * Change in positive share, in percentage points. Shared by the collapsed
   * row and the panel so the two cannot disagree.
   */
  function reviewTrendPp() {
    const rt = game.reviewTrend;
    if (!rt || !Number.isFinite(rt.recentPct)) return null;
    const fromPage = comparableScopes(rt, game.reviews);
    const lifetime = fromPage ? rt.allPct : game.positivePct;
    return Number.isFinite(lifetime) ? rt.recentPct - Math.round(lifetime) : null;
  }

  function reviewsFact() {
    if (!Number.isFinite(game.reviews)) return document.createDocumentFragment();

    const rt = game.reviewTrend;

    // Which lifetime share to pair with the recent one: the page's own row
    // when it covers the same population, otherwise our all-language share —
    // see comparableScopes.
    const fromPage = rt && Number.isFinite(rt.recentPct) && comparableScopes(rt, game.reviews);
    const lifetimePct = fromPage ? rt.allPct : game.positivePct;
    const pp = reviewTrendPp();

    const box = fact(t('mReviews'), game.reviews, integer, null,
      delta?.reviews, sentimentClass(lifetimePct));
    box.title = t('nReviewScope');

    if (Number.isFinite(lifetimePct)) {
      box.append(subFact(t('mPositiveAllTime'), `${Math.round(lifetimePct)}%`,
        sentimentClass(lifetimePct)));
    }

    if (rt && Number.isFinite(rt.recentPct)) {
      const badge = deltaBadgeFor(pp);
      const row = subFact(t('mPositiveRecent'), `${rt.recentPct}%`,
        sentimentClass(rt.recentPct), badge);
      if (Number.isFinite(rt.recentCount)) {
        row.title = t('nRecentVsAll', [`${rt.recentPct}%`, integer(rt.recentCount)]);
      }
      box.append(row);
    }

    return box;
  }

  /** Live, 24-hour and all-time peak player counts. All measured. */
  function playersFact() {
    const now = game.currentPlayers;
    const peak = game.peak24h;
    const allTime = game.allTimePeak;

    const hasLive = Number.isFinite(now) && now > 0;
    const hasPeak = Number.isFinite(peak) && peak > 0;
    const hasAllTime = Number.isFinite(allTime) && allTime > 0;

    // A zero never becomes the headline.
    if (!hasLive && !hasPeak && !hasAllTime) return document.createDocumentFragment();

    const headline = hasLive
      ? { label: t('mPlayers'), value: now }
      : hasPeak
        ? { label: t('mPeak24h'), value: peak }
        : { label: t('mAllTimePeak'), value: allTime };

    const box = fact(headline.label, headline.value, integer, null, null, 'fig-players');

    // Rows below the headline, skipping whichever figure is already up there.
    // A zero peak beside live players is a reading, so it is kept.
    if (hasLive && Number.isFinite(peak)) {
      box.append(subFact(t('mPeak24h'), integer(peak), 'hl-players'));
    }
    if ((hasLive || hasPeak) && hasAllTime) {
      box.append(subFact(t('mAllTimePeak'), integer(allTime), 'hl-players'));
    }

    const trend = game.trend;
    if (trend && Number.isFinite(trend.changePct)) {
      const dir = trend.changePct > 0 ? 'up' : trend.changePct < 0 ? 'down' : 'flat';
      const sign = trend.changePct > 0 ? '+' : trend.changePct < 0 ? '\u2212' : '';
      const row = subFact(
        t('mTrend30'),
        `${sign}${Math.abs(trend.changePct).toFixed(2)}%`,
        `trend-${dir}`
      );
      if (Number.isFinite(trend.avgPlayers)) {
        row.title = t('nTrendAvg', [integer(trend.avgPlayers)]);
      }
      box.append(row);
    }

    return box;
  }

  function buildPanel() {
    const panel = el('div', 'panel');

    const head = el('div', 'head');
    const ht = el('div', 'head-text');
    const title = el('div', 'title');
    title.append(el('span', 'title-name', game.name || `App ${game.appId}`));
    title.append(el('span', 'sep title-sep', '\u00b7'));
    const dbLink = el('a', 'title-link', t('footSteamDB'));
    dbLink.href = `https://steamdb.info/app/${game.appId}/`;
    dbLink.target = '_blank';
    dbLink.rel = 'noopener noreferrer';
    dbLink.title = t('footSteamDBHint');
    title.append(dbLink);
    ht.append(title);

    // On a demo the title, the link and every figure below describe the full
    // game, so the panel says so.
    if (game.viaDemo) {
      ht.append(el('div', 'subtitle', t('nViaDemo')));
    } else if (game.fullGameId && game.fullGameName) {
      const sub = el('div', 'subtitle');
      sub.append(document.createTextNode(t('nBelongsTo') + ' '));
      sub.append(storeLink(game.fullGameId, game.fullGameName));
      ht.append(sub);
    }

    head.append(ht);

    panel.addEventListener('scroll', () => tipLayer?.hide(), { passive: true });

    const close = el('button', 'close', '\u00d7');
    close.setAttribute('aria-label', t('ariaCollapse'));
    close.addEventListener('click', () => { expanded = false; draw(); });
    head.append(close);
    panel.append(head);

    // A page that is not a game gets one sentence and nothing else.
    if (units.reason === 'unsupported-type') {
      panel.append(notice(reasonText(units, 'wUnsupportedType')));
      panel.append(footNode());
      return panel;
    }

    // Estimates first, then the measured inputs behind them. Units, revenue
    // and reviews are skipped entirely before release rather than rendered as
    // three "no data" rows.
    if (game.released) {
      if (units.ok) {
        const ticks = (units.contributors ?? []).map((c) => ({ label: c.label, value: c.range.mid }));
        panel.append(metric(t('mUnits'), units.range, compact, {
          valueClass: 'fig-units',
          confidence: confidence.units,
          ticks: ticks.length > 1 ? ticks : [],
          wide: units.widened,
          delta: delta?.units,
          // Only the reasons that cost something; the descriptive ones stay in
          // the verdict tooltip.
          reasons: (confidence.units.reasons ?? []).filter((r) => (r.severity ?? 0) >= 1)
        }));
      } else {
        panel.append(unavailable(t('mUnits'), reasonText(units, 'wNoEstimators')));
      }

      if (revenue.ok) {
        // Gross above net, in the order the waterfall runs. Both carry the
        // same confidence: the width of either is set by the unit estimate
        // feeding them, not by the two deductions that separate them.
        panel.append(metric(t('mGross'), revenue.gross, money,
          { valueClass: 'fig-revenue', confidence: confidence.revenue,
            note: t('mGrossNote', [money(revenue.grossPerUnit)]) }));
        panel.append(metric(t('mRevenue'), revenue.net, money,
          { valueClass: 'fig-revenue', confidence: confidence.revenue }));
      } else {
        panel.append(unavailable(t('mRevenue'), reasonText(revenue, 'wNoPrice')));
      }
    }

    if (wishlists.ok) {
      const wishlistTicks = (wishlists.contributors ?? [])
        .map((c) => ({ label: c.label, value: c.range.mid, origin: c.origin }));

      panel.append(metric(t('mWishlists'), wishlists.range, compact, {
        valueClass: 'fig-wishlists',
        confidence: confidence.wishlists,
        ticks: wishlistTicks.length > 1 ? wishlistTicks : [],
        wide: wishlists.widened,
        // A follower delta pushed through the follower ratio, so it exists
        // only while that leg does.
        delta: delta?.followers != null && wishlists.multiplier != null
          ? delta.followers * wishlists.multiplier
          : null,
        note: wishlistNote(wishlists),
        reasons: (confidence.wishlists.reasons ?? []).filter((r) => (r.severity ?? 0) >= 1)
      }));
    } else if (wishlists.reason === 'released') {
      // Shipped, so the pre-launch figure is not a quantity that still exists.
      // There is no dash to put in its place either: a row headed "Wishlists,
      // pre-launch" on a game that came out years ago is wrong whatever number
      // follows it. The follower count stands in where the community group
      // gave one up, and where it did not the row goes away.
      if (wishlists.followers != null) {
        panel.append(fact(t('mFollowers'), wishlists.followers, integer, t('wReleased'), delta?.followers));
      }
    } else if (wishlists.ceiling != null) {
      // No follower count and not in the ordering: no estimate, but "below
      // roughly this many" is still an answer.
      panel.append(unavailable(
        t('mWishlists'),
        t('nWishlistBelowList', [compact(wishlists.ceiling)])
      ));
    } else {
      panel.append(unavailable(t('mWishlists'), reasonText(wishlists, 'wNoFollowers')));
    }

    if (wishlists.ok && wishlists.contributors?.length) {
      panel.append(collapsible(t('sWishlistMethods'), (body) => {
        for (const c of wishlists.contributors) {
          body.append(row(tr(c.label), compact(c.range.mid), {
            sub: [
              t('nWeight', [(c.share * 100).toFixed(0)]),
              ['\u00b7', 'sep'],
              `${compact(c.range.lo)}\u2013${compact(c.range.hi)}`,
              ...(c.origin ? [['\u00b7', 'sep'], tr(c.origin)] : [])
            ]
          }));
        }
        body.append(row(t('nGeoMean'), compact(wishlists.range.mid), { total: true }));
        if (wishlists.contributors.length === 1) body.append(el('div', 'note', t('nOneMethod')));

        if (wishlists.common) {
          body.append(noteNode(t('nCommonRegion',
            [compact(wishlists.common.lo), compact(wishlists.common.hi)])));
        } else if (wishlists.contributors.length > 1) {
          body.append(noteNode(t('nNoCommonRegion', [wishlists.gap.toFixed(1)]), true));
        }
      }));
    }

    if (game.released) panel.append(reviewsFact());
    panel.append(playersFact());

    // About the demo rather than the game, so it sits with the inputs.
    if (game.viaDemo?.reviews != null) {
      panel.append(fact(t('mDemoReviews'), game.viaDemo.reviews, integer, t('nDemoReviews')));
    }

    const trendKey = game.released ? 'reviews' : 'followers';
    const trendLabel = trendKey === 'reviews' ? t('mUnits') : t('mFollowers');
    const spark = sparkline(history, trendKey, trendLabel);
    if (spark) {
      const box = el('div', 'metric');
      const h = el('div', 'metric-head');
      h.append(el('span', 'metric-name', t('mTrend')));
      const badge = delta?.[trendKey] != null ? deltaBadge(delta[trendKey]) : null;
      if (badge) h.append(badge);
      box.append(h, spark);
      if (delta?.elapsedMs) {
        box.append(el('div', 'note', t('nTrendCompare', [humanise(delta.elapsedMs)])));
      }
      panel.append(box);
    }

    if (units.ok && units.contributors?.length) {
      panel.append(collapsible(t('sMethods'), (body) => {
        for (const c of units.contributors) {
          body.append(row(tr(c.label), compact(c.range.mid), {
            sub: [
              t('nWeight', [(c.share * 100).toFixed(0)]),
              ['\u00b7', 'sep'],
              `${compact(c.range.lo)}\u2013${compact(c.range.hi)}`
            ]
          }));
        }
        body.append(row(t('nGeoMean'), compact(units.range.mid), { total: true }));
        if (units.contributors.length === 1) body.append(el('div', 'note', t('nOneMethod')));

        // Where the bands overlap, which says more than the distance between
        // their midpoints when one source answers in wide buckets.
        if (units.common) {
          body.append(noteNode(t('nCommonRegion',
            [compact(units.common.lo), compact(units.common.hi)])));
        } else if (units.contributors.length > 1) {
          body.append(noteNode(t('nNoCommonRegion', [units.gap.toFixed(1)]), true));
        }
      }));
    }

    // The player-count cross-check, or the reason there isn't one.
    const ccu = crossChecks?.ccu;
    if (ccu?.ok) {
      panel.append(collapsible(t('sCcu'), (body) => {
        // From the result, not a fixed string: the multiplier changes with
        // pre-order history.
        body.append(row(t('nCcuRow', [String(ccu.multiplier)]), compact(ccu.range.mid),
          { sub: `${compact(ccu.range.lo)}\u2013${compact(ccu.range.hi)}` }));
        body.append(el('div', 'note', t('nCcuScope')));
      }));
    } else if (game.released && CCU_SKIP_KEY[ccu?.reason]) {
      panel.append(collapsible(t('sCcu'), (body) => {
        body.append(noteNode(richText(
          ccu.reason === 'peak-not-at-launch'
            ? t('nCcuLatePeak', [String(ccu.daysAfterRelease)])
            : t(CCU_SKIP_KEY[ccu.reason])
        )));
      }));
    }

    // The player-hours route: a cross-check, shown with its divisor named.
    const pt = crossChecks?.playtime;
    if (pt?.ok) {
      panel.append(collapsible(t('sPlaytime'), (body) => {
        body.append(row(t('mPlaytime'), compact(pt.range.mid),
          { sub: `${compact(pt.range.lo)}–${compact(pt.range.hi)}` }));
        body.append(row(t('nPlaytimeDivisor'),
          t('nHours', [pt.reviewerMedianHours.toFixed(0)])));
        body.append(noteNode(t('nPlaytimeScope', [compact(pt.playerHours)])));
      }));
    }

    if (weekOne.ok && weekOne.paths.length) {
      panel.append(collapsible(t('sWeekOne'), (body) => {
        for (const p of weekOne.paths) body.append(row(t(p.labelKey), compact(p.value)));
        if (weekOne.disagreement > 1.5) {
          body.append(el('div', 'note warn', t('nDisagreeRoutes', [weekOne.disagreement.toFixed(1)])));
        }
      }));
    }

    if (revenue.ok) {
      panel.append(collapsible(t('sMoney'), (body) => {
        for (const step of revenue.steps) {
          const params = step.labelKey === 'wfRegional'
            ? [t(REGION_KEY[step.labelParams[0]] ?? 'regionMixed')]
            : step.labelParams;
          body.append(row(t(step.labelKey, params),
            step.delta === 0 ? money(step.value) : money(step.delta),
            { negative: step.delta < 0 }));
        }
        body.append(row(t('wfReaches'),
          [
            money(revenue.net.mid),
            ['\u00b7', 'sep'],
            t('wfOfList', [pct(revenue.takeHomeRatio)])
          ],
          { total: true }));
        body.append(noteNode(splitAround(
          t('wfPerUnit', [money(revenue.netPerUnit)]),
          money(revenue.netPerUnit),
          'hl-revenue'
        )));

        // Where the regional factor came from, when it was read off the
        // review languages rather than chosen in the dropdown.
        const s = revenue.settings;
        if (s?.regionalAuto && s.regionalDerivedFrom?.ok) {
          body.append(noteNode(t('nRegionalAuto', [
            pct(s.regionalDerivedFrom.discountedShare),
            t(REGION_KEY[s.regionalKey] ?? 'regionMixed')
          ])));
        }

        // Which waterfall assumptions widened the band beyond the sales one.
        const env = revenue.envelope;
        if (env) {
          body.append(noteNode(t('nRevenueBand', [
            pct(env.avgDiscount.lo), pct(env.avgDiscount.hi),
            pct(env.refundRate.lo, 1), pct(env.refundRate.hi, 1)
          ])));
        }

        // How many DLC the figure leaves out.
        if (game.dlcCount > 0) {
          body.append(noteNode(t('nDlcExcluded', [String(game.dlcCount)])));
        }
      }));
    }

    if (units.ok && units.boxleiter) {
      panel.append(collapsible(t('sWhy'), (body) => {
        const b = units.boxleiter;
        body.append(row(t('nBaseYear', [game.releaseYear ?? '?']),
          `${b.baseYearBand.lo}\u2013${b.baseYearBand.hi}\u00d7`));
        // `derived` marks an adjustment whose magnitude was chosen here rather
        // than measured by the study behind it.
        let anyDerived = false;
        for (const a of b.applied) {
          if (a.derived) anyDerived = true;
          body.append(row(a.label, `\u00d7${a.factor}${a.derived ? '\u2009*' : ''}`));
        }
        body.append(row(t('nReviewsFinal', [compact(game.reviews)]),
          `${b.multiplier.lo.toFixed(0)}\u2013${b.multiplier.hi.toFixed(0)}\u00d7`, { total: true }));
        if (anyDerived) body.append(el('div', 'note', t('nDerivedMark')));

        const cited = new Set(b.applied.map((a) => a.source).concat(b.baseYearBand.source));
        const chips = el('div');
        for (const key of cited) {
          if (SOURCES[key]) chips.append(el('span', 'chip', SOURCES[key].label.split(' \u2014 ')[0]));
        }
        body.append(chips);
      }));
    }

    panel.append(footNode());

    return panel;
  }

  function footNode() {
    const foot = el('div', 'foot');

    const cog = el('a', null, t('footSettings'));
    cog.tabIndex = 0;
    cog.setAttribute('role', 'button');
    cog.addEventListener('click', () => onOpenOptions?.());
    cog.addEventListener('keydown', (e) => { if (e.key === 'Enter') onOpenOptions?.(); });
    foot.append(cog);

    // The wordmark, with the build that drew these numbers beside it.
    const mark = el('span', 'foot-brand');
    mark.append(el('span', 'pill-brand', BRAND));
    if (VERSION) mark.append(el('span', 'pill-version', VERSION));
    foot.append(mark);

    return foot;
  }

  const collapse = () => { expanded = false; draw(); };

  const onKey = (e) => { if (e.key === 'Escape' && expanded) collapse(); };

  /**
   * Dismiss on a press outside the panel.
   *
   * pointerdown, not click: the press that opens the pill fires while still
   * collapsed, so this returns before the click expands it, and a selection
   * dragged out of the panel starts on the panel and so does not dismiss it.
   *
   * composedPath is required for the boundary test — the overlay lives in a
   * shadow root, and nothing else crosses it reliably.
   */
  const onPointerDown = (e) => {
    if (!expanded) return;
    if (e.composedPath().includes(host)) return;
    collapse();
  };

  document.addEventListener('keydown', onKey);
  document.addEventListener('pointerdown', onPointerDown, true);

  draw();
  return {
    destroy: () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointerDown, true);
      tipLayer = null;
      host.remove();
    }
  };
}
