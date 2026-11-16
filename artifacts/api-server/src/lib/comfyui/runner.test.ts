import { test } from "node:test";
import assert from "node:assert/strict";
import { ComfyClient } from "./client";
import { startMockComfy, type MockOptions } from "./mock-server";
import { runComfyJob, MAX_RESULT_BYTES, type Patch, type RunnerDeps, type RunnerJob } from "./runner";

const access = { id: "test-id", secret: "test-secret" };
const concept = { style: "UGC" as const, scenes: "Kantor", characterMotion: "Tersenyum", cameraMotion: "Statis", visual: "Terang", narration: "Halo semua", format: "9:16", durationSeconds: 8 };
const job = (o: Partial<RunnerJob> = {}): RunnerJob => ({ jobId: "11111111-2222-3333-4444-555555555555", kind: "I2V", seed: 7, width: 768, height: 1344, length: 141, steps: 12, concept, promptId: null, submittedAt: null, ...o });
const img = { bytes: new Uint8Array([1, 2, 3]), contentType: "image/png", filename: "face.png" };

async function setup(opts: MockOptions = {}, extra: Partial<RunnerDeps> = {}, creds = access) {
  const mock = await startMockComfy({ access, ...opts });
  const patches: Patch[] = [];
  let cancelled = false, stored = 0;
  const deps: RunnerDeps = {
    client: new ComfyClient({ baseUrl: mock.url, accessId: creds.id, accessSecret: creds.secret }, { retries: 0, sleep: async () => {} }),
    loadImages: async () => [img],
    save: async p => { patches.push(p); },
    isCancelled: async () => cancelled,
    storeResult: async (body, max) => {
      let bytes = 0;
      const reader = body.getReader();
      for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > max) throw new Error("too big"); }
      stored = bytes; return { bytes, sha256: "x".repeat(64) };
    },
    verifyResult: async () => ({ ok: true }),
    sleep: async () => {}, pollIntervalMs: () => 0, ...extra,
  };
  return { mock, deps, patches, cancel: () => { cancelled = true; }, stored: () => stored };
}

