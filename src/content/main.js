/**
 * Entry point. Content scripts cannot use static ES imports, so the core is
 * pulled in dynamically from web_accessible_resources.
 */
(async () => {
  const appId = Number(location.pathname.match(/\/app\/(\d+)/)?.[1]);
  if (!appId) return;

  const [{ collectGame, recordHistory }, { renderOverlay }, { initLocale, uiLanguage }, core] =
    await Promise.all([
      import(chrome.runtime.getURL('src/content/scrape.js')),
      import(chrome.runtime.getURL('src/content/overlay.js')),
      import(chrome.runtime.getURL('src/content/i18n.js')),
      import(chrome.runtime.getURL('src/core/index.js'))
    ]);

  const stored = await chrome.storage.local.get(['settings', 'ui']);
  let settings = stored.settings ?? {};
  let ui = stored.ui ?? {};

  // Must resolve before the first paint, or it renders in the browser
  // language and then flickers to the chosen one.
  await initLocale(ui.language ?? 'auto');
  core.setLocale(uiLanguage());

  let game;
  try {
    game = await collectGame(appId);
  } catch (err) {
    console.warn('[srwe] could not read this page:', err);
    return;
  }

  let result = core.estimateAll(game, settings);

  const snapshot = core.makeSnapshot(game, result);
  const recorded = await recordHistory(appId, snapshot);

  const review = await reviewTracker(core);

  let current = null;
  const paint = () => {
    current?.destroy?.();
    current = renderOverlay(result, {
      history: recorded?.series ?? null,
      delta: recorded?.delta ?? null,
      position: ui.position ?? 'pos-br',
      scale: ui.scale ?? 1.25,
      pill: ui.pill ?? {},
      onOpenOptions: () => chrome.runtime.sendMessage({ type: 'openOptions' }),
      onExpand: review?.noteOpen,
      // Only where the panel has just been useful: an estimate came out.
      reviewAsk: review && {
        wanted: () => Boolean(result.units?.ok || result.wishlists?.ok) && review.wanted(),
        reviewUrl: core.REVIEW_ASK.reviewUrl,
        issuesUrl: core.REVIEW_ASK.issuesUrl,
        onShown: review.noteShown,
        onAnswer: review.noteAnswer
      }
    });
  };

  paint();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[core.REVIEW_ASK.storageKey]) review?.sync(changes[core.REVIEW_ASK.storageKey].newValue);
    if (changes.settings) {
      settings = changes.settings.newValue ?? {};
      result = core.estimateAll(game, settings);
      paint();
    } else if (changes.ui) {
      const previousLanguage = ui.language ?? 'auto';
      ui = changes.ui.newValue ?? ui;
      if ((ui.language ?? 'auto') !== previousLanguage) {
        initLocale(ui.language ?? 'auto').then(() => {
          core.setLocale(uiLanguage());
          paint();
        });
        return;
      }
      paint();
    }
  });
})();

/**
 * The review-ask record, mirrored in memory so the panel can decide
 * synchronously while it draws. Null outside a Chrome Web Store install, which
 * keeps the record from ever being written anywhere else. See
 * src/core/review-ask.js for the rules.
 *
 * Every tab holds a mirror, and each write is of the whole record, so the
 * storage listener in the caller keeps the mirrors in step: a review left from
 * one tab is not undone by a stale counter written from another.
 */
async function reviewTracker(core) {
  const KEY = core.REVIEW_ASK.storageKey;
  const DEV = core.REVIEW_ASK.devFlagKey;
  const kept = await chrome.storage.local.get([KEY, DEV]);
  const allowed = core.mayAskHere(
    chrome.runtime.getManifest(), chrome.runtime.getURL(''), chrome.runtime.id, kept[DEV]);
  if (!allowed) return null;

  let state = kept[KEY];

  if (!state) {
    // First run of this version. Someone updating into it has local history
    // that dates their first use better than today does; read once, ever.
    const all = await chrome.storage.local.get(null);
    let earliest = Date.now();
    for (const [key, series] of Object.entries(all)) {
      if (!key.startsWith('history:') || !Array.isArray(series)) continue;
      for (const point of series) {
        if (Number.isFinite(point?.at) && point.at < earliest) earliest = point.at;
      }
    }
    state = core.newReviewState(Date.now(), earliest);
  }

  const save = (next) => {
    if (next === state) return;
    state = next;
    chrome.storage.local.set({ [KEY]: state }).catch(() => {});
  };

  // A fresh record always has a first visit to count, so it is always written.
  save(core.noteVisit(state));

  return {
    wanted: () => core.shouldAsk(state),
    noteOpen: () => save(core.noteOpen(state)),
    noteShown: () => save(core.noteShown(state)),
    noteAnswer: (answer) => save(core.noteAnswer(state, answer)),
    sync: (value) => { if (value) state = value; }
  };
}
