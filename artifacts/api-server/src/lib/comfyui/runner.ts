// Orchestrates one ComfyUI render: preflight -> upload -> submit -> poll /history -> download.
// All I/O goes through `deps`, so the flow is testable against a mock ComfyUI without a database.
// Never waits inside one HTTP request: each call to ComfyUI is short, and state is saved after every step
// so a restart resumes polling by prompt_id instead of submitting again.
import { createHash } from "node:crypto";
import { ComfyError, type ComfyClient, type OutputFile } from "./client";
import { preflight } from "./preflight";
import { buildWorkflow, composePrompt, workflowId, type ApiWorkflow, type BuildParams, type PromptConcept, type WorkflowKind } from "./workflow";

export type RunnerJob = {
  jobId: string; kind: WorkflowKind; seed: number; width: number; height: number; length: number; steps: 12 | 20;
  concept: PromptConcept; promptId: string | null; submittedAt: Date | null;
};
export type InputImage = { bytes: Uint8Array; contentType: string; filename: string };
export type Phase = "PREFLIGHT" | "UPLOADING" | "SUBMITTED" | "DOWNLOADING";
export type Patch = Partial<{ phase: Phase; promptId: string; workflow: ApiWorkflow; workflowHash: string; submittedAt: Date; pollCount: number }>;
export type StoredResult = { bytes: number; sha256: string };

export interface RunnerDeps {
  client: ComfyClient;
  /** Character photo first, then attachment images, in the order the workflow expects. */
  loadImages(): Promise<InputImage[]>;
  save(patch: Patch): Promise<void>;
  isCancelled(): Promise<boolean>;
  /** Persist the MP4 stream privately. Must stop reading and throw when `maxBytes` is exceeded. */
  storeResult(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<StoredResult>;
  /** Technical checks on the stored file (ffprobe/decode). Throws ComfyError("JOB_FAILED") when unusable. */
  verifyResult(): Promise<unknown>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Total time allowed from submission. */
  jobTimeoutMs?: number;
  /** How long ComfyUI may be unreachable while polling before the job is failed. */
  offlineGraceMs?: number;
  pollIntervalMs?: (attempt: number) => number;
}
export type Outcome =
  | { status: "COMPLETED"; result: StoredResult; checks: unknown; seconds: number }
  | { status: "CANCELLED" }
  | { status: "FAILED"; code: string; message: string; detail?: string[] };

export const MAX_RESULT_BYTES = 20 * 1024 * 1024; // /video-review hashes and serves files up to this size
const fail = (e: unknown): Outcome => e instanceof ComfyError
  ? { status: "FAILED", code: e.code, message: e.message, detail: e.detail }
  : { status: "FAILED", code: "INTERNAL", message: "Kesalahan internal saat memproses job ComfyUI." };

export const defaultPollInterval = (attempt: number) => Math.min(2000 + attempt * 500, 10_000);

export async function runComfyJob(job: RunnerJob, d: RunnerDeps): Promise<Outcome> {
  const now = d.now ?? Date.now, sleep = d.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  const timeoutMs = d.jobTimeoutMs ?? 45 * 60_000, graceMs = d.offlineGraceMs ?? 10 * 60_000, interval = d.pollIntervalMs ?? defaultPollInterval;
  const started = now();
  try {
    let promptId = job.promptId;
    if (!promptId) {
      await d.save({ phase: "PREFLIGHT" });
      // Checked against this exact workflow with placeholder image names; image names only matter after upload.
      const probe = buildWorkflow(params(job, Array.from({ length: imagesNeeded(job.kind) }, () => "solid/probe.png"), 0));
      await preflight(d.client, probe);
      if (await d.isCancelled()) return { status: "CANCELLED" };

      await d.save({ phase: "UPLOADING" });
      const images = await d.loadImages();
      const names: string[] = [];
      for (const [i, img] of images.entries()) {
        names.push(await d.client.uploadImage(img.bytes, `${job.jobId}-${i + 1}-${img.filename}`.replace(/[^\w.-]/g, "_"), img.contentType));
        if (await d.isCancelled()) return { status: "CANCELLED" };
      }
      const imageCount = names.length;
      const workflow = buildWorkflow(params(job, names, imageCount));
      const workflowHash = createHash("sha256").update(JSON.stringify(workflow)).digest("hex");
      await d.save({ workflow, workflowHash });
      if (await d.isCancelled()) return { status: "CANCELLED" };
      promptId = await d.client.submit(workflow, `solid-${job.jobId}`);
      // Persist before anything else: this id is what makes a restart resume instead of resubmit.
      await d.save({ phase: "SUBMITTED", promptId, submittedAt: new Date(now()) });
    }

    const since = job.submittedAt?.getTime() ?? started;
    let attempt = 0, firstFailure: number | null = null;
    for (;;) {
      if (await d.isCancelled()) return { status: "CANCELLED" };
      if (now() - since > timeoutMs) {
        return { status: "FAILED", code: "TIMEOUT", message: `Render melewati batas ${Math.round(timeoutMs / 60_000)} menit. Job mungkin masih berjalan di GPU; hasilnya tidak diambil otomatis.` };
      }
      try {
        const h = await d.client.history(promptId);
        firstFailure = null;
        if (h.state === "FAILED") return { status: "FAILED", code: "JOB_FAILED", message: h.reason };
        if (h.state === "COMPLETED") return await finish(h.files[0]!, started, d);
      } catch (e) {
        const transient = e instanceof ComfyError && (e.code === "OFFLINE" || e.code === "TIMEOUT");
        if (!transient) throw e;
        firstFailure ??= now();
        if (now() - firstFailure > graceMs) {
          return { status: "FAILED", code: "OFFLINE", message: "ComfyUI tidak terjangkau saat menunggu hasil. Job mungkin masih berjalan di GPU; buat versi baru jika perlu." };
        }
      }
      await d.save({ pollCount: ++attempt });
      await sleep(interval(attempt));
    }
  } catch (e) { return fail(e); }
}

async function finish(file: OutputFile, started: number, d: RunnerDeps): Promise<Outcome> {
  await d.save({ phase: "DOWNLOADING" });
  const { body, length } = await d.client.view(file);
  if (length !== null && length > MAX_RESULT_BYTES) {
    await body.cancel().catch(() => {});
    return { status: "FAILED", code: "RESULT_TOO_LARGE", message: "Hasil lebih dari 20 MiB sehingga tidak dapat ditinjau di /video-review. Kurangi durasi atau resolusi." };
  }
  const result = await d.storeResult(body, MAX_RESULT_BYTES);
  if (result.bytes === 0) return { status: "FAILED", code: "JOB_FAILED", message: "File hasil kosong." };
  const checks = await d.verifyResult();
  return { status: "COMPLETED", result, checks, seconds: Math.round(((d.now ?? Date.now)() - started) / 1000) };
}

export const imagesNeeded = (kind: WorkflowKind) => (kind === "I2V" ? 1 : kind === "FIRST_LAST" ? 2 : 1);
function params(job: RunnerJob, images: string[], imageCount: number): BuildParams {
  return {
    kind: job.kind, seed: job.seed, width: job.width, height: job.height, length: job.length, steps: job.steps, images,
    prompt: composePrompt(job.concept, job.kind, Math.max(imageCount, images.length)),
    filenamePrefix: `video/solid_${job.jobId.replace(/[^\w-]/g, "")}`,
  };
}
export { workflowId };
