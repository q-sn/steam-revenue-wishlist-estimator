import { compact, money, pct, integer } from '../core/format.js';
import { SOURCES, REVIEW_GATES } from '../core/constants.js';
import { sparklinePoints } from '../core/history.js';
import { pillFigures } from '../core/pill.js';
import { comparableScopes } from './scrape.js';
import { t, tr, humanise } from './i18n.js';

const HOST_ID = 'srwe-overlay-host';

/**
 * List separator. A pipe reads as a divider between peers, where an interpunct
 * reads as part of the sentence, and these are peers.
 */
const SEPARATOR_CHAR = '|';
/** Between peer figures in the collapsed row: a divider between equals. */
const SEPARATOR = ` ${SEPARATOR_CHAR} `;
/**
 * Inside a sentence: the clauses belong together, so they get a joiner.
 *
 * Always an element, never a bare text node. At body weight the interpunct
 * disappears between two pieces of text, and its spacing has to be tuned in
 * one place rather than baked into a dozen strings.
 */
const clauseSep = () => el('span', 'sep', '\u00b7');

/**
 * Confidence is spelled out rather than coded into a coloured dot.
 *
 * A 7px circle asks the reader to memorise a legend before the interface means
 * anything. A word carries the same colour and needs no key.
 */
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
/* Amber is the caution colour and nothing else. Blue is the accent, so it
   cannot also mean "treat this with suspicion". */
