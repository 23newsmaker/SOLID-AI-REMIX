import { randomUUID } from "node:crypto";
import { eq, desc, inArray } from "drizzle-orm";
import { db, conceptVersions, creativeReviews, members, knowledgeSources, creativeConcepts, type MemberRecord } from "@workspace/db";
import { readyMaterials, type CreativeTx, type CreativeRow } from "../creative-service";
import { canReadConcept, CreativeError } from "../creative-policy";

export async function captureVersion(row: CreativeRow, tx: CreativeTx) {
  const reviews = await tx.select().from(creativeReviews).where(eq(creativeReviews.conceptId, row.id));
  const names = reviews.length ? await tx.select({ id: members.id, name: members.name }).from(members).where(inArray(members.id, reviews.map(r => r.actorId))) : [];
  const snapshot = { ...row, materials: await readyMaterials(row.id, tx),
    reviewHistory: reviews.map(r => ({ ...r, reviewerName: names.find(m => m.id === r.actorId)?.name ?? "Anggota" })) };
  await tx.insert(conceptVersions).values({ id: randomUUID(), conceptId: row.id, ownerId: row.ownerId, version: row.version, snapshot }).onConflictDoNothing();
}
export async function versions(id: string, me: MemberRecord) {
  const [current] = await db.select().from(creativeConcepts).where(eq(creativeConcepts.id, id));
  const rows = await db.select().from(conceptVersions).where(eq(conceptVersions.conceptId, id)).orderBy(desc(conceptVersions.version));
  if (!(current && canReadConcept(me, current)) && !rows.some(r => r.ownerId === me.id) && !["ADMIN", "SUPER_ADMIN"].includes(me.role)) throw new CreativeError(404, "Riwayat tidak diizinkan.");
  const privileged = ["SUPER_ADMIN", "ADMIN", "REVIEWER_COMPLIANCE"].includes(me.role);
  const sources = await db.select().from(knowledgeSources);
  const result = rows.map(r => {
    const s = r.snapshot as { status: string; snapshot: { sources: { id: string }[] }; data: { publicMode: boolean } };
    const denied = (s.snapshot?.sources ?? []).some(ref => {
      const source = sources.find(x => x.id === ref.id);
      return !source?.active || (!privileged && !["INTERNAL_GENERAL", "APPROVED_FOR_PUBLIC_CONTENT"].includes(source.access)) ||
        (s.data.publicMode && (source.validation !== "APPROVED" || source.access !== "APPROVED_FOR_PUBLIC_CONTENT"));
    });
    return { version: r.version, status: s.status, capturedAt: r.capturedAt.toISOString(), limited: denied,
      evidence: denied ? "Isi snapshot disembunyikan karena izin sumber berubah." : JSON.stringify(r.snapshot, null, 2) };
  });
  const legacy = await db.select().from(creativeReviews).where(eq(creativeReviews.conceptId, id));
  for (const r of legacy.filter(l => !rows.some(v => v.version === l.version))) result.push({
    version: r.version, status: r.action, capturedAt: r.createdAt.toISOString(), limited: true,
    evidence: "Riwayat sebelum penguncian snapshot: tindakan/versi tercatat, isi lama tidak dapat direkonstruksi.",
  });
  return result.sort((a, b) => b.version - a.version);
}
