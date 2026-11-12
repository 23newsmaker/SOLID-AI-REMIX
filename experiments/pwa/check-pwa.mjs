import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';
const root = new URL('../../artifacts/solid-ai-remix/public/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, './studio');
for (const icon of manifest.icons) {
  const bytes = await readFile(new URL(icon.src, root));
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  const [w, h] = icon.sizes.split('x').map(Number);
  assert.equal(bytes.readUInt32BE(16), w);
  assert.equal(bytes.readUInt32BE(20), h);
}
await access(new URL('icons/apple-touch-icon.png', root));
const code = await readFile(new URL('sw.js', root), 'utf8');
for (const scope of ['https://example.test/', 'https://example.test/remix/']) {
  const events = {}, removed = [], cached = [];
  const cache = { addAll: async paths => cached.push(...paths), match: async path => ({ offline: path }) };
  let fail = false;
  vm.runInNewContext(code, {
    URL,
    self: { registration: { scope }, location: { origin: 'https://example.test' },
      addEventListener: (name, fn) => { events[name] = fn; }, skipWaiting() {}, clients: { claim() {} } },
    caches: { open: async () => cache, keys: async () => ['sar-static-v1', 'sar-static-v2', 'another-app'],
      delete: async key => removed.push(key) },
    fetch: async () => { if (fail) throw new Error('offline'); return { network: true }; },
  });
  let wait;
  events.install({ waitUntil: p => { wait = p; } }); await wait;
  assert(cached.includes(new URL('offline.html', scope).pathname));
  assert(cached.every(p => !p.includes('/api') && p.startsWith(new URL(scope).pathname)));
  events.activate({ waitUntil: p => { wait = p; } }); await wait;
  assert.deepEqual(removed, ['sar-static-v1']);
  function request(path, mode = 'cors', method = 'GET') {
    let response;
    events.fetch({ request: { url: new URL(path, scope).href, method, mode }, respondWith: p => { response = p; } });
    return response;
  }
  for (const path of ['/api/character/photo', '/api/video/jobs/secret/file', '/objects/concepts/private']) {
    assert.equal(request(path), undefined, 'Private data must never use the cache');
  }
  assert.equal(request('icon.svg?token=private'), undefined);
  assert.equal(request('icon.svg', 'cors', 'POST'), undefined);
  assert.equal((await request('studio', 'navigate')).network, true);
  fail = true;
  assert.equal((await request('studio', 'navigate')).offline, new URL('offline.html', scope).pathname);
}
console.log('PASS: PNG icon sizes, standalone manifest, scoped public cache, network-only private data, generic offline fallback, unrelated caches preserved.');
