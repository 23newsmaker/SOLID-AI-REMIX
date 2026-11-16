// Background worker for AI (ComfyUI) jobs. Separate from the Hemat worker: own advisory lock,
// own queue filter (mode = 'AI'). One GPU job at a time. Restart-safe: a stored prompt_id is resumed, never resubmitted.
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, videoJobs, comfyJobs, members, auditLog, type VideoJobRow } from "@workspace/db";
import type { VideoRenderOptions } from "@workspace/api-zod";
import { CreativeError } from "../creative-policy";
import { boundedMaterial } from "../creative-storage";
import { setObjectAclPolicy } from "../objectAcl";
import { videoFile, videoStorage } from "../video/storage";
import { eligibleAiConcept, jobReferenceFolder } from "../video/policy";
import { settings } from "../video/service";
import { mediaCommand } from "../video/renderer";
import { DemandRunner, type WorkOutcome } from "../demand-runner";
import { logger } from "../logger";
import { ComfyError, comfyClient } from "./client";
import { comfyEnabled } from "./provider";
import { onComfyWork } from "./signals";
import { runComfyJob, type InputImage, type Outcome, type RunnerDeps, type RunnerJob } from "./runner";
import type { PromptConcept, WorkflowKind } from "./workflow";
import { technicalChecks, type AiInputs } from "./plan";

let running = false;
const finalPath = (job: VideoJobRow) => `/objects/videos/${job.id}-final.mp4`;
const MIME_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

async function validate(job: VideoJobRow) {
  if (!job.conceptId) throw new CreativeError(409, "Konsep sudah dihapus.");
  const [owner] = await db.select().from(members).where(eq(members.id, job.ownerId));
  if (!owner) throw new CreativeError(409, "Pembuat tidak tersedia.");
  const options = job.options as VideoRenderOptions;
  return eligibleAiConcept(job.conceptId, job.conceptVersion, owner, undefined, jobReferenceFolder(options));
}

