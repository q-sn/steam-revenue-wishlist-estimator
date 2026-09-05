/**
 * Entry point.
 *
 * Content scripts cannot use static ES imports, so the core is pulled in
 * dynamically from web_accessible_resources. This keeps the estimators as
 * plain ES modules that Node imports unchanged, which is what lets
 * tools/calibrate.mjs test the exact code that ships rather than a
 * reimplementation of it that drifts.
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

  // Language is resolved before anything renders, otherwise the first paint
  // would be in the browser's language and then flicker to the chosen one.
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

  let current = null;
  const paint = () => {
    current?.destroy?.();
    current = renderOverlay(result, {
      history: recorded?.series ?? null,
      delta: recorded?.delta ?? null,
      position: ui.position ?? 'pos-br',
      scale: ui.scale ?? 1.25,
      pill: ui.pill ?? {},
      onOpenOptions: () => chrome.runtime.sendMessage({ type: 'openOptions' })
    });
  };

  paint();

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
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
