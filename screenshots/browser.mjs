/**
 * A headless Chrome, driven over CDP, for the length of one page.
 *
 * CDP rather than a browser-automation library because this repository ships
 * no dependencies and will not install one to take a picture. What it needs
 * from a browser is small: a viewport, a navigation, an evaluate and a
 * capture.
 */
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Where Chrome is, in the order of the platforms this repo gets developed on. */
function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium'
  ].filter(Boolean);

  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(`no Chrome found. Tried:\n  ${candidates.join('\n  ')}\n`
      + 'Set CHROME_PATH to the binary.');
  }
  return found;
}

/** Minimal CDP client over one page target's WebSocket. */
export class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.lastId = 0;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null) {
        const slot = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) slot?.reject(new Error(JSON.stringify(msg.error)));
        else slot?.resolve(msg.result);
      } else {
        for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params);
      }
    });
  }

  static async open(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((ok, fail) => {
      ws.addEventListener('open', ok, { once: true });
      ws.addEventListener('error', fail, { once: true });
    });
    return new Cdp(ws);
  }

  send(method, params = {}) {
    const id = ++this.lastId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  once(method) {
    return new Promise((resolve) => {
      const fn = (params) => {
        this.listeners.set(method, (this.listeners.get(method) ?? []).filter((f) => f !== fn));
        resolve(params);
      };
      this.listeners.set(method, [...(this.listeners.get(method) ?? []), fn]);
    });
  }

  /** Evaluate in the page, awaiting promises, and rethrow page exceptions. */
  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true
    });
    if (res.exceptionDetails) {
      throw new Error(res.exceptionDetails.exception?.description
        ?? res.exceptionDetails.text ?? 'page exception');
    }
    return res.result?.value;
  }

  /**
   * A PNG of the current frame. Chrome writes 24-bit RGB for an opaque page
   * and RGBA for one that lets the background through — which the Chrome Web
   * Store rejects — so the colour type is checked rather than assumed.
   */
  async png(clip) {
    const shot = () => this.send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) });
    // The first frame after a render has come back stale; the second cannot.
    await shot();
    const png = Buffer.from((await shot()).data, 'base64');
    return {
      data: png,
      width: png.readUInt32BE(16),
      height: png.readUInt32BE(20),
      // IHDR: bit depth at byte 24, colour type at 25. 2 is RGB, 6 is RGBA.
      colourType: png[25]
    };
  }
}

/** One debugging port per launch: reusing it races the last Chrome's exit. */
let nextDebugPort = 9500 + (process.pid % 300) * 5;

/**
 * Run `fn` against a fresh headless Chrome, then close it.
 *
 * @param {object} opts
 * @param {{width:number, height:number}} opts.viewport
 * @param {number} [opts.deviceScaleFactor] 2 for a picture something will
 *   render at half its width; 1 where the pixel size is the specification.
 * @param {string[]} [opts.flags] extra command line, for what one page needs
 * @param {(cdp: Cdp) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
export async function withPage({ viewport, deviceScaleFactor = 2, flags = [] }, fn) {
  const profile = await mkdtemp(join(tmpdir(), 'srwe-shot-'));
  const port = nextDebugPort++;

  const chrome = spawn(chromePath(), [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    `--window-size=${viewport.width},${viewport.height}`,
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    '--font-render-hinting=none',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--lang=en-US',
    ...flags,
    'about:blank'
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  // Chrome talks about GCM registration and GPU fallbacks on every start.
  chrome.stderr.on('data', (b) => {
    const line = String(b);
    if (/ERROR/.test(line) && !/gcm|GCM|DEPRECATED_ENDPOINT|Authentication|GPU|voice/.test(line)) {
      process.stderr.write(`  chrome: ${line}`);
    }
  });

  try {
    let target = null;
    for (let i = 0; i < 80 && !target; i++) {
      try {
        const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
        target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      } catch { /* the port is not open yet */ }
      if (!target) await sleep(250);
    }
    if (!target) throw new Error('Chrome never opened a debugging port');

    const cdp = await Cdp.open(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      ...viewport, deviceScaleFactor, mobile: false
    });

    try {
      return await fn(cdp);
    } finally {
      cdp.ws.close();
    }
  } finally {
    chrome.kill();
    await sleep(400);
    // A profile that will not delete is a stale temp folder, not a failed
    // screenshot.
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}
