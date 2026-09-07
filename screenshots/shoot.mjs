/**
 * One picture of the overlay, on the store page it belongs on.
 *
 * The browser is in browser.mjs; what is here is everything specific to
 * photographing a Steam page: the two permissions the store's own headers
 * would otherwise refuse, the language it answers in, and the crop.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { withPage, sleep } from './browser.mjs';

/**
 * Take one screenshot.
 *
 * @param {object} shot
 * @param {number} shot.appId          the store page to open, and the inputs to draw
 * @param {string} shot.out            PNG path
 * @param {number} shot.port           the harness server's port
 * @param {boolean} [shot.expanded]    open the panel rather than leaving the pill
 * @param {string} [shot.open]         substring of a foldout's summary to unfold
 * @param {'panel'|'foldout'|number[]} [shot.clip]
 *   what to crop to: the whole overlay, one unfolded section, or a literal
 *   [x, y, width, height] region of the viewport for a shot that is meant to
 *   show the page around it
 * @param {[number, number]} [shot.pad]  horizontal and vertical margin, in CSS px
 * @param {string} [shot.position]     pos-br | pos-bl | pos-tr | pos-tl
 * @param {number} [shot.scale]        the overlay's own zoom; 1.25 is the default
 * @param {{width:number,height:number}} [shot.viewport]
 * @param {number} [shot.deviceScaleFactor]  2, for a picture a README renders
 *   at half its width
 * @param {string} [shot.locale]
 */
export async function shoot({
  appId,
  out,
  port,
  expanded = false,
  open = null,
  clip = 'panel',
  pad = [24, 24],
  position = 'pos-br',
  scale = 1.25,
  viewport = { width: 1440, height: 1500 },
  deviceScaleFactor = 2,
  locale = 'en',
  url = `https://store.steampowered.com/app/${appId}/`
}) {
  const png = await withPage({
    viewport,
    deviceScaleFactor,
    // The store page is on the public internet and the overlay is on
    // loopback, which Chrome treats as a private network and refuses to reach
    // without a permission. The grant below is the other half.
    flags: ['--disable-features=Translate,MediaRouter,LocalNetworkAccessChecks,LocalNetworkAccessPermission']
  }, async (cdp) => {
    await cdp.send('Network.enable');
    // Steam sends script-src 'self', which would refuse the overlay.
    await cdp.send('Page.setBypassCSP', { enabled: true });
    await cdp.send('Browser.grantPermissions', {
      origin: new URL(url).origin,
      permissions: ['localNetworkAccess']
    }).catch(() => { /* older Chrome: the launch flag is enough */ });
    // A page in the reader's language under a panel in English is nobody's
    // screenshot. The store follows both of these.
    await cdp.send('Network.setExtraHTTPHeaders', {
      headers: { 'Accept-Language': 'en-US,en;q=0.9' }
    });
    await cdp.send('Network.setCookie', {
      name: 'Steam_Language', value: 'english', domain: '.steampowered.com', path: '/'
    });

    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url });
    await Promise.race([loaded, sleep(30_000)]);
    // Artwork, fonts and the store's own scripts.
    await sleep(3500);

    const landed = await cdp.eval('location.href');
    if (/agecheck|login/.test(landed)) throw new Error(`page gated: ${landed}`);

    // Hidden, not answered: the consent bar and the "you're not signed in"
    // banner are artefacts of photographing from a fresh profile, and a
    // screenshot has no business clicking either one.
    await cdp.eval(`(() => {
      const sel = ['.cookiepreferences_popup', '#cookiepreferences_notice',
                   '.cookiepreferences_notice', '#footer_notice_cookies',
                   '.responsive_page_menu_ctn', '.banner_open_in_steam'];
      for (const s of sel) for (const el of document.querySelectorAll(s)) {
        el.style.display = 'none';
      }
      return true;
    })()`);

    const query = new URLSearchParams({
      appId: String(appId),
      expanded: expanded ? '1' : '0',
      scale: String(scale),
      position,
      locale
    });
    const ready = await cdp.eval(
      `import('http://127.0.0.1:${port}/screenshots/page.js?${query}').then(() => 'ok')`
    );
    if (ready !== 'ok') throw new Error('the overlay did not render');

    if (open) {
      const opened = await cdp.eval(`window.__srwe.open(${JSON.stringify(open)})`);
      if (opened !== 'opened') throw new Error(`no foldout matching "${open}". Present: ${opened}`);
    }

    // The blur behind the panel samples the page, so it needs the frame after
    // the fold as well as the artwork.
    await sleep(1200);

    const box = await cdp.eval(`window.__srwe.box(${JSON.stringify(
      clip === 'foldout' ? 'foldout' : 'panel'
    )})`);
    if (box.scrollHeight > box.clientHeight + 2) {
      console.warn(`  ! the panel is scrolling (${box.scrollHeight} > ${box.clientHeight}px):`
        + ' raise the viewport height or the shot will be cut off');
    }

    return cdp.png(Array.isArray(clip)
      ? { x: clip[0], y: clip[1], width: clip[2], height: clip[3], scale: 1 }
      : {
          x: Math.max(0, Math.round(box.x - pad[0])),
          y: Math.max(0, Math.round(box.y - pad[1])),
          width: Math.min(viewport.width, Math.round(box.width + pad[0] * 2)),
          height: Math.min(viewport.height, Math.round(box.height + pad[1] * 2)),
          scale: 1
        });
  });

  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, png.data);
  return { path: out, width: png.width, height: png.height, bytes: png.data.length };
}
