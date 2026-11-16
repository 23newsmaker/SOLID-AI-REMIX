import { test } from "node:test";
import assert from "node:assert/strict";
import { ComfyClient, ComfyError, comfyConfigFromEnv, interpretHistory, summarizeRejection } from "./client";

const cfg = { baseUrl: "https://comfy.example.test", accessId: "id-123", accessSecret: "secret-456" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noSleep = async () => {};
function client(handler: (url: string, init: RequestInit) => Response | Promise<Response>, retries = 2) {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return handler(url, init); }) as unknown as typeof fetch;
  return { c: new ComfyClient(cfg, { fetch: f, retries, sleep: noSleep }), calls };
}
const thrown = (p: Promise<unknown>): Promise<ComfyError> => p.then(() => { throw new Error("expected rejection"); }, (e: ComfyError) => e);
const code = async (p: Promise<unknown>) => p.then(() => "none", (e: ComfyError) => e.code);

test("every request carries the Access headers", async () => {
  const { c, calls } = client(() => json({ devices: [], system: {} }));
  await c.systemStats();
  const h = calls[0]!.init.headers as Record<string, string>;
  assert.equal(h["CF-Access-Client-Id"], "id-123");
  assert.equal(h["CF-Access-Client-Secret"], "secret-456");
});
test("401, 403 and Access redirects are ACCESS_DENIED and never retried", async () => {
  for (const status of [401, 403, 302]) {
    const { c, calls } = client(() => new Response(null, { status, headers: { location: "https://x.cloudflareaccess.com/login" } }));
    assert.equal(await code(c.systemStats()), "ACCESS_DENIED");
    assert.equal(calls.length, 1);
  }
});
test("errors never leak the URL or secrets", async () => {
  const { c } = client(() => { throw new TypeError("fetch failed https://comfy.example.test"); });
  const err = await thrown(c.systemStats());
  assert.equal(err.code, "OFFLINE");
  assert.ok(!/comfy\.example|secret-456|id-123/.test(err.message));
});
test("GET retries transient failures then succeeds; 5xx maps to OFFLINE", async () => {
  let n = 0;
  const { c, calls } = client(() => (++n < 3 ? new Response(null, { status: 530 }) : json({ queue_running: [1], queue_pending: [1, 2] })));
  assert.deepEqual(await c.queue(), { running: 1, pending: 2 });
  assert.equal(calls.length, 3);
  const dead = client(() => new Response(null, { status: 530 }));
  assert.equal(await code(dead.c.queue()), "OFFLINE");
  assert.equal(dead.calls.length, 3);
});
test("524 is TIMEOUT", async () => assert.equal(await code(client(() => new Response(null, { status: 524 })).c.systemStats()), "TIMEOUT"));
test("submit is never retried and returns the prompt id", async () => {
  const ok = client(() => json({ prompt_id: "abc" }));
  assert.equal(await ok.c.submit({}, "cid"), "abc");
  const bad = client(() => new Response(null, { status: 530 }));
  assert.equal(await code(bad.c.submit({}, "cid")), "OFFLINE");
  assert.equal(bad.calls.length, 1);
});
test("rejected workflow surfaces short node errors", async () => {
  const body = { error: { type: "prompt_outputs_failed_validation", message: "Prompt outputs failed validation" },
    node_errors: { "2": { class_type: "UNETLoader", errors: [{ message: "Value not in list: unet_name" }] } } };
  const err = await thrown(client(() => json(body, 400)).c.submit({}, "c"));
  assert.equal(err.code, "REJECTED");
  assert.ok(err.detail!.some((l: string) => l.includes("UNETLoader")));
  assert.ok(summarizeRejection(body).length === 2);
});
test("an HTML login page instead of JSON is BAD_RESPONSE", async () => {
  const { c } = client(() => new Response("<html>login</html>", { status: 200 }));
  assert.equal(await code(c.systemStats()), "BAD_RESPONSE");
});
test("history: absent = NOT_FOUND, error = FAILED, completed = MP4 files", () => {
  assert.deepEqual(interpretHistory(undefined), { state: "NOT_FOUND" });
  const failed = interpretHistory({ status: { status_str: "error", completed: false, messages: [["execution_error", { node_type: "MiniMaxH3ImageToVideo", exception_type: "RuntimeError", exception_message: "CUDA out of memory\nstack" }]] } });
  assert.equal(failed.state, "FAILED");
  assert.match((failed as any).reason, /CUDA out of memory/);
  const done = interpretHistory({ status: { status_str: "success", completed: true }, outputs: { "15": { images: [{ filename: "a.mp4", subfolder: "video", type: "output" }, { filename: "x.png", subfolder: "", type: "temp" }], animated: [true] } } });
  assert.deepEqual(done, { state: "COMPLETED", files: [{ filename: "a.mp4", subfolder: "video", type: "output" }] });
  assert.equal(interpretHistory({ status: { completed: true }, outputs: {} }).state, "FAILED");
});
test("config requires all three values and TLS (loopback http allowed for dev)", () => {
  const env = { COMFYUI_URL: "https://c.example.test/", CF_ACCESS_CLIENT_ID: "a", CF_ACCESS_CLIENT_SECRET: "b" } as NodeJS.ProcessEnv;
  assert.equal(comfyConfigFromEnv(env)?.baseUrl, "https://c.example.test");
  assert.equal(comfyConfigFromEnv({ ...env, COMFYUI_URL: "http://c.example.test" }), null);
  assert.ok(comfyConfigFromEnv({ ...env, COMFYUI_URL: "http://127.0.0.1:8188" }));
  assert.equal(comfyConfigFromEnv({ ...env, CF_ACCESS_CLIENT_SECRET: "" }), null);
});
