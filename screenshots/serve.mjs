/**
 * The repository over HTTP, for the length of one screenshot run.
 *
 * A store page imports the overlay from here, which makes every request a
 * cross-origin one from https to loopback: hence the CORS headers, and hence
 * the private-network header, which Chrome preflights for before it will read
 * a file from 127.0.0.1 at all. See the LocalNetworkAccess note in README.md.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png'
};

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-private-network': 'true',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': '*'
};

/**
 * Serve the repository root on a loopback port.
 *
 * @param {number} [port] 0 asks the OS for a free one, which is what the
 *   caller wants: a fixed port collides with a run that did not shut down.
 * @returns {Promise<{port:number, close:() => Promise<void>}>}
 */
export function startServer(port = 0) {
  const server = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS).end();
      return;
    }

    // Paths arrive as URLs and are used as file paths, so `..` is stripped
    // rather than resolved: this serves a source tree to a browser that has
    // just been told to trust it.
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = normalize(path.slice(1)).replace(/^(\.\.[\\/])+/, '');

    try {
      const body = await readFile(join(REPO, rel));
      res.writeHead(200, {
        ...CORS,
        'content-type': TYPES[extname(rel)] ?? 'application/octet-stream',
        // The point of the harness is to photograph the working tree.
        'cache-control': 'no-store'
      }).end(body);
    } catch (err) {
      res.writeHead(404, CORS).end(String(err));
    }
  });

  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => ok({
      port: server.address().port,
      close: () => new Promise((done) => server.close(done))
    }));
  });
}