.conf.fair { color: #ffb02e; }
.conf.low  { color: #e8654f; }
.conf.none { color: #7c8698; }
/* Confidence drops to a quiet second line, freeing the bottom-right corner
   for the wordmark. The figures are what a glance is for; the caveat belongs
   underneath them, not competing with them. */
.pill-meta {
  display: flex; align-items: baseline; justify-content: flex-end; gap: 10px;
  font-size: 10.5px; line-height: 1.2; 
}
.pill-brand { color: #454e60; font-size: 9px; white-space: nowrap; font-weight: 900; opacity: 0.6; text-transform: uppercase; font-style: italic; }
/* The build that produced the figures, in the corner opposite the wordmark.
   Same ink as the mark it belongs to: an identifier to quote in a bug report,
   not something the glance is meant to land on. */
.pill-version { color: #454e60; font-size: 9px; white-space: nowrap; font-weight: 700; opacity: 0.6; font-variant-numeric: tabular-nums; }

/* Figures stack: the reading on top, the verdict for that reading below it. */
.pill-fig { display: flex; flex-direction: column; gap: 1px; }
.pill-fig-sub { font-size: 9px; font-weight: 600; line-height: 1.1; }
.pill-sep { align-self: center; }
/* Applied to any figure with a verdict beneath it, not just units: shrinking
   one cell and not its neighbours would make the row look broken. */
.pill-fig:has(.pill-fig-sub) > span:first-child { font-size: 11px; }

.pill-figures { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.pill-figures b { font-weight: 600; }
/* A pipe is a taller, heavier glyph than the interpunct it replaced, so it is
   dimmed to stay a divider rather than becoming another mark to read. */
.pill-sep { color: #39414f; font-weight: 400; }
/* Steam's own review bands and its own colours for them. The boundary is 70%,
   not 80%: below it a game wears the yellow "Mixed" warning label, above it
   the blue "Mostly Positive" one. Borrowing both the thresholds and the
   palette means the count reads the same here as on the page behind it. */
.rev-positive,  .rev-positive b  { color: #66c0f4; }
.rev-mixed,     .rev-mixed b     { color: #b9a074; }
.rev-negative,  .rev-negative b  { color: #a34c25; }
/* Steam's own in-game green: the figure should look like the state it names. */
.fig-players,   .fig-players b   { color: #7cc53f; }
.fig-wishlists, .fig-wishlists b { color: #66c0f4; }
/* Steam's own primary light steel for the headline count, and its discount
   lime for money: both borrowed from the store so the figures feel native. */
.fig-units,     .fig-units b     { color: #c7d5e0; }
.fig-revenue,   .fig-revenue b   { color: #beee11; }

/* Emphasis inside notes. A note is mostly scaffolding; these mark the one or
   two words in it that actually carry the information. */
.hl { color: #c9d1e0; }
.hl-accent   { color: #66c0f4; }
.hl-players  { color: #7cc53f; }
.hl-positive { color: #66c0f4; }
.hl-mixed    { color: #b9a074; }
.hl-negative { color: #a34c25; }
.hl-revenue  { color: #beee11; }
/* Direction of travel, in the colours SteamCharts uses for the same thing. */
.trend-up   { color: #4ec9a5; }
.trend-down { color: #e8654f; }
.trend-flat { color: #7c8698; }
.em { font-weight: 700; color: #c9d1e0; }

.panel {
  width: 356px; overflow-y: auto;
  /* Frosted glass over the store page. The saturation bump keeps Steam's
     artwork from turning grey once it is blurred. */
  background: rgba(16, 19, 26, .78);
  backdrop-filter: blur(18px) saturate(135%);
  -webkit-backdrop-filter: blur(18px) saturate(135%);
  /* The root is zoomed, so viewport units here render multiplied by that
     factor. Dividing keeps the panel inside the screen instead of sliding
     off the top once the content grows. */
  max-height: calc((100vh - 32px) / var(--zoom, 1));
  /* Reaching the end of this list should stop, not hand the wheel to the
     store page underneath. */
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
/* A flex row on the baseline. As inline text the three parts sat at three
   different font sizes, and vertical-align could only guess where to put the
   dot between them. It also means a long game name truncates on its own
   instead of swallowing the separator and the link with it. */
.title {
  display: flex; align-items: baseline; min-width: 0;
  font-size: 13px; font-weight: 600;
}
.title-name {
  color: #dfe4ee; min-width: 0;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
/* Same size as the text it divides, so the glyph lands exactly where the
   typeface intends relative to the letters on either side. The weight is what
   makes it visible, not the size. */
/* Shared by every clause joiner in the interface, so a divider looks the same
   wherever it appears. */
.sep { color: #6b7688; font-weight: 700; margin: 0 7px; }
.title-sep { flex: none; }
.title-link { flex: none; color: #7c8698; text-decoration: none; font-weight: 400; font-size: 12px; }
.title-link:hover { color: #c9d1e0; text-decoration: underline; }
.title-link:focus-visible { outline: 2px solid #67c1f5; outline-offset: 2px; }
.conf-tag { font-size: 10.5px; font-weight: 600; color: #4b5568; }
.verdict { margin-top: 3px; font-size: 12px; }
.verdict .conf { }
.verdict-why { color: #8b95a8; }
.subtitle { font-size: 11.5px; color: #7c8698; margin-top: 2px; }
.subtitle a, .note a { color: #67c1f5; text-decoration: none; }
.subtitle a:hover, .note a:hover { text-decoration: underline; }
.subtitle a:focus-visible, .note a:focus-visible { outline: 2px solid #67c1f5; outline-offset: 2px; }
.close {
  /* The head centres its text, but the dismiss control belongs in the
     corner, where a close button is looked for. */
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

/* The scale is the hero: bar width reads as uncertainty before any number does. */
.scale { position: relative; height: 22px; }
.track { position: absolute; top: 7px; left: 0; right: 0; height: 4px; background: #1e2431; border-radius: 2px; }
.band { position: absolute; top: 7px; left: 0; right: 0; height: 4px; border-radius: 2px;
        background: linear-gradient(90deg, #2c5f80, #67c1f5, #2c5f80); }
.band.wide { background: linear-gradient(90deg, #6b2a1f, #e8654f, #6b2a1f); }
.marker { position: absolute; top: 3px; width: 3px; height: 12px; background: #cfeaff; border-radius: 1px; transform: translateX(-1.5px); }
/* A 2px mark is impossible to hover, so it sits inside a target big enough to
   hit without aiming: full row height and wide enough for an imprecise mouse. */
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

/* Anchored to the viewport rather than to the row, because the panel scrolls
   and a scroll container clips its children on both axes. */
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

/**
 * The wordmark shown in the corner of the collapsed pill. Deliberately quiet:
 * it should be legible on a stream without competing with the figures.
 */
const BRAND = 'Wishlytic';

/**
 * The shipped version, taken from the manifest so it cannot drift from the
 * build the reader is actually running. Empty outside the extension — the
 * overlay is also read in Node by the smoke tests, where chrome does not
 * exist — and both places that show it fall back to showing nothing.
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
  if (key === 'net') return 'fig-revenue';
  return null;
}

/** Map a sentiment class onto its note-highlight counterpart. */
function toneHighlight(tone) {
  return tone ? tone.replace('rev-', 'hl-') : 'hl';
}

/**
 * Emphasise one substring inside an already-translated sentence.
 * Word order differs by language, so the marker is located rather than
 * assumed to sit at the front.
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
  // Nothing to report is not a verdict. Printing "no data" beside a figure
  // that is right there says less than saying nothing.
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
 * Tooltips live in a layer outside the panel.
 *
 * The panel scrolls, and a scroll container clips on both axes, so a tooltip
 * rendered inside a row gets cut off at the panel edge exactly when it has
 * something to say. Anchoring it to the viewport instead sidesteps that.
 *
 * The root carries a CSS zoom, which multiplies the coordinates of fixed
 * descendants while getBoundingClientRect keeps reporting real viewport
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
 * A labelled range scale, optionally with tick marks showing where each
 * individual estimator landed. Seeing two ticks far apart inside one band is
 * the clearest possible signal that the midpoint is doing a lot of work.
 */
function scale(range, fmt, { ticks = [], wide = false } = {}) {
  const wrap = el('div', 'scale');
  wrap.append(el('div', 'track'));

  const span = Math.max(range.hi - range.lo, 1e-9);
  const posOf = (v) => Math.min(Math.max((v - range.lo) / span, 0), 1);

  wrap.append(el('div', `band${wide ? ' wide' : ''}`));

  // Each tick is where one estimator landed on its own. Two ticks far apart
  // inside a single band is the clearest possible sign that the midpoint is
  // doing a lot of work, but only if you can find out what they are.
  for (const tick of ticks) {
    if (!Number.isFinite(tick.value)) continue;
    const hit = el('div', 'tick-hit');
    hit.style.left = `${posOf(tick.value) * 100}%`;
    hit.append(el('div', 'tick'));

    const text = `${tr(tick.label)}: ${fmt(tick.value)}`;
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
  // The verdict belongs to the figure it describes. One word for the whole
  // panel would have to be wrong about at least one of three numbers that
  // rest on different evidence.
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
  // Reasons sit under the figure they are about, and only there: repeating
  // them in the panel header means reading the same sentence twice on the way
  // to the number it describes.
  for (const reason of opts.reasons ?? []) box.append(reasonNode(reason, 'note warn'));
  return box;
}

/**
 * Notes take either a string or an array of pieces, so a sentence can carry
 * emphasis on the words that matter without every call site building DOM.
 * A piece is a plain string, or [text, className].
 */
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
 * Turn a translated sentence into nodes, emphasising the parts that carry the
 * information: any `**marked**` span, plus every substitution value, since a
 * reason like "methods disagree by 5.4x" is really about the 5.4.
 */
function richText(sentence, emphasise = []) {
  const pieces = [];
  let rest = String(sentence);

  // Explicit markers first, so a translator can emphasise a fixed phrase.
  const marked = rest.split(/\*\*(.+?)\*\*/s);
  for (let i = 0; i < marked.length; i++) {
    if (i % 2 === 1) pieces.push([marked[i], 'em']);
    else if (marked[i]) pieces.push(marked[i]);
  }

  if (!emphasise.length) return pieces;

  // Then the dynamic values, split out of whichever plain piece holds them.
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
  // Only a reason that actually caused a downgrade gets its number picked out.
  // Bolding the figure in "band spans 2.4x" or "2 methods combined" makes
  // routine description look like an alarm.
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
 * A measured fact, not an estimate: no scale, no error bars. Facts and
 * inferences must not look alike, so anything without uncertainty is rendered
 * without the bar that represents uncertainty.
 */
function fact(name, value, fmt, note, delta, valueClass) {
  const box = el('div', 'metric');
  const head = el('div', 'metric-head');
  head.append(el('span', 'metric-name', name));
  // Facts carry no verdict: they are measured, not inferred.

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
 * A statement about the page, with no figure and no label.
 *
 * Distinct from `unavailable`, which says "this number is missing and here is
 * why". On a soundtrack or a controller there is no missing number: heading
 * the sentence with "Units sold —" would invent the expectation it then
 * has to deny.
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
 * What the wishlist figure was read from, in one line.
 *
 * Both signals get named when both answered, because the number is their
 * average and a caption that mentions one of them describes a different
 * estimate than the one on screen. When the ranking has nothing to say, the
 * reason it has nothing to say is itself worth a clause: absence from the
 * ordering is a ceiling, and a reader who knows the list stops around ten
 * thousand knows more than one who is told nothing.
 */
function wishlistNote(w) {
  const pieces = [];

  if (w.followers != null && w.multiplier != null) {
    const sentence = w.contextKey !== 'unknown'
      ? t('nFromFollowers', [integer(w.followers), t(CONTEXT_KEY[w.contextKey])])
      : w.genre
        ? t('nFromFollowersGenre', [
            integer(w.followers), w.genre.label, w.genre.multiplier.toFixed(1)
          ])
        : t('nFromFollowersOnly', [integer(w.followers)]);
    pieces.push(...asPieces(splitAround(sentence, integer(w.followers), 'hl-accent')));
  }

  if (w.rank) {
    if (pieces.length) pieces.push(' · ');
    const rank = integer(w.rank.rank);
    pieces.push(...asPieces(splitAround(
      t('nWishlistRank', [rank, integer(w.rank.listed), (w.rank.percentile * 100).toFixed(1)]),
      rank,
      'hl-accent'
    )));
  } else if (w.ceiling != null) {
    if (pieces.length) pieces.push(' · ');
    pieces.push(t('nWishlistBelowList', [compact(w.ceiling)]));
  }

  return pieces;
}

/**
 * Why the player-count cross-check is not showing.
 *
 * Only the cases where something is knowably absent. `no-ccu` is not here: a
 * game with no concurrent players on record needs no explanation for the
 * absence of a figure derived from them.
 */
const CCU_SKIP_KEY = {
  'peak-not-at-launch': 'nCcuLatePeak',
  'peak-date-unknown': 'nCcuNoPeakDate'
};

/**
 * A refusal that names a threshold takes it from the constant, so lowering the
 * gate cannot leave a stale number sitting in twelve translations.
 */
const REASON_PARAMS = {
  'too-few-reviews': () => [integer(REVIEW_GATES.MIN_REVIEWS)]
};

/**
 * Why this kind of store page gets no estimate. One sentence each, because
 * they are declined for genuinely different reasons — see APP_TYPES — and a
 * single "not supported" would flatten the one distinction that matters to a
 * reader: whether the figure is impossible or merely unmeasured.
 */
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
  // One knob scales text, padding, controls and the scale bars together, so
  // nothing drifts out of proportion at larger sizes.
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

    // A verdict belongs under the figure it judges. One word for the row
    // would have to describe three numbers that rest on different evidence,
    // and measured facts like the review count take no verdict at all.
    const CONF_FOR = { units: 'units', net: 'revenue', wishlists: 'wishlists' };

    for (const item of items) {
      if (figs.childNodes.length) figs.append(el('span', 'pill-sep', SEPARATOR_CHAR));

      const cell = el('div', 'pill-fig');
      const line = el('span', figureClass(item.key, game));
      line.append(
        el('b', null, (FORMATTERS[item.format] ?? compact)(item.value)),
        document.createTextNode(' ' + t(item.labelKey))
      );
      cell.append(line);

      // Estimates carry a verdict underneath; measured figures carry their
      // direction of travel. Either way the second line says something about
      // the number above it rather than repeating it.
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
   * Reviews are measured, not inferred, so they render without a scale: the
   * band is what distinguishes an estimate from a fact, and putting one under
   * a known number would make the whole visual language meaningless.
   */
  /**
   * Change in positive share, in percentage points.
   *
   * Shared by the collapsed row and the panel: two views of one figure that
   * disagreed would be worse than showing it once.
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

    // Which lifetime share to pair with the recent one.
    //
    // The page's own rows are preferred when they cover the same population.
    // They do not on every game: Steam scopes the lifetime row to the reader's
    // language while leaving the recent row across all of them, which is how
    // Apex Legends ends up showing English-only 76% beside an all-language
    // recent score. Where that happens our own all-language share is used
    // instead — still comparable with the recent figure, because both count
    // every language.
    const fromPage = rt && Number.isFinite(rt.recentPct) && comparableScopes(rt, game.reviews);
    const lifetimePct = fromPage ? rt.allPct : game.positivePct;
    const pp = reviewTrendPp();

    // No caption between the count and the shares: floating there it read as a
    // heading for the percentages rather than a qualifier on the number above
    // it. What it said now hangs off the count itself.
    const box = fact(t('mReviews'), game.reviews, integer, null,
      delta?.reviews, sentimentClass(lifetimePct));
    box.title = t('nReviewScope');

    // Both shares get their own row in the value column, so they line up with
    // each other and with every other figure in the panel.
    if (Number.isFinite(lifetimePct)) {
      box.append(subFact(t('mPositiveAllTime'), `${Math.round(lifetimePct)}%`,
        sentimentClass(lifetimePct)));
    }

    if (rt && Number.isFinite(rt.recentPct)) {
      // The delta always comes from the two numbers printed above and below
      // it, so it can be checked by eye.
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

  /**
   * Live and yesterday's peak player counts. Both are measured, so neither
   * gets a scale. The note explains when the derived week-one figure is
   * withheld, because a missing cross-check should say why it is missing.
   */
  function playersFact() {
    const now = game.currentPlayers;
    const peak = game.peak24h;
    const allTime = game.allTimePeak;

    const hasLive = Number.isFinite(now) && now > 0;
    const hasPeak = Number.isFinite(peak) && peak > 0;
    const hasAllTime = Number.isFinite(allTime) && allTime > 0;

    // A zero never becomes the headline. An unreleased game has nobody
    // playing by definition, and "Players right now: 0" states that as though
    // it were a finding.
    if (!hasLive && !hasPeak && !hasAllTime) return document.createDocumentFragment();

    const headline = hasLive
      ? { label: t('mPlayers'), value: now }
      : hasPeak
        ? { label: t('mPeak24h'), value: peak }
        : { label: t('mAllTimePeak'), value: allTime };

    const box = fact(headline.label, headline.value, integer, null, null, 'fig-players');

    // Rows below the headline, skipping whichever figure is already up there.
    // A zero peak beside live players is kept: for a small game "nobody
    // peaked in 24 hours" is a reading, not a gap.
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
    // SteamDB sits with the title because it points at the same subject: the
    // raw first-party record for this game, one click from our reading of it.
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

    // The title, the SteamDB link and every figure below refer to the full
    // game, because that is what was collected. Saying so is not optional:
    // the reader is looking at a demo page and would otherwise reasonably
    // read the numbers as the demo's.
    if (game.viaDemo) {
      ht.append(el('div', 'subtitle', t('nViaDemo')));
    } else if (game.fullGameId && game.fullGameName) {
      // A declined type that belongs to something. Naming the game turns a
      // dead end into one click.
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

    // A page that is not a game gets the one fact that applies to it. The
    // three metric rows would otherwise carry the same sentence three times,
    // and the measured-input rows below them would describe a soundtrack or a
    // controller as though it were a game with a slow launch.
    if (units.reason === 'unsupported-type') {
      panel.append(notice(reasonText(units, 'wUnsupportedType')));
      panel.append(footNode());
      return panel;
    }

    // Order: the answer first, then the evidence behind it. Estimates lead
    // because they are what the panel is for; the measured inputs follow so a
    // reader can check the working without wading through it to reach the
    // conclusion.
    //
    // Before release there are no sales, so units, revenue and reviews are not
    // withheld figures to be explained — they are categories that do not exist
    // yet. Rendering three "no data" rows for them describes our plumbing
    // rather than the game.
    if (game.released) {
      if (units.ok) {
        const ticks = (units.contributors ?? []).map((c) => ({ label: c.label, value: c.range.mid }));
        panel.append(metric(t('mUnits'), units.range, compact, {
          valueClass: 'fig-units',
          confidence: confidence.units,
          ticks: ticks.length > 1 ? ticks : [],
          wide: units.widened,
          delta: delta?.units,
          // Only the reasons that cost something. The purely descriptive ones
          // stay in the verdict tooltip rather than crowding the figure.
          reasons: (confidence.units.reasons ?? []).filter((r) => (r.severity ?? 0) >= 1)
        }));
      } else {
        panel.append(unavailable(t('mUnits'), reasonText(units, 'wNoEstimators')));
      }

      if (revenue.ok) {
        panel.append(metric(t('mRevenue'), revenue.net, money,
          { valueClass: 'fig-revenue', confidence: confidence.revenue }));
      } else {
        panel.append(unavailable(t('mRevenue'), reasonText(revenue, 'wNoPrice')));
      }
    }

    if (wishlists.ok) {
      // Two legs put two marks on the scale, the same way the unit estimate
      // does. Seeing how far apart the follower ratio and the store ranking
      // landed before they were averaged is the point of having both.
      const wishlistTicks = (wishlists.contributors ?? [])
        .map((c) => ({ label: c.label, value: c.range.mid }));

      panel.append(metric(t('mWishlists'), wishlists.range, compact, {
        valueClass: 'fig-wishlists',
        confidence: confidence.wishlists,
        ticks: wishlistTicks.length > 1 ? wishlistTicks : [],
        wide: wishlists.widened,
        // A follower delta pushed through the follower ratio, so it only
        // exists while that leg does. On a game with no readable follower
        // count the ranking answers alone and there is nothing to compare
        // against the last visit.
        delta: delta?.followers != null && wishlists.multiplier != null
          ? delta.followers * wishlists.multiplier
          : null,
        note: wishlistNote(wishlists),
        reasons: (confidence.wishlists.reasons ?? []).filter((r) => (r.severity ?? 0) >= 1)
      }));
    } else if (wishlists.reason === 'released' && wishlists.followers != null) {
      // The game shipped, so there is no honest wishlist figure. The follower
      // count is real public data though, so show that rather than a dash.
      panel.append(fact(t('mFollowers'), wishlists.followers, integer, t('wReleased'), delta?.followers));
    } else if (wishlists.ceiling != null) {
      // No follower count and not in the ordering. There is no estimate, but
      // "below roughly this many" is a real answer and a better one than a
      // dash — it is the only case where absence from a list is the finding.
      panel.append(unavailable(
        t('mWishlists'),
        t('nWishlistBelowList', [compact(wishlists.ceiling)])
      ));
    } else {
      panel.append(unavailable(t('mWishlists'), reasonText(wishlists, 'wNoFollowers')));
    }

    if (game.released) panel.append(reviewsFact());
    panel.append(playersFact());

    // Measured, and about the demo rather than the game — so it sits with the
    // inputs and carries no verdict.
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

        // Where the methods actually agree, which is the useful thing to know
        // when their midpoints sit far apart. A source that answers in wide
        // buckets has a midpoint pinned to a bucket edge rather than to the
        // game, so the overlap between the bands says more than the distance
        // between their centres does.
        if (units.common) {
          body.append(noteNode(t('nCommonRegion',
            [compact(units.common.lo), compact(units.common.hi)])));
        } else if (units.contributors.length > 1) {
          body.append(noteNode(t('nNoCommonRegion', [units.gap.toFixed(1)]), true));
        }
      }));
    }

    // The player-count cross-check, or the reason there isn't one. A missing
    // cross-check that says nothing reads as a feature we forgot to build;
    // "the peak came two years after launch, so the rule does not apply" is
    // the more useful half of the answer.
    const ccu = crossChecks?.ccu;
    if (ccu?.ok) {
      panel.append(collapsible(t('sCcu'), (body) => {
        // The multiplier is whichever one actually ran \u2014 it changes with
        // pre-order history \u2014 so it comes from the result, not from a string.
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

    // The player-hours route. A cross-check rather than a leg of the average,
    // because the hours are measured and the divisor is not — so it is shown
    // with the divisor named, which is the only honest way to show it.
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

        // Where the regional factor came from. An audience split read off the
        // review languages is a measurement the reader can check against
        // their own knowledge of the game; a dropdown default is not.
        const s = revenue.settings;
        if (s?.regionalAuto && s.regionalDerivedFrom?.ok) {
          body.append(noteNode(t('nRegionalAuto', [
            pct(s.regionalDerivedFrom.discountedShare),
            t(REGION_KEY[s.regionalKey] ?? 'regionMixed')
          ])));
        }

        // The band around the revenue figure is not the sales band converted
        // into money — the waterfall's own assumptions widen it — so it says
        // which ones and by how much.
        const env = revenue.envelope;
        if (env) {
          body.append(noteNode(t('nRevenueBand', [
            pct(env.avgDiscount.lo), pct(env.avgDiscount.hi),
            pct(env.refundRate.lo, 1), pct(env.refundRate.hi, 1)
          ])));
        }

        // What the figure leaves out, counted. "DLC is not estimated" is a
        // caveat; "this excludes 11 DLC" tells the reader how much of the
        // game's income the number might be missing.
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
        // Adjustments whose size we chose ourselves are marked. The study
        // behind them established that the effect exists and left the
        // magnitude for later, and a reader auditing the chain deserves to
        // know which links are measured and which are our judgement.
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

    // The wordmark, with the build that drew these numbers beside it. A reader
    // reporting a figure that looks wrong can say which version produced it
    // without going hunting through chrome://extensions. Separated by a gap
    // rather than a glyph: two labels that are already distinct in weight and
    // colour do not need a mark between them to be read as two things.
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
   * pointerdown rather than click, for two reasons. The press that opens the
   * pill fires pointerdown while still collapsed, so the handler returns
   * before the click expands it — no stopPropagation needed anywhere. And a
   * text selection that starts inside the panel and ends outside it begins
   * with a press on the panel, so dragging out does not close what you are
   * reading from.
   *
   * composedPath is what makes the boundary test work: everything the overlay
   * draws lives in a shadow root, and the path is the only view that crosses
   * it reliably.
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
