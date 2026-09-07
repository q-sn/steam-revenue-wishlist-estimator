/**
 * Page side of the harness: run the extension's own code on a store page.
 *
 * A page script has no extension APIs, so `chrome.i18n` is shimmed from the
 * shipped `_locales/` table and `chrome.runtime.getManifest` from the shipped
 * manifest — the wording and the version in the panel's corner are therefore
 * the ones a user sees. Everything below that line is the real thing:
 * src/core/index.js does the estimating and src/content/overlay.js does the
 * drawing, imported unmodified.
 *
 * The shim has to exist before either import, since i18n.js decides at module
 * load whether chrome.i18n is there; hence every import here is dynamic.
 *
 * Loaded as /screenshots/page.js?appId=...&expanded=1, and it leaves
 * `window.__srwe` behind for shoot.mjs to measure.
 */
const params = new URL(import.meta.url).searchParams;
const ORIGIN = new URL(import.meta.url).origin;
const appId = Number(params.get('appId'));
const locale = params.get('locale') ?? 'en';

const messages = await (await fetch(`${ORIGIN}/_locales/${locale}/messages.json`)).json();
const manifest = await (await fetch(`${ORIGIN}/manifest.json`)).json();

window.chrome = {
  i18n: {
    // Chrome substitutes $1..$9 positionally; so does this.
    getMessage: (key, subs = []) => {
      const message = messages[key]?.message;
      if (message == null) return '';
      const list = Array.isArray(subs) ? subs : [subs];
      return list.reduce((out, value, i) => out.replaceAll(`$${i + 1}`, String(value)), message);
    },
    getUILanguage: () => locale.replace('_', '-')
  },
  runtime: {
    getURL: (path) => `${ORIGIN}/${path}`,
    getManifest: () => manifest,
    sendMessage: () => {}
  },
  // The overlay reads no storage, but options and history handlers exist.
  storage: {
    local: { get: async () => ({}), set: async () => {} },
    onChanged: { addListener: () => {} }
  }
};

const core = await import(`${ORIGIN}/src/core/index.js`);
const { renderOverlay } = await import(`${ORIGIN}/src/content/overlay.js`);

const collected = await (await fetch(`${ORIGIN}/screenshots/inputs/game-${appId}.json`)).json();

/** The fields scrape.js takes from the page rather than from an endpoint. */
function fromDom() {
  const tags = [...document.querySelectorAll('a.app_tag')]
    .map((el) => el.textContent.trim())
    .filter(Boolean)
    .slice(0, 12);

  // Told apart by their tooltips, never by position — the store renders a
  // second responsive copy of both rows in the opposite order.
  const parsed = [...document.querySelectorAll('.user_reviews_summary_row[data-tooltip-html]')]
    .map((row) => core.parseReviewSummary(row.getAttribute('data-tooltip-html')))
    .filter(Boolean);
  const recent = parsed.find((p) => p.windowed);
  const all = parsed.find((p) => !p.windowed);

  return {
    tags: tags.length ? tags : collected.tags,
    reviewTrend: recent && all
      ? { recentPct: recent.pct, recentCount: recent.count, allPct: all.pct, allCount: all.count }
      : null
  };
}

const game = { ...collected, ...fromDom() };
core.setLocale(window.chrome.i18n.getUILanguage());
const result = core.estimateAll(game, {});

renderOverlay(result, {
  position: params.get('position') ?? 'pos-br',
  scale: Number(params.get('scale') ?? 1.25),
  // No trend line: it takes two visits days apart, and a faked series would
  // be the only invented number in these pictures.
  history: null,
  delta: null,
  onOpenOptions: () => {}
});

const host = document.getElementById('srwe-overlay-host');
if (params.get('expanded') === '1') host.shadowRoot.querySelector('.pill').click();

window.__srwe = {
  result,

  /** Open the foldout whose summary contains `label`, or say what is there. */
  open(label) {
    const wanted = label.toLowerCase();
    const hit = [...host.shadowRoot.querySelectorAll('details')]
      .find((d) => d.querySelector('summary')?.textContent.toLowerCase().includes(wanted));
    if (!hit) {
      return [...host.shadowRoot.querySelectorAll('summary')].map((s) => s.textContent).join(' | ');
    }
    hit.open = true;
    return 'opened';
  },

  /**
   * Viewport rect of what is being photographed. `scrollHeight` against
   * `clientHeight` is how the caller learns the panel is taller than the
   * viewport and is showing a scrollbar rather than all of itself.
   */
  box(what = 'panel') {
    const node = what === 'foldout'
      ? [...host.shadowRoot.querySelectorAll('details[open]')].pop()
      : host.shadowRoot.querySelector('.panel') ?? host.shadowRoot.querySelector('.pill');
    const { x, y, width, height } = node.getBoundingClientRect();
    return { x, y, width, height, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight };
  }
};

export default window.__srwe;
