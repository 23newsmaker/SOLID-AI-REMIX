import { eq, and, lt, sql } from "drizzle-orm";
import { db, videoJobs, videoSettings, type MemberRecord } from "@workspace/db";
import { ApproveRetentionPolicyBody } from "@workspace/api-zod";
import { CreativeError, libraryAdmin } from "../creative-policy";
import { getSettings, settingsView } from "./controls";
import { serializeJob } from "../video/service";
import { videoFile } from "../video/storage";
import { audit } from "./audit";

export async function retentionPreview(me: MemberRecord) {
  if (!libraryAdmin(me) || me.status !== "ACTIVE") throw new CreativeError(403, "Retensi hanya admin aktif.");
  const c = await getSettings();
  const candidates = c.retentionDays === null ? [] : await db.select().from(videoJobs).where(and(
    eq(videoJobs.deleted, false), eq(videoJobs.status, "COMPLETED"),
    lt(videoJobs.createdAt, new Date(Date.now() - c.retentionDays * 86400_000)),
  ));
  return { settings: settingsView(c),
    warning: "Default manual. Kebijakan tertentu wajib disetujui SUPER_ADMIN. Hasil akhir yang memenuhi umur simpan akan diberi peringatan minimal24jam sebelum dihapus permanen, termasuk hasil disetujui. Karakter, bahan sumber, KB, riwayat biaya/review/audit tidak dihapus.",
    candidates: await Promise.all(candidates.map(j => serializeJob(j, me))) };
}
export async function approveRetention(body: unknown, me: MemberRecord) {
  if (me.role !== "SUPER_ADMIN" || me.status !== "ACTIVE") throw new CreativeError(403, "Persetujuan kebijakan penghapusan hanya pemilik/admin utama.");
  const input = ApproveRetentionPolicyBody.parse(body);
  if (!input.confirmed) throw new CreativeError(400, "Konfirmasi dampak penghapusan permanen diperlukan.");
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(7101700)`);
    const c = await getSettings(tx);
    if (c.retentionDays === null || c.retentionVersion !== input.version) throw new CreativeError(409, "Kebijakan manual/berubah; tinjau pratinjau terbaru.");
    await tx.update(videoSettings).set({ retentionApprovedVersion: c.retentionVersion, retentionApprovedBy: me.id, retentionApprovedAt: new Date() }).where(eq(videoSettings.id, "main"));
    await audit(me.id, "RETENTION_POLICY_APPROVED", "main", { version: c.retentionVersion }, { days: c.retentionDays, version: c.retentionVersion, warningHours: 24, note: input.note }, tx);
  });
  return retentionPreview(me);
}
export async function runRetention() {
  const c = await getSettings();
  if (c.retentionDays === null || c.retentionApprovedVersion !== c.retentionVersion || !c.retentionApprovedBy) return;
  const jobs = await db.select().from(videoJobs).where(and(eq(videoJobs.deleted, false), eq(videoJobs.status, "COMPLETED"),
    lt(videoJobs.createdAt, new Date(Date.now() - c.retentionDays * 86400_000)),
    // Waiting notices must not occupy all 20 slots and starve older results behind them.
    sql`(${videoJobs.retentionNoticeVersion} IS DISTINCT FROM ${c.retentionVersion} OR ${videoJobs.retentionNoticeAt} IS NULL OR ${videoJobs.retentionNoticeAt} <= ${new Date(Date.now() - 86400_000)})`,
  )).limit(20);
  for (const job of jobs) {
    if (!job.retentionNoticeAt || job.retentionNoticeVersion !== c.retentionVersion) {
      await db.transaction(async tx => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(7101700)`);
        const current = await getSettings(tx);
        if (current.retentionVersion !== c.retentionVersion || current.retentionApprovedVersion !== c.retentionVersion || current.retentionDays === null) return;
        await tx.update(videoJobs).set({ retentionNoticeAt: new Date(), retentionNoticeVersion: c.retentionVersion }).where(eq(videoJobs.id, job.id));
        await audit(c.retentionApprovedBy!, "RETENTION_NOTICE", job.id, null, { policyVersion: c.retentionVersion, warningHours: 24 }, tx);
      });
      continue;
    }
    if (job.retentionNoticeAt.getTime() > Date.now() - 86400_000) continue;
    // Serialize against policy edits immediately before revoking and deleting bytes.
    const revoked = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(7101700)`);
      const current = await getSettings(tx);
      if (current.retentionVersion !== c.retentionVersion || current.retentionApprovedVersion !== c.retentionVersion || current.retentionDays === null) return false;
      await tx.update(videoJobs).set({ deleted: true, updatedAt: new Date() }).where(and(eq(videoJobs.id, job.id), eq(videoJobs.deleted, false)));
      await audit(c.retentionApprovedBy!, "RETENTION_RESULT_DELETED", job.id, { deleted: false }, { deleted: true, policyVersion: c.retentionVersion }, tx);
      return true;
    });
    if (revoked) for (const p of [job.resultPath, job.rawResultPath].filter((x): x is string => !!x)) await videoFile(p).delete({ ignoreNotFound: true });
  }
}
