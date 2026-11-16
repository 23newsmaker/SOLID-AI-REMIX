import { createHash, randomUUID } from "node:crypto";
import { and, eq, asc } from "drizzle-orm";
import { db, videoJobs, finalReviews, members, type MemberRecord, type VideoJobRow } from "@workspace/db";
import { TransitionFinalVideoReviewBody, type VideoRenderOptions } from "@workspace/api-zod";
import { CreativeError, libraryAdmin } from "../creative-policy";
import { readJob, serializeJob } from "../video/service";
import { eligibleConcept, eligibleAiConcept, jobReferenceFolder } from "../video/policy";
import { videoFile } from "../video/storage";
import { readyMaterials, type CreativeTx } from "../creative-service";
import { audit } from "./audit";

export const finalChecklist = ["IDENTITY", "VISUAL", "LOGO", "NUMBERS", "PRODUCT", "SUBTITLE", "AUDIO", "CTA", "DISCLAIMER", "CONCEPT"];
type Binding = { digest: string; resultHash: string; md5: string; generation: string };
export function filePermission(job: VideoJobRow, me: MemberRecord) {
  return job.ownerId === me.id || libraryAdmin(me) || (me.role === "REVIEWER_COMPLIANCE" && job.reviewerId === me.id);
}
async function currentDigest(job: VideoJobRow, tx?: CreativeTx) {
  if (!job.conceptId || job.status !== "COMPLETED" || job.deleted || job.simulation) throw new CreativeError(409, "MP4 final tidak tersedia.");
  const [owner] = await (tx ?? db).select().from(members).where(eq(members.id, job.ownerId));
  if (!owner) throw new CreativeError(409, "Pembuat tidak tersedia.");
  const options = job.options as VideoRenderOptions;
  const folderId = jobReferenceFolder(options);
  const valid = job.mode === "AI"
    ? await eligibleAiConcept(job.conceptId, job.conceptVersion, owner, tx, folderId)
    : await eligibleConcept(job.conceptId, job.conceptVersion, owner, options, tx, folderId);
  if (!folderId && valid.row.snapshot && (valid.row.snapshot as { policyVersion?: number }).policyVersion !== 2) throw new CreativeError(409, "Konsep lama perlu review fakta spesifik.");
  return createHash("sha256").update(JSON.stringify({
    data: valid.row.data, snapshot: valid.row.snapshot, prompt: valid.row.prompt,
    materials: valid.materials.map(m => [m.id, m.finalPath, m.size]), resultHash: job.resultHash,
  })).digest("hex");
}
export async function finalStale(job: VideoJobRow, checkFile = false, tx?: CreativeTx) {
  const b = job.reviewBinding as Binding | null;
  if (!b) return { stale: true, reasons: ["Video belum diajukan untuk review final dengan versi terikat."] };
  try {
    if (!job.resultHash || b.resultHash !== job.resultHash || b.digest !== await currentDigest(job, tx)) throw new Error();
    if (checkFile) {
      const [m] = await videoFile(job.resultPath!).getMetadata();
      if (m.md5Hash !== b.md5 || String(m.generation) !== b.generation) throw new Error();
    }
    return { stale: false, reasons: [] as string[] };
  } catch { return { stale: true, reasons: ["Hasil, versi konsep, karakter, bahan atau izin fakta/sumber berubah. Ajukan versi baru untuk review."] }; }
}
async function ensureHash(job: VideoJobRow, forceHash = false) {
  const file = videoFile(job.resultPath!);
  const [meta] = await file.getMetadata();
  if (!meta.size || Number(meta.size) > 20 * 1024 * 1024 || meta.contentType !== "video/mp4") throw new CreativeError(409, "Berkas final tidak layak diperiksa.");
  let resultHash = forceHash ? null : job.resultHash;
  if (!resultHash) {
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const part of file.createReadStream()) {
      bytes += part.length;
      if (bytes > 20 * 1024 * 1024) throw new CreativeError(409, "Ukuran video berubah.");
      hash.update(part);
    }
    resultHash = hash.digest("hex");
  }
  return { resultHash, md5: meta.md5Hash ?? "", generation: String(meta.generation) };
}
// Evidence capture is shared; a creator self-check is not a compliance decision.
export async function studioCheckBinding(job: VideoJobRow, forceHash = false, tx?: CreativeTx) {
  if (!job.conceptId || job.status !== "COMPLETED" || job.deleted || job.simulation || !job.resultPath) {
    throw new CreativeError(409, "Video nyata yang selesai diperlukan untuk pemeriksaan.");
  }
  const physical = await ensureHash(job, forceHash);
  if (!physical.md5 || !physical.generation) throw new CreativeError(409, "Identitas berkas hasil belum tersedia.");
  return { ...physical, digest: await currentDigest({ ...job, resultHash: physical.resultHash }, tx) };
}
export async function finalEvidence(id: string, me: MemberRecord) {
  const job = await readJob(id, me);
  const history = await db.select().from(finalReviews).where(eq(finalReviews.jobId, id)).orderBy(asc(finalReviews.createdAt));
  const names = await db.select({ id: members.id, name: members.name }).from(members);
  const stale = await finalStale(job);
  return { job: await serializeJob(job), ...stale,
    referenceUrl: filePermission(job, me) && !stale.stale ? `/api/video/jobs/${id}/reference` : null,
    conceptUrl: job.conceptId ? `/creative?concept=${job.conceptId}` : null,
    history: history.map(h => ({ version: h.version, status: h.action, capturedAt: h.createdAt.toISOString(), limited: false,
      evidence: JSON.stringify({ ...h, reviewerName: names.find(n => n.id === h.actorId)?.name ?? "Anggota" }, null, 2) })) };
}
export async function finalTransition(id: string, body: unknown, me: MemberRecord) {
  if (me.status !== "ACTIVE" || me.role === "VIEWER") throw new CreativeError(403, "Akses tulis aktif diperlukan.");
  const input = TransitionFinalVideoReviewBody.parse(body);
  await db.transaction(async tx => {
    const [job] = await tx.select().from(videoJobs).where(eq(videoJobs.id, id)).for("update");
    if (!job || job.status !== "COMPLETED" || job.deleted || job.simulation) throw new CreativeError(404, "Video final tidak tersedia.");
    if (job.publicationVersion !== input.version) throw new CreativeError(409, "Status review sudah berubah; muat ulang.");
    let status = job.publicationStatus, reviewerId = job.reviewerId, binding = job.reviewBinding as Binding | null;
    if (input.action === "SUBMIT") {
      if (job.ownerId !== me.id || !["GENERATED", "REJECTED", "REVISION_REQUIRED"].includes(status)) throw new CreativeError(403, "Hanya pembuat dapat mengajukan hasil yang belum disetujui.");
      const physical = await ensureHash(job);
      job.resultHash = physical.resultHash;
      binding = { ...physical, digest: await currentDigest(job, tx) };
      status = "WAITING_FINAL_REVIEW"; reviewerId = null;
    } else {
      if (!["SUPER_ADMIN", "REVIEWER_COMPLIANCE"].includes(me.role) || job.ownerId === me.id) throw new CreativeError(403, "Review final harus oleh compliance/admin utama selain pembuat.");
      if (status !== "WAITING_FINAL_REVIEW") throw new CreativeError(409, "Video tidak dalam antrean review.");
      if (input.action === "CLAIM") {
        if (reviewerId && reviewerId !== me.id) throw new CreativeError(409, "Video sedang diperiksa reviewer lain.");
        reviewerId = me.id;
      } else {
        if (reviewerId !== me.id) throw new CreativeError(403, "Ambil pekerjaan review terlebih dahulu.");
        if (input.note.trim().length < 10) throw new CreativeError(400, "Catatan pemeriksaan minimal10karakter.");
        if (input.action === "APPROVE") {
          const state = await finalStale(job, true, tx);
          if (state.stale) throw new CreativeError(409, state.reasons.join(" "));
          if (new Set(input.checklist).size !== 10 || !finalChecklist.every(k => input.checklist.includes(k as typeof input.checklist[number]))) throw new CreativeError(400, "Semua10pemeriksaan final wajib dinyatakan.");
          status = "APPROVED_FOR_PUBLICATION";
        } else status = input.action === "REJECT" ? "REJECTED" : "REVISION_REQUIRED";
      }
    }
    await tx.update(videoJobs).set({ publicationStatus: status, publicationVersion: job.publicationVersion + 1,
      reviewerId, reviewBinding: binding, resultHash: job.resultHash, updatedAt: new Date() }).where(eq(videoJobs.id, id));
    await tx.insert(finalReviews).values({ id: randomUUID(), jobId: id, actorId: me.id, action: status,
      note: input.note, checklist: input.checklist, binding: binding ?? {}, version: job.publicationVersion + 1 });
    await audit(me.id, `VIDEO_FINAL_${input.action}`, id, { status: job.publicationStatus, version: job.publicationVersion },
      { status, version: job.publicationVersion + 1, note: input.note, checklist: input.checklist }, tx);
  });
  return finalEvidence(id, me);
}
