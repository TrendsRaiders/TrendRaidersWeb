// Minimal static host that mimics the Netlify behaviors the site relies on:
// directory index.html, redirect to trailing slash, and /404.html with a 404 status.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

export async function serve(dir) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://x');
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(dir, rel);
    try {
      let st = await stat(file).catch(() => null);
      if (st?.isDirectory()) {
        if (!url.pathname.endsWith('/')) { res.writeHead(301, { location: `${url.pathname}/` }); res.end(); return; }
        file = join(file, 'index.html');
        st = await stat(file).catch(() => null);
      }
      if (!st) throw new Error('missing');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(await readFile(file));
    } catch {
      const body = await readFile(join(dir, '404.html')).catch(() => Buffer.from('not found'));
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r(undefined))) };
}
