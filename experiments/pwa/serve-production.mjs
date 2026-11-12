// Temporary loopback-only production-build harness. No cookies or writes reach
// the real API. Private fixtures are synthetic; this is not a deployment.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../artifacts/solid-ai-remix/dist/public/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const port = Number(process.argv[2] || 4179);
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const path = decodeURIComponent(url.pathname);
    if (path.startsWith('/__pwa_test/private/')) {
      res.setHeader('Content-Type', path.endsWith('.html') ? 'text/html' : 'application/octet-stream');
      res.end(path.endsWith('.html') ? '<!doctype html><title>Synthetic private fixture</title><p>PWA_TEST_PRIVATE_NOT_FOR_CACHE</p>' : 'PWA_TEST_PRIVATE_NOT_FOR_CACHE');
      return;
    }
    if (path.startsWith('/api/')) {
      if (path === '/api/pwa-test-private') {
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ marker: 'PWA_TEST_PRIVATE_NOT_FOR_CACHE' }));
        return;
      }
      // Read-only anonymous proxy; deliberately forward no browser credentials.
      const upstream = await fetch(new URL(path + url.search, 'http://127.0.0.1:80'), { redirect: 'manual' });
      res.writeHead(upstream.status, { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' });
      res.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    let file = resolve(root, '.' + path);
    const boundary = root.endsWith(sep) ? root.slice(0, -1) : root;
    if (file !== boundary && !file.startsWith(boundary + sep)) { res.writeHead(403).end(); return; }
    try { if (!(await stat(file)).isFile()) file = resolve(root, 'index.html'); }
    catch {
      // Match the real SPA fallback only for document requests, not missing SW
      // scripts, icons or assets (which must fail visibly).
      if ((req.headers.accept || '').includes('text/html')) file = resolve(root, 'index.html');
      else { res.writeHead(404).end(); return; }
    }
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(await readFile(file));
  } catch {
    res.writeHead(502).end('Test harness upstream or file unavailable');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`PWA production test harness: http://127.0.0.1:${port}/studio`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit()));
