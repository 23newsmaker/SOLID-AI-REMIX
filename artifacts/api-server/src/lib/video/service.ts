import { createHash, randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, videoJobs, videoSettings, members, auditLog, type MemberRecord, type VideoJobRow } from "@workspace/db";
import { CreateVideoJobBody, type VideoDiagnostics, type VideoJobInput, type VideoRenderOptions, type VideoSettingsInput } from "@workspace/api-zod";
import { ownerLock } from "../creative-service";
import { CreativeError } from "../creative-policy";
import { costNote, eligibleConcept, quotaDay } from "./policy";
import { videoFile } from "./storage";
import { getSettings, costRecord, enforceBudgets } from "../operations/controls";
import { finalStale, filePermission } from "../operations/final-review";
import { prepareText, TextLayoutError } from "./layout";
import { notifyVideoWork } from "./signals";
import { CLEANUP_PENDING, previousVideoError, cleanVideoObjects } from "./result-cleanup";
import { legacyLogoIds } from "./branding";
import { STUDIO_REFERENCE_POLICY } from "../studio-references";

export const globalVideoLock = (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => tx.execute(sql`SELECT pg_advisory_xact_lock(7101700)`);
export const videoAdmin = (me: Pick<MemberRecord, "role">) => ["SUPER_ADMIN", "ADMIN"].includes(me.role);
export async function settings() {
  return getSettings();
}
export async function monthlyUsage() {
  const month = quotaDay().slice(0, 7);
  const rows = await db.select().from(videoJobs).where(sql`${videoJobs.quotaDay} LIKE ${month + "%"}`);
  const names = await db.select({ id: members.id, name: members.name }).from(members);
  const byMember = new Map<string, { userId: string; name: string; jobs: number; failures: number; retries: number; knownProviderUsd: number; unknownCosts: number }>();
  for (const r of rows.filter(r => !r.simulation)) {
    let item = byMember.get(r.ownerId);
    if (!item) { item = { userId: r.ownerId, name: names.find(n => n.id === r.ownerId)?.name ?? "Anggota", jobs: 0, failures: 0, retries: 0, knownProviderUsd: 0, unknownCosts: 0 }; byMember.set(r.ownerId, item); }
    item.jobs++; item.failures += r.status === "FAILED" ? 1 : 0;
    item.retries += Math.max(0, r.attempts - 1);
    item.knownProviderUsd += r.providerCostUsd ?? 0;
    item.unknownCosts += r.actualCostUsd === null ? 1 : 0;
  }
  const people = [...byMember.values()];
  return { ...(await settings()), month, members: people, knownProviderUsd: people.reduce((a, r) => a + r.knownProviderUsd, 0), unknownCosts: people.reduce((a, r) => a + r.unknownCosts, 0), costNote };
}
export async function videoConfig(me: MemberRecord) {
  const config = await settings();
  const [count] = await db.select({ n: sql<number>`count(*)::int` }).from(videoJobs).where(and(
    eq(videoJobs.ownerId, me.id), eq(videoJobs.quotaDay, quotaDay()), eq(videoJobs.simulation, false),
  ));
  return {
    paused: config.paused || !config.localEnabled, aiEnabled: false, provider: "local-compositor", dailyLimit: config.dailyLimit, dailyUsed: count!.n,
    timezone: "Asia/Jakarta", costNote,
    retentionNote: "Hasil privat disimpan sampai dihapus pemilik/admin; tidak ada penghapusan otomatis hasil asli. File temporer dibersihkan setelah proses.",
    narrationNote: "Tanpa TTS/LLM. Unggah satu MP3/WAV maksimal5MiB lewat bahan konsep dan review ulang, atau hasil tanpa narasi. Rekaman dipotong mengikuti durasi10–15detik; isi suara diperiksa manusia. Cue subtitle disesuaikan manual.",
  };
}
export async function serializeJob(job: VideoJobRow, viewer?: MemberRecord) {
  const state = job.reviewBinding ? await finalStale(job) : { stale: false };
  const canServe = !viewer || filePermission(job, viewer);
  const publish = job.publicationStatus === "APPROVED_FOR_PUBLICATION" && !state.stale && !job.deleted;
  return { ...job, options: job.options as VideoRenderOptions,
    cleanupPending: job.deleted && !!job.error?.includes(CLEANUP_PENDING),
    error: previousVideoError(job.error),
    diagnostics: job.simulation ? null : job.diagnostics as VideoDiagnostics | null,
    cost: costRecord(job), publicationStale: state.stale,
    retentionNoticeAt: job.retentionNoticeAt?.toISOString() ?? null,
    publicationStatus: job.publicationStatus === "APPROVED_FOR_PUBLICATION" && state.stale ? "REVISION_REQUIRED" : job.publicationStatus,
    publicationUrl: publish && canServe ? `/api/video/jobs/${job.id}/file?publication=1&download=1` : null,
    createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(), submittedAt: job.submittedAt?.toISOString() ?? null,
    resultUrl: canServe && job.status === "COMPLETED" && !job.deleted && job.resultPath ? `/api/video/jobs/${job.id}/file` : null,
    rawResultUrl: null,
  };
}
export async function listJobs(me: MemberRecord) {
  return db.select().from(videoJobs).where(videoAdmin(me) ? undefined : me.role === "REVIEWER_COMPLIANCE"
    ? sql`${videoJobs.ownerId} = ${me.id} OR (${videoJobs.publicationStatus} = 'WAITING_FINAL_REVIEW' AND (${videoJobs.reviewerId} IS NULL OR ${videoJobs.reviewerId} = ${me.id})) OR ${videoJobs.reviewerId} = ${me.id}`
    : eq(videoJobs.ownerId, me.id)).orderBy(desc(videoJobs.createdAt)).limit(100);
}
export async function readJob(id: string, me: MemberRecord) {
  const [job] = await db.select().from(videoJobs).where(eq(videoJobs.id, id));
  if (me.status !== "ACTIVE" || !job || (job.ownerId !== me.id && !videoAdmin(me) &&
    !(me.role === "REVIEWER_COMPLIANCE" && (job.reviewerId === me.id || (job.publicationStatus === "WAITING_FINAL_REVIEW" && !job.reviewerId))))) throw new CreativeError(404, "Video tidak ditemukan atau tidak diizinkan.");
  return job;
}
export async function createJob(raw: unknown, me: MemberRecord, studioFolderId?: string) {
  const input = CreateVideoJobBody.parse(raw);
  if (me.status !== "ACTIVE" || me.role === "VIEWER" || !input.confirmed) throw new CreativeError(403, "Hak tulis aktif dan konfirmasi pekerjaan diperlukan.");
  if (input.mode !== "HEMAT") throw new CreativeError(409, "AI belum memiliki provider disetujui. Mock adalah simulasi, bukan hasil video AI.");
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const queued = await db.transaction(async tx => {
    await ownerLock(tx, me.id);
    await globalVideoLock(tx);
    const [old] = await tx.select().from(videoJobs).where(and(eq(videoJobs.ownerId, me.id), eq(videoJobs.requestKey, input.requestKey)));
    if (old) {
      if (old.requestHash !== requestHash) throw new CreativeError(409, "Kunci permintaan sudah digunakan dengan isi berbeda. Buat versi baru secara sadar.");
      return old;
    }
    const valid = await eligibleConcept(input.conceptId, input.version, me, input.options, tx, studioFolderId);
    // Ignore caller-supplied exclusions: only this owner's recorded old logos
    // from this concept may be excluded. Persist the result for worker restarts.
    const renderOptions = { ...input.options };
    delete renderOptions.referencePolicy;
    delete renderOptions.studioFolderId;
    if (studioFolderId) {
      renderOptions.referencePolicy = STUDIO_REFERENCE_POLICY;
      renderOptions.studioFolderId = studioFolderId;
    }
    delete renderOptions.legacyLogoAttachmentIds;
    if (renderOptions.brandingMode === "NONE") {
      delete renderOptions.logoAttachmentId;
      const previous = await tx.select({ options: videoJobs.options }).from(videoJobs).where(and(
        eq(videoJobs.ownerId, me.id), eq(videoJobs.conceptId, input.conceptId),
      ));
      renderOptions.legacyLogoAttachmentIds = legacyLogoIds(previous.map(j => j.options as VideoRenderOptions), valid.materials);
    }
    try { await prepareText(valid.chunks, valid.data.cta, valid.data.disclaimer ?? ""); }
    catch (err) {
      if (err instanceof TextLayoutError) throw new CreativeError(400, err.message);
      throw err;
    }
    const conf = await getSettings(tx);
    enforceBudgets(conf, await tx.select().from(videoJobs), me.id, 0, false);
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(videoJobs).where(and(
      eq(videoJobs.ownerId, me.id), eq(videoJobs.quotaDay, quotaDay()), eq(videoJobs.simulation, false),
    ));
    if (count!.n >= conf.dailyLimit) throw new CreativeError(409, `Batas${conf.dailyLimit} pekerjaan/hari tercapai (Asia/Jakarta), termasuk gagal/dibatalkan setelah antre.`);
    const [job] = await tx.insert(videoJobs).values({
      id: randomUUID(), ownerId: me.id, conceptId: valid.row.id, conceptVersion: valid.row.version,
      characterId: valid.character.id, requestKey: input.requestKey, requestHash, title: valid.data.title,
      options: renderOptions, durationSeconds: valid.data.durationSeconds, quotaDay: quotaDay(),
      model: "ffmpeg-local", costSource: "LOCAL_NO_PAID_API", costDetails: { renderUsd: null, ttsUsd: 0, retryUsd: 0 },
    }).returning();
    await tx.insert(auditLog).values({ id: randomUUID(), userId: me.id, action: "VIDEO_QUEUED", description: `Pekerjaan Hemat ${job!.id} masuk antrean; tanpa panggilan AI berbayar.` });
    return job!;
  });
  // Only wake after commit; a worker must never observe an uncommitted job.
  if (queued.status === "QUEUED") notifyVideoWork();
  return queued;
}
export async function cancelJob(id: string, me: MemberRecord) {
  if (me.role === "VIEWER") throw new CreativeError(403, "Pengamat hanya dapat membaca.");
  return db.transaction(async tx => {
    const job = await readJob(id, me);
    if (job.ownerId !== me.id && !videoAdmin(me)) throw new CreativeError(403, "Reviewer tidak dapat membatalkan video anggota lain.");
    const [changed] = await tx.update(videoJobs).set({ status: "CANCELLED", updatedAt: new Date(), error: "Dibatalkan pengguna. Slot harian tetap tercatat." })
      .where(and(eq(videoJobs.id, job.id), sql`${videoJobs.status} IN ('QUEUED','READY','PROCESSING')`)).returning();
    if (!changed) throw new CreativeError(409, "Status tidak dapat dibatalkan atau sudah selesai.");
    await tx.insert(auditLog).values({ id: randomUUID(), userId: me.id, action: "VIDEO_CANCELLED", description: `Pembatalan pekerjaan ${job.id}; bukan jaminan pengembalian biaya provider.` });
    return changed;
  });
}
export async function deleteResult(id: string, me: MemberRecord) {
  if (me.role === "VIEWER") throw new CreativeError(403, "Pengamat hanya dapat membaca.");
  const job = await readJob(id, me);
  if (job.ownerId !== me.id && !videoAdmin(me)) throw new CreativeError(403, "Reviewer tidak dapat menghapus video anggota lain.");
  if (!["COMPLETED", "FAILED", "CANCELLED", "UNKNOWN"].includes(job.status)) throw new CreativeError(409, "Batalkan pekerjaan aktif sebelum menghapus.");
  // Revoke access first. Preserve an explicit retry state until EVERY object is gone.
  const originalError = previousVideoError(job.error);
  await db.update(videoJobs).set({
    deleted: true, updatedAt: new Date(),
    error: `${originalError ? `${originalError}\n` : ""}${CLEANUP_PENDING} Pembersihan file belum selesai.`,
  }).where(eq(videoJobs.id, id));
  const complete = await cleanVideoObjects(job, path => videoFile(path).delete({ ignoreNotFound: true }));
  if (!complete) {
    throw new CreativeError(503, "Akses video sudah ditutup, tetapi sebagian file belum terhapus. Klik Ulangi penghapusan untuk membersihkan storage.");
  }
  await db.update(videoJobs).set({ error: originalError, updatedAt: new Date() }).where(eq(videoJobs.id, id));
  await db.insert(auditLog).values({ id: randomUUID(), userId: me.id, action: "VIDEO_DELETED", description: `Hasil ${id} dihapus; riwayat job/biaya dipertahankan.` });
}
export async function updateSettings(input: VideoSettingsInput, me: MemberRecord) {
  if (!videoAdmin(me)) throw new CreativeError(403, "Pengaturan video hanya untuk admin.");
  await db.transaction(async tx => {
    await globalVideoLock(tx);
    await tx.insert(videoSettings).values({ id: "main", ...input }).onConflictDoUpdate({ target: videoSettings.id, set: input });
    await tx.insert(auditLog).values({ id: randomUUID(), userId: me.id, action: "VIDEO_SETTINGS", description: "Batas anggaran/jeda video diubah; provider AI tetap nonaktif." });
  });
  notifyVideoWork(); // Resume already-persisted work after an authorized unpause.
  return monthlyUsage();
}
