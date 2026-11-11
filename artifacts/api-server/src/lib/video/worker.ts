import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, videoJobs, members, auditLog, type VideoJobRow } from "@workspace/db";
import type { VideoRenderOptions } from "@workspace/api-zod";
import { CreativeError } from "../creative-policy";
import { boundedMaterial } from "../creative-storage";
import { setObjectAclPolicy } from "../objectAcl";
import { videoFile, videoStorage } from "./storage";
import { eligibleConcept } from "./policy";
import { renderHemat } from "./renderer";
import { settings, monthlyUsage } from "./service";
import { logger } from "../logger";

let running = false;
const finalPath = (job: VideoJobRow) => `/objects/videos/${job.id}-final.mp4`;
async function validateJob(job: VideoJobRow) {
  if (!job.conceptId) throw new CreativeError(409, "Konsep sudah dihapus.");
  const [owner] = await db.select().from(members).where(eq(members.id, job.ownerId));
  if (!owner) throw new CreativeError(409, "Pembuat tidak tersedia.");
  return eligibleConcept(job.conceptId, job.conceptVersion, owner, job.options as VideoRenderOptions);
}
async function reconcile(job: VideoJobRow) {
  const file = videoFile(finalPath(job));
  const [exists] = await file.exists();
  if (exists && !job.deleted) {
    try {
      await validateJob(job);
      const [meta] = await file.getMetadata();
      if (meta.metadata?.jobId === job.id && meta.contentType === "video/mp4") {
        await db.update(videoJobs).set({ status: "COMPLETED", resultPath: finalPath(job), error: null, updatedAt: new Date() }).where(and(eq(videoJobs.id, job.id), eq(videoJobs.deleted, false)));
        return;
      }
    } catch { /* A changed concept never becomes a usable completed result. */ }
  }
  await file.delete({ ignoreNotFound: true });
  await db.update(videoJobs).set({ status: "UNKNOWN", error: "Proses sebelumnya terhenti. Tidak dikirim/render ulang otomatis; admin perlu meninjau dan pengguna dapat membuat versi baru dengan konfirmasi.", updatedAt: new Date() }).where(eq(videoJobs.id, job.id));
}
export async function runVideoWorker() {
  if (running) return;
  running = true;
  const conn = await pool.connect().catch(() => null);
  if (!conn) { running = false; return; }
  const abort = new AbortController();
  const connectionError = () => abort.abort();
  conn.on("error", connectionError);
  let locked = false;
  try {
    locked = (await conn.query("SELECT pg_try_advisory_lock(7101702) AS locked")).rows[0].locked;
    if (!locked) return;
    const interrupted = await db.select().from(videoJobs).where(inArray(videoJobs.status, ["PROCESSING", "SUBMITTED"]));
    for (const job of interrupted) await reconcile(job);
    // Orphan temporaries after process termination: only our namespace, older
    // than the maximum rendering window, never another feature's uploads.
    for (const name of await readdir(tmpdir())) {
      if (!/^solid-video-[a-zA-Z0-9]+$/.test(name)) continue;
      const p = join(tmpdir(), name);
      if ((await stat(p)).mtimeMs < Date.now() - 10 * 60_000) await rm(p, { force: true, recursive: true });
    }
    // Retry cleanup of explicitly deleted results if storage was unavailable.
    const deleted = await db.select().from(videoJobs).where(and(eq(videoJobs.deleted, true), eq(videoJobs.status, "COMPLETED"))).limit(20);
    for (const job of deleted) await videoFile(finalPath(job)).delete({ ignoreNotFound: true });
    const config = await settings();
    if (config.paused || (config.budgetUsd !== null && (await monthlyUsage()).knownProviderUsd >= config.budgetUsd)) return;
    const [next] = await conn.query("SELECT id FROM solid_video_jobs WHERE status='QUEUED' ORDER BY created_at LIMIT 1").then(r => r.rows);
    if (!next) return;
    const [job] = await db.update(videoJobs).set({ status: "PROCESSING", attempts: 1, submittedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(videoJobs.id, next.id), eq(videoJobs.status, "QUEUED"))).returning();
    if (!job) return;
    const started = Date.now();
    const timeout = setTimeout(() => abort.abort(), 180_000);
    const poll = setInterval(() => {
      void db.select({ status: videoJobs.status }).from(videoJobs).where(eq(videoJobs.id, job.id)).then(([row]) => {
        if (row?.status !== "PROCESSING") abort.abort();
      }).catch(() => abort.abort());
    }, 2000);
    try {
      const valid = await validateJob(job);
      const characterFile = await videoStorage.getObjectEntityFile(valid.character.objectPath);
      const [characterMeta] = await characterFile.getMetadata();
      if (Number(characterMeta.size) > 5 * 1024 * 1024) throw new CreativeError(400, "Foto karakter terlalu besar.");
      const [character] = await characterFile.download();
      const logo = await boundedMaterial(valid.logo.finalPath!, valid.logo.size);
      const scenes: { bytes: Buffer; video: boolean }[] = [];
      let audio: Buffer | undefined;
      for (const material of valid.materials) {
        if (material.id === valid.logo.id) continue;
        const bytes = await boundedMaterial(material.finalPath!, material.size);
        if (material.contentType.startsWith("audio/")) audio = bytes;
        else scenes.push({ bytes, video: material.contentType === "video/mp4" });
      }
      await renderHemat({ duration: job.durationSeconds, character, logo, scenes, audio, options: job.options as VideoRenderOptions,
        chunks: valid.chunks, cta: valid.data.cta, disclaimer: valid.data.disclaimer ?? "" }, async path => {
        if (abort.signal.aborted) throw new Error("Cancelled");
        const file = videoFile(finalPath(job));
        await pipeline(createReadStream(path), file.createWriteStream({ resumable: false, contentType: "video/mp4",
          metadata: { cacheControl: "private, no-store", metadata: { jobId: job.id } } }), { signal: abort.signal });
        await setObjectAclPolicy(file, { owner: job.ownerId, visibility: "private" });
        await validateJob(job);
        const [exists] = await file.exists();
        if (!exists) throw new Error("Result not available");
        const [saved] = await db.update(videoJobs).set({ status: "COMPLETED", resultPath: finalPath(job), renderMilliseconds: Date.now() - started, updatedAt: new Date() })
          .where(and(eq(videoJobs.id, job.id), eq(videoJobs.status, "PROCESSING"), eq(videoJobs.deleted, false))).returning();
        if (!saved) await file.delete({ ignoreNotFound: true });
        else await db.insert(auditLog).values({ id: randomUUID(), userId: job.ownerId, action: "VIDEO_COMPLETED", description: `MP4 Hemat ${job.id} tersimpan privat; biaya komputasi belum diukur.` }).catch(() => logger.warn("Completed video audit deferred; result preserved"));
      }, abort.signal);
    } catch (err) {
      await videoFile(finalPath(job)).delete({ ignoreNotFound: true }).catch(() => {});
      await db.update(videoJobs).set({ status: "FAILED", updatedAt: new Date(),
        error: err instanceof CreativeError ? err.message : "Render lokal gagal/dibatalkan atau batas waktu habis. Tidak diulang otomatis; buat versi baru jika ingin mencoba lagi." })
        .where(and(eq(videoJobs.id, job.id), eq(videoJobs.status, "PROCESSING")));
      await db.insert(auditLog).values({ id: randomUUID(), userId: job.ownerId, action: "VIDEO_RENDER_STOPPED", description: `Pekerjaan ${job.id} berhenti tanpa retry otomatis.` });
    } finally { clearInterval(poll); clearTimeout(timeout); }
  } catch { logger.warn("Video worker deferred; no content or private paths logged"); }
  finally {
    if (locked) await conn.query("SELECT pg_advisory_unlock(7101702)").catch(() => {});
    conn.removeListener("error", connectionError);
    conn.release();
    running = false;
  }
}
export function startVideoWorker() {
  void runVideoWorker();
  const timer = setInterval(() => void runVideoWorker(), 4000);
  timer.unref();
}