async function execute(job: VideoJobRow, comfy: typeof comfyJobs.$inferSelect, abort: AbortController): Promise<Outcome> {
  const dir = await mkdtemp(join(tmpdir(), "solid-ai-comfy-"));
  const file = join(dir, "result.mp4");
  let sha = "", size = 0;
  try {
    const valid = await validate(job);
    const inputs = comfy.inputs as AiInputs;
    const targetSeconds = comfy.frameLength / 24;
    const concept: PromptConcept = { style: valid.data.style, scenes: valid.data.scenes, characterMotion: valid.data.characterMotion,
      cameraMotion: valid.data.cameraMotion, visual: valid.data.visual, narration: valid.data.narration, format: valid.data.format, durationSeconds: valid.data.durationSeconds };
    const runnerJob: RunnerJob = { jobId: job.id, kind: comfy.workflowKind as WorkflowKind, seed: comfy.seed, width: comfy.width, height: comfy.height,
      length: comfy.frameLength, steps: comfy.steps === 20 ? 20 : 12, concept, promptId: comfy.promptId, submittedAt: comfy.submittedAt };
    const deps: RunnerDeps = {
      client: comfyClient(),
      loadImages: async () => {
        const out: InputImage[] = [];
        const characterFile = await videoStorage.getObjectEntityFile(valid.character.objectPath);
        const [meta] = await characterFile.getMetadata();
        if (Number(meta.size) > 5 * 1024 * 1024) throw new CreativeError(400, "Foto karakter terlalu besar.");
        const [bytes] = await characterFile.download();
        const type = String(meta.contentType ?? "image/jpeg");
        out.push({ bytes, contentType: type, filename: `character.${MIME_EXT[type] ?? "jpg"}` });
        for (const id of inputs.attachmentIds) {
          const m = valid.materials.find(x => x.id === id);
          if (!m?.finalPath) throw new CreativeError(409, "Lampiran gambar tidak tersedia.");
          out.push({ bytes: await boundedMaterial(m.finalPath, m.size), contentType: m.contentType, filename: `ref.${MIME_EXT[m.contentType] ?? "jpg"}` });
        }
        return out;
      },
      save: async p => {
        await db.update(comfyJobs).set({ ...p, updatedAt: new Date() }).where(eq(comfyJobs.jobId, job.id));
        if (p.promptId) await db.update(videoJobs).set({ providerJobId: p.promptId, status: "PROCESSING", updatedAt: new Date() }).where(eq(videoJobs.id, job.id));
      },
      isCancelled: async () => {
        if (abort.signal.aborted) return true;
        const [row] = await db.select({ status: videoJobs.status, deleted: videoJobs.deleted }).from(videoJobs).where(eq(videoJobs.id, job.id));
        return !row || row.status !== "PROCESSING" || row.deleted;
      },
      storeResult: async (body, maxBytes) => {
        const hash = createHash("sha256");
        let bytes = 0;
        const counted = Readable.fromWeb(body as never);
        counted.on("data", (c: Buffer) => { bytes += c.length; hash.update(c); if (bytes > maxBytes) counted.destroy(new Error("RESULT_TOO_LARGE")); });
        await pipeline(counted, createWriteStream(file), { signal: abort.signal }).catch(err => {
          if (String(err?.message).includes("RESULT_TOO_LARGE")) throw new ComfyError("JOB_FAILED", "Hasil lebih dari 20 MiB sehingga tidak dapat ditinjau di /video-review. Kurangi durasi atau resolusi.");
          throw err;
        });
        sha = hash.digest("hex"); size = bytes;
        return { bytes, sha256: sha };
      },
      verifyResult: async () => {
        let probe: unknown;
        try {
          probe = JSON.parse(await mediaCommand("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], abort.signal));
          await mediaCommand("ffmpeg", ["-v", "error", "-xerror", "-threads", "1", "-i", file, "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-"], abort.signal);
        } catch { throw new ComfyError("JOB_FAILED", "Hasil tidak dapat diperiksa/didekode (ffmpeg/ffprobe tidak tersedia atau file rusak); tidak diserahkan sebagai selesai."); }
        const checks = technicalChecks(probe, size, targetSeconds);
        const bad = checks.filter(c => !c.ok);
        if (bad.length) throw new ComfyError("JOB_FAILED", `Pemeriksaan teknis gagal: ${bad.map(b => b.detail).join(" ")}`);
        return checks;
      },
    };
    const outcome = await runComfyJob(runnerJob, deps);
    if (outcome.status !== "COMPLETED") return outcome;

    // Re-check the concept is unchanged, then store privately exactly like the Hemat result.
    await validate(job);
    const target = videoFile(finalPath(job));
    await pipeline(createReadStream(file), target.createWriteStream({ resumable: false, contentType: "video/mp4",
      metadata: { cacheControl: "private, no-store", metadata: { jobId: job.id } } }), { signal: abort.signal });
    await setObjectAclPolicy(target, { owner: job.ownerId, visibility: "private" });
    const [saved] = await db.update(videoJobs).set({ status: "COMPLETED", resultPath: finalPath(job), resultHash: sha, resultBytes: size,
      renderMilliseconds: outcome.seconds * 1000, updatedAt: new Date(), error: null })
      .where(and(eq(videoJobs.id, job.id), eq(videoJobs.status, "PROCESSING"), eq(videoJobs.deleted, false))).returning();
    if (!saved) { await target.delete({ ignoreNotFound: true }); return { status: "CANCELLED" }; }
    await db.update(comfyJobs).set({ phase: "DONE", technicalChecks: outcome.checks as never, finishedAt: new Date(), updatedAt: new Date() }).where(eq(comfyJobs.jobId, job.id));
    await db.insert(auditLog).values({ id: randomUUID(), userId: job.ownerId, action: "VIDEO_COMPLETED", description: `MP4 AI (ComfyUI) ${job.id} tersimpan privat; menunggu review final manusia. Biaya GPU belum diukur.` }).catch(() => logger.warn("Completed video audit deferred; result preserved"));
    return outcome;
  } catch (err) {
    if (err instanceof CreativeError) return { status: "FAILED", code: "CONCEPT_CHANGED", message: err.message };
    if (err instanceof ComfyError) return { status: "FAILED", code: err.code, message: err.message, detail: err.detail };
    return { status: "FAILED", code: "INTERNAL", message: "Kesalahan internal saat memproses job AI." };
  } finally { await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}

async function finalize(job: VideoJobRow, outcome: Outcome) {
  if (outcome.status === "COMPLETED") return;
  if (outcome.status === "CANCELLED") {
    await db.update(comfyJobs).set({ phase: "FAILED", errorCode: "CANCELLED", finishedAt: new Date(), updatedAt: new Date() }).where(eq(comfyJobs.jobId, job.id));
    return;
  }
  const lines = outcome.detail?.length ? ` (${outcome.detail.join("; ")})` : "";
  await db.update(comfyJobs).set({ phase: "FAILED", errorCode: outcome.code, errorDetail: outcome.detail ?? [], finishedAt: new Date(), updatedAt: new Date() }).where(eq(comfyJobs.jobId, job.id));
  await db.update(videoJobs).set({ status: "FAILED", updatedAt: new Date(), error: `${outcome.message}${lines} Tidak diulang otomatis; buat versi baru jika ingin mencoba lagi.` })
    .where(and(eq(videoJobs.id, job.id), eq(videoJobs.status, "PROCESSING")));
  await db.insert(auditLog).values({ id: randomUUID(), userId: job.ownerId, action: "VIDEO_RENDER_STOPPED", description: `Pekerjaan AI ${job.id} berhenti (${outcome.code}) tanpa retry otomatis.` }).catch(() => {});
}

export async function runComfyWorker(): Promise<WorkOutcome> {
  if (running) return "contended";
  running = true;
  const conn = await pool.connect().catch(() => null);
  if (!conn) { running = false; return "contended"; }
  const abort = new AbortController();
  const onConnError = () => abort.abort();
  conn.on("error", onConnError);
  let locked = false;
  try {
    locked = (await conn.query("SELECT pg_try_advisory_lock(7101703) AS locked")).rows[0].locked;
    if (!locked) return "contended";
    const config = await settings();
    if (config.paused) return "idle";
    if (!(await comfyEnabled()).enabled) return "idle"; // switched off by Super: queued jobs wait, nothing is sent

    // Resume interrupted jobs first. Only a stored prompt_id may be resumed; otherwise we cannot know whether it was submitted.
    const interrupted = await db.select().from(videoJobs).where(and(eq(videoJobs.mode, "AI"), inArray(videoJobs.status, ["PROCESSING", "SUBMITTED"])));
    let job: VideoJobRow | undefined;
    for (const j of interrupted) {
      const [c] = await db.select().from(comfyJobs).where(eq(comfyJobs.jobId, j.id));
      if (c?.promptId) { job = j; break; }
      await finalize(j, { status: "FAILED", code: "INTERRUPTED", message: "Proses terhenti sebelum workflow dikirim ke ComfyUI." });
    }
    if (!job) {
      const [next] = await conn.query("SELECT id FROM solid_video_jobs WHERE status='QUEUED' AND mode='AI' ORDER BY created_at LIMIT 1").then(r => r.rows);
      if (!next) return "idle";
      [job] = await db.update(videoJobs).set({ status: "PROCESSING", attempts: 1, submittedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(videoJobs.id, next.id), eq(videoJobs.status, "QUEUED"))).returning();
      if (!job) return "worked";
    }
    const [comfy] = await db.select().from(comfyJobs).where(eq(comfyJobs.jobId, job.id));
    if (!comfy) { await finalize(job, { status: "FAILED", code: "INTERNAL", message: "Data job ComfyUI tidak ditemukan." }); return "worked"; }
    await finalize(job, await execute(job, comfy, abort));
    return "worked";
  } catch { logger.warn("ComfyUI worker deferred; no content, URL or credentials logged"); return "contended"; }
  finally {
    if (locked) await conn.query("SELECT pg_advisory_unlock(7101703)").catch(() => {});
    conn.removeListener("error", onConnError);
    conn.release();
    running = false;
  }
}

// Polling cadence is inside runComfyJob; between jobs the runner only needs rare fallback checks.
const runner = new DemandRunner(runComfyWorker, () => logger.warn("ComfyUI worker deferred"));
let unsubscribe: (() => void) | undefined;
export function startComfyWorker() {
  if (unsubscribe) return;
  unsubscribe = onComfyWork(() => runner.wake());
  runner.start();
}
export function stopComfyWorker() { runner.stop(); unsubscribe?.(); unsubscribe = undefined; }
