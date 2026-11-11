import { and, eq, inArray, asc, sql } from "drizzle-orm";
import { db, creativeConcepts, conceptAttachments, creativeReviews, members, knowledgeSources, type MemberRecord } from "@workspace/db";
import { GetCreativeConceptResponse } from "@workspace/api-zod";
import { CreativeError, canReadConcept } from "./creative-policy";
import { buildCreative, parseConcept, staleReasons, type CreativeSnapshot } from "./creative-builder";
import { captureVersion } from "./operations/versions";

export type CreativeRow = typeof creativeConcepts.$inferSelect;
export type CreativeTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const ownerLock = (tx: CreativeTx, ownerId: string) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 71015))`);
export async function readConcept(id: string, member: MemberRecord, tx?: CreativeTx) {
  const conn = tx ?? db;
  const [row] = tx
    ? await tx.select().from(creativeConcepts).where(eq(creativeConcepts.id, id)).for("update")
    : await db.select().from(creativeConcepts).where(eq(creativeConcepts.id, id));
  if (!row || !canReadConcept(member, row)) throw new CreativeError(404, "Konsep tidak ditemukan atau tidak diizinkan.");
  return row;
}
export async function readyMaterials(id: string, tx?: CreativeTx) {
  return (tx ?? db).select().from(conceptAttachments).where(and(eq(conceptAttachments.conceptId, id), eq(conceptAttachments.state, "READY"))).orderBy(asc(conceptAttachments.createdAt));
}
export async function rebuildConcept(row: CreativeRow, member: MemberRecord, tx: CreativeTx) {
  await captureVersion(row, tx);
  const input = parseConcept(row.data);
  const materials = await readyMaterials(row.id, tx);
  const built = await buildCreative(input, member, tx, materials);
  const [updated] = await tx.update(creativeConcepts).set({
    data: input, snapshot: built.snapshot, prompt: built.prompt,
    warnings: built.warnings, blockers: built.blockers, status: "DRAFT",
    submittedAt: null, version: row.version + 1, updatedAt: new Date(),
  }).where(eq(creativeConcepts.id, row.id)).returning();
  return updated!;
}
export async function serializeConcept(row: CreativeRow, viewer: MemberRecord) {
  const input = parseConcept(row.data);
  const snapshot = row.snapshot as CreativeSnapshot;
  const reasons = await staleReasons(snapshot);
  if (input.publicMode && snapshot.policyVersion !== 2) reasons.push("Persetujuan lama belum mengikat fakta spesifik; simpan dan review ulang.");
  const [owner] = await db.select({ name: members.name }).from(members).where(eq(members.id, row.ownerId));
  const attachments = await db.select().from(conceptAttachments).where(and(
    eq(conceptAttachments.conceptId, row.id), inArray(conceptAttachments.state, ["PENDING", "READY"]),
  )).orderBy(asc(conceptAttachments.createdAt));
  const reviews = await db.select().from(creativeReviews).where(eq(creativeReviews.conceptId, row.id)).orderBy(asc(creativeReviews.createdAt));
  // Snapshot permissions can be revoked after a save. Never expose an old
  // internal/restricted source merely because it was once readable.
  let redacted = false;
  if (snapshot.sources.length) {
    const sources = await db.select().from(knowledgeSources).where(inArray(knowledgeSources.id, snapshot.sources.map(s => s.id)));
    redacted = snapshot.sources.some(saved => {
      const s = sources.find(s => s.id === saved.id);
      return !s || !s.active || (!["SUPER_ADMIN", "ADMIN", "REVIEWER_COMPLIANCE"].includes(viewer.role) &&
        !["INTERNAL_GENERAL", "APPROVED_FOR_PUBLIC_CONTENT"].includes(s.access)) ||
        (input.publicMode && (s.validation !== "APPROVED" || s.access !== "APPROVED_FOR_PUBLIC_CONTENT"));
    });
  }
  return GetCreativeConceptResponse.parse({
    ...input, id: row.id, version: row.version, ownerId: row.ownerId, ownerName: owner?.name ?? "Anggota",
    characterName: snapshot.character.name, categoryName: snapshot.category.name, templateName: snapshot.template?.name ?? null,
    status: row.status, prompt: redacted ? "Prompt disembunyikan karena izin sumber berubah. Pembuat harus memvalidasi ulang." : row.prompt,
    warnings: row.warnings, blockers: [
      ...row.blockers, ...reasons, ...(redacted ? ["Akses sumber berubah."] : []),
      ...(attachments.some(a => a.state === "PENDING") ? ["Ada unggahan tertunda; selesaikan atau hapus sebelum review."] : []),
    ],
    stale: reasons.length > 0 || redacted, staleReasons: reasons,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    attachments: attachments.map(a => ({
      id: a.id, ownerId: a.ownerId, name: a.name, contentType: a.contentType, size: a.size,
      state: a.state, url: a.state === "READY" ? `/api/creative/concepts/${row.id}/attachments/${a.id}` : "",
    })),
    reviews: reviews.map(r => ({ ...r, createdAt: r.createdAt.toISOString() })),
  });
}
