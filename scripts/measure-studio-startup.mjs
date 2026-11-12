// Controlled production-build benchmark. No credentials, real users or writes.
// Usage: node scripts/measure-studio-startup.mjs BUILD_DIR OUTPUT_JSON [RUNS]
import { createServer } from 'node:http';
import { readFile, stat, mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname, dirname, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const [buildDir, outputFile, count = '5'] = process.argv.slice(2);
assert(buildDir && outputFile, 'Provide build directory and output JSON');
const root = resolve(buildDir);
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    // Fixed anonymous session isolates download/parse/render from DB latency.
    if (pathname === '/api/studio/session') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ authenticated: false, configured: true }));
    }
    if (pathname.startsWith('/api/')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end('{"error":"Unauthorized benchmark fixture"}');
    }
    let file = resolve(root, `.${decodeURIComponent(pathname)}`);
    if (!file.startsWith(root + sep)) file = resolve(root, 'index.html');
    try { if (!(await stat(file)).isFile()) throw new Error(); }
    catch { file = resolve(root, 'index.html'); }
    const content = await readFile(file);
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html',
      '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' }[extname(file)] || 'application/octet-stream';
    const compress = /text|json|svg/.test(type);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store',
      ...(compress ? { 'Content-Encoding': 'gzip' } : {}) });
    res.end(compress ? gzipSync(content) : content);
  } catch {
    res.writeHead(500); res.end('Benchmark server error');
  }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(resolve(tmpdir(), 'studio-startup-'));
const chrome = spawn(process.env.CHROMIUM_BIN || 'chromium', [
  '--headless', '--no-sandbox', '--disable-dev-shm-usage', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });
let ws;
try {
  const endpoint = await new Promise((done, reject) => {
    let log = '';
    const timeout = setTimeout(() => reject(new Error('Chromium startup timed out')), 15000);
    chrome.on('error', reject);
    chrome.stderr.on('data', chunk => {
      log += chunk;
      const found = log.match(/DevTools listening on (ws:\/\/\S+)/);
      if (found) { clearTimeout(timeout); done(found[1]); }
    });
  });
  ws = new WebSocket(endpoint);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
    } else for (const fn of listeners) fn(msg);
  });
  function cdp(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const key = ++id;
      pending.set(key, { resolve, reject });
      ws.send(JSON.stringify({ id: key, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  const samples = [];
  for (let i = 0; i < Number(count); i++) {
    const { browserContextId } = await cdp('Target.createBrowserContext');
    const { targetId } = await cdp('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp('Target.attachToTarget', { targetId, flatten: true });
    const commands = (method, params) => cdp(method, params, sessionId);
    const requests = [];
    const errors = [];
    const listener = msg => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Network.requestWillBeSent') {
        const url = new URL(msg.params.request.url);
        requests.push({ path: url.origin === origin ? url.pathname : `${url.origin}${url.pathname}`, type: msg.params.type });
      }
      if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.text);
    };
    listeners.add(listener);
    await commands('Network.enable');
    await commands('Runtime.enable');
    await commands('Page.enable');
    await commands('Network.setCacheDisabled', { cacheDisabled: true });
    // Avoid third-party font variance; system fallback is identical in both builds.
    await commands('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*'] });
    await commands('Network.emulateNetworkConditions', {
      offline: false, latency: 150, downloadThroughput: 1_600_000 / 8,
      uploadThroughput: 750_000 / 8, connectionType: 'cellular4g',
    });
    await commands('Emulation.setCPUThrottlingRate', { rate: 4 });
    await commands('Emulation.setDeviceMetricsOverride', {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    await commands('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__studioReady = new Promise(resolve => {
        const observer = new MutationObserver(() => {
          const input = document.querySelector('[data-testid="input-studio-password"]');
          if (input && !input.disabled) {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())));
            observer.disconnect();
          }
        });
        observer.observe(document, {childList:true, subtree:true, attributes:true});
        setTimeout(() => resolve(null), 30000);
      });
    ` });
    await commands('Page.navigate', { url: `${origin}/studio` });
    const ready = await commands('Runtime.evaluate', {
      expression: 'window.__studioReady', awaitPromise: true, returnByValue: true,
    });
    assert.equal(typeof ready.result.value, 'number', 'Password gateway did not become ready');
    const metrics = await commands('Runtime.evaluate', { returnByValue: true, expression: `JSON.stringify({
      paints: performance.getEntriesByType('paint').map(p=>({name:p.name,ms:p.startTime})),
      scripts: performance.getEntriesByType('resource').filter(r=>new URL(r.name).pathname.endsWith('.js'))
        .map(r=>({path:new URL(r.name).pathname,encodedBytes:r.encodedBodySize,decodedBytes:r.decodedBodySize}))
    })` });
    const sample = { run: i + 1, readyMs: ready.result.value, ...JSON.parse(metrics.result.value), requests, errors };
    samples.push(sample);
    console.log(`run ${i + 1}: password gateway ready ${sample.readyMs.toFixed(0)} ms`);
    listeners.delete(listener);
    await cdp('Target.disposeBrowserContext', { browserContextId });
  }
  const sorted = samples.map(s => s.readyMs).sort((a, b) => a - b);
  const report = {
    method: 'Chromium production build, cold browser context/cache, gzip server, 390x844 viewport, 1.6Mbps down/750Kbps up/150ms latency, CPU 4x; fonts blocked; anonymous session fixture; readiness = enabled password input + two animation frames. Not physical-phone or production API timing.',
    browser: await cdp('Browser.getVersion'),
    medianReadyMs: sorted[Math.floor(sorted.length / 2)], samples,
  };
  await mkdir(dirname(resolve(outputFile)), { recursive: true });
  await writeFile(outputFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ medianReadyMs: report.medianReadyMs, outputFile }));
} finally {
  ws?.close();
  chrome.kill();
  await new Promise(r => chrome.exitCode !== null ? r() : chrome.once('exit', r));
  server.close();
  await rm(profile, { recursive: true, force: true });
}