test("happy path: preflight, upload, submit, poll, download, verify", async () => {
  const s = await setup({ pollsBeforeDone: 3 });
  try {
    const out = await runComfyJob(job(), s.deps);
    assert.equal(out.status, "COMPLETED");
    assert.ok(s.stored() > 0);
    assert.equal(s.mock.submitted.length, 1);
    assert.equal(s.mock.uploads.length, 1);
    const wf = s.mock.submitted[0]!.workflow;
    assert.equal(wf["9"]!.inputs.noise_seed, 7);
    assert.match(String(wf["16"]!.inputs.image), /^solid\//);
    // promptId was persisted before polling started, and phases advanced in order.
    const phases = s.patches.map(p => p.phase).filter(Boolean);
    assert.deepEqual(phases, ["PREFLIGHT", "UPLOADING", "SUBMITTED", "DOWNLOADING"]);
    assert.ok(s.patches.some(p => p.promptId === "mock-prompt-1"));
    assert.ok(s.patches.some(p => p.workflowHash && p.workflowHash.length === 64));
    assert.ok(s.mock.calls.filter(c => c.startsWith("GET /history")).length >= 4);
  } finally { await s.mock.close(); }
});
test("resume: a stored promptId is polled, never resubmitted", async () => {
  const s = await setup({ pollsBeforeDone: 0 });
  try {
    // Seed the mock with an already-submitted prompt, as if the server restarted mid-render.
    await fetch(`${s.mock.url}/prompt`, { method: "POST", headers: { "CF-Access-Client-Id": access.id, "CF-Access-Client-Secret": access.secret }, body: JSON.stringify({ prompt: {} }) });
    const before = s.mock.submitted.length;
    const out = await runComfyJob(job({ promptId: "mock-prompt-1", submittedAt: new Date() }), s.deps);
    assert.equal(out.status, "COMPLETED");
    assert.equal(s.mock.submitted.length, before);
    assert.equal(s.mock.uploads.length, 0);
  } finally { await s.mock.close(); }
});
test("wrong Access credentials: clear ACCESS_DENIED and nothing is uploaded or submitted", async () => {
  const s = await setup({}, {}, { id: "bad", secret: "bad" });
  try {
    const out = await runComfyJob(job(), s.deps);
    assert.deepEqual([out.status, (out as any).code], ["FAILED", "ACCESS_DENIED"]);
    assert.equal(s.mock.submitted.length, 0);
    assert.equal(s.mock.uploads.length, 0);
  } finally { await s.mock.close(); }
});
test("offline ComfyUI fails clearly without uploading", async () => {
  const s = await setup({ offline: true });
  try {
    const out = await runComfyJob(job(), s.deps);
    assert.deepEqual([out.status, (out as any).code], ["FAILED", "OFFLINE"]);
  } finally { await s.mock.close(); }
});
test("missing node or model is rejected with the list, before any upload", async () => {
  const s = await setup({ missingClasses: ["MiniMaxH3ImageToVideo"], missingModels: ["minimax_h3_video_vae_fp16.safetensors"] });
  try {
    const out = await runComfyJob(job(), s.deps) as Extract<Awaited<ReturnType<typeof runComfyJob>>, { status: "FAILED" }>;
    assert.equal(out.code, "NODE_MISSING");
    assert.ok(out.detail!.some(l => l.includes("MiniMaxH3ImageToVideo")));
    assert.ok(out.detail!.some(l => l.includes("minimax_h3_video_vae_fp16")));
    assert.equal(s.mock.uploads.length, 0);
    assert.equal(s.mock.submitted.length, 0);
  } finally { await s.mock.close(); }
});
test("execution error from ComfyUI becomes a readable failure", async () => {
  const s = await setup({ failExecution: true });
  try {
    const out = await runComfyJob(job(), s.deps) as any;
    assert.equal(out.code, "JOB_FAILED");
    assert.match(out.message, /CUDA out of memory/);
  } finally { await s.mock.close(); }
});
test("job that finishes without an MP4 fails", async () => {
  const s = await setup({ noOutput: true });
  try { assert.equal(((await runComfyJob(job(), s.deps)) as any).code, "JOB_FAILED"); } finally { await s.mock.close(); }
});
test("timeout after submission is reported and the result is not fetched", async () => {
  let t = 1_000_000;
  const s = await setup({ pollsBeforeDone: 10_000 }, { now: () => t, sleep: async () => { t += 60_000; }, jobTimeoutMs: 5 * 60_000 });
  try {
    const out = await runComfyJob(job({ promptId: null }), s.deps) as any;
    assert.equal(out.code, "TIMEOUT");
    assert.ok(!s.mock.calls.some(c => c.startsWith("GET /view")));
  } finally { await s.mock.close(); }
});
test("cancellation stops polling", async () => {
  const s = await setup({ pollsBeforeDone: 10_000 });
  try {
    let polls = 0;
    s.deps.sleep = async () => { if (++polls === 2) s.cancel(); };
    assert.equal((await runComfyJob(job(), s.deps)).status, "CANCELLED");
  } finally { await s.mock.close(); }
});
test("results over 20 MiB are refused", async () => {
  const s = await setup({ mp4: Buffer.alloc(MAX_RESULT_BYTES + 1) });
  try { assert.equal(((await runComfyJob(job(), s.deps)) as any).code, "RESULT_TOO_LARGE"); } finally { await s.mock.close(); }
});
test("a failing technical check fails the job", async () => {
  const { ComfyError } = await import("./client");
  const s = await setup({}, { verifyResult: async () => { throw new ComfyError("JOB_FAILED", "Video tidak memiliki track audio."); } });
  try {
    const out = await runComfyJob(job(), s.deps) as any;
    assert.deepEqual([out.status, out.code, out.message], ["FAILED", "JOB_FAILED", "Video tidak memiliki track audio."]);
  } finally { await s.mock.close(); }
});
