import { Router } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, desc, sql } from "drizzle-orm";
import { db, creativeConcepts, conceptAttachments, creativeReviews, auditLog, members } from "@workspace/db";
import {
  PreviewCreativePromptBody, PreviewCreativePromptResponse, ListCreativeConceptsResponse,
  GetCreativeConceptParams, UpdateCreativeConceptParams, UpdateCreativeConceptBody,
  DeleteCreativeConceptParams, DeleteCreativeConceptBody,
  TransitionCreativeConceptParams, TransitionCreativeConceptBody,
} from "@workspace/api-zod";
import { buildCreative, parseConcept, staleReasons, type CreativeSnapshot } from "../lib/creative-builder";
import { canReadConcept, checkTransition, checkVersion, CreativeError, requireOwnerEditor, limits } from "../lib/creative-policy";
import { readConcept, readyMaterials, serializeConcept, ownerLock } from "../lib/creative-service";
import { captureVersion } from "../lib/operations/versions";
import { audit } from "../lib/operations/audit";

export const creativeConceptRouter = Router();
creativeConceptRouter.get("/concepts", async (req, res) => {
  const me = req.member!;
  // Server-side filtering keeps private drafts out of reviewer responses.
  const filter = ["SUPER_ADMIN", "ADMIN"].includes(me.role) ? undefined
    : me.role === "REVIEWER_COMPLIANCE"
      ? sql`${creativeConcepts.ownerId} = ${me.id} OR (${creativeConcepts.submittedAt} IS NOT NULL AND ${creativeConcepts.status} <> 'DRAFT')`
      : eq(creativeConcepts.ownerId, me.id);
  const rows = await db.select().from(creativeConcepts).where(filter).orderBy(desc(creativeConcepts.updatedAt));
  res.json(ListCreativeConceptsResponse.parse(await Promise.all(rows.filter(r => canReadConcept(me, r)).map(r => serializeConcept(r, me)))));
});
creativeConceptRouter.post("/preview", async (req, res) => {
  if (req.member!.role === "VIEWER") throw new CreativeError(403, "Pengamat hanya memiliki akses baca.");
  const input = parseConcept(PreviewCreativePromptBody.parse(req.body));
  const built = await buildCreative(input, req.member!);
  res.json(PreviewCreativePromptResponse.parse(built));
});
creativeConceptRouter.post("/concepts", async (req, res) => {
  const me = req.member!;
  if (me.role === "VIEWER") throw new CreativeError(403, "Pengamat tidak dapat membuat konsep.");
  const input = parseConcept(req.body);
  const row = await db.transaction(async tx => {
    await ownerLock(tx, me.id);
    const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(creativeConcepts).where(eq(creativeConcepts.ownerId, me.id));
    if (count!.total >= limits.maxConcepts) throw new CreativeError(409, "Maksimal 10 konsep tersimpan. Hapus konsep yang tidak diperlukan.");
    const built = await buildCreative(input, me, tx);
    const [saved] = await tx.insert(creativeConcepts).values({
      id: randomUUID(), ownerId: me.id, data: input, snapshot: built.snapshot,
      prompt: built.prompt, warnings: built.warnings, blockers: built.blockers,
    }).returning();
    await captureVersion(saved!, tx);
    await tx.insert(auditLog).values({ id: randomUUID(), userId: me.id, action: "CONCEPT_CREATED", description: "Draft konsep disimpan, tanpa generasi media." });
    return saved!;
  });
  res.json(await serializeConcept(row, me));
});
creativeConceptRouter.get("/concepts/:id", async (req, res) => {
  const { id } = GetCreativeConceptParams.parse(req.params);
  const row = await readConcept(id, req.member!);
  res.json(await serializeConcept(row, req.member!));
});
creativeConceptRouter.put("/concepts/:id", async (req, res) => {
  const { id } = UpdateCreativeConceptParams.parse(req.params);
  const { version, ...data } = UpdateCreativeConceptBody.parse(req.body);
  const input = parseConcept(data);
  const me = req.member!;
  const saved = await db.transaction(async tx => {
    await ownerLock(tx, me.id);
    const row = await readConcept(id, me, tx);
    requireOwnerEditor(me, row);
    checkVersion(row.version, version);
    await captureVersion(row, tx);
    const materials = await readyMaterials(id, tx);
    const built = await buildCreative(input, me, tx, materials);
    const [result] = await tx.update(creativeConcepts).set({
      data: input, snapshot: built.snapshot, prompt: built.prompt,
      warnings: built.warnings, blockers: built.blockers,
      version: version + 1, status: row.status === "DRAFT" ? "DRAFT" : "REVISED", submittedAt: null, updatedAt: new Date(),
    }).where(eq(creativeConcepts.id, id)).returning();
    await captureVersion(result!, tx);
    await tx.insert(auditLog).values({ id: randomUUID(), userId: me.id, action: "CONCEPT_UPDATED", description: "Isi konsep diperbarui; persetujuan lama tidak berlaku, status kembali Draft." });
    return result!;
  });
  res.json(await serializeConcept(saved, me));
});
creativeConceptRouter.delete("/concepts/:id", async (req, res) => {
  const { id } = DeleteCreativeConceptParams.parse(req.params);
  const { version } = DeleteCreativeConceptBody.parse(req.body);
  const me = req.member!;
  await db.transaction(async tx => {
    await ownerLock(tx, me.id);
    const row = await readConcept(id, me, tx);
    requireOwnerEditor(me, row); checkVersion(row.version, version);
    await captureVersion(row, tx);
    // Keep tombstones until the original signed PUT has expired, then global
    // cleanup deletes staging AND final bytes even if owner never returns.
    await tx.update(conceptAttachments).set({
      conceptId: null, state: "REMOVED",
      expiresAt: sql`LEAST(${conceptAttachments.expiresAt}, NOW() + INTERVAL '16 minutes')`,
    }).where(eq(conceptAttachments.conceptId, id));
    await tx.delete(creativeConcepts).where(eq(creativeConcepts.id, id));
    await tx.insert(auditLog).values({ id: randomUUID(), userId: me.id, action: "CONCEPT_DELETED", description: "Konsep dihapus; bahan privat dijadwalkan untuk pembersihan setelah izin PUT habis." });
  });
  res.json({ ok: true });
});
creativeConceptRouter.post("/concepts/:id/status", async (req, res) => {
  const { id } = TransitionCreativeConceptParams.parse(req.params);
  const input = TransitionCreativeConceptBody.parse(req.body);
  const me = req.member!;
  const updated = await db.transaction(async tx => {
    const existing = await readConcept(id, me);
    await ownerLock(tx, existing.ownerId);
    const row = await readConcept(id, me, tx);
    checkVersion(row.version, input.version);
    checkTransition(me, row, input.status);
    await captureVersion(row, tx);
    if (input.status === "READY_FOR_REVIEW" || input.status === "APPROVED") {
      const reasons = await staleReasons(row.snapshot as CreativeSnapshot, tx);
      if (reasons.length || row.blockers.length) throw new CreativeError(409, "Konsep belum lengkap/rujukan berubah. Edit dan simpan ulang sebelum review. " + [...reasons, ...row.blockers].join(" "));
      const data = parseConcept(row.data);
      const [owner] = await tx.select().from(members).where(eq(members.id, row.ownerId));
      const built = await buildCreative(data, owner!, tx, await readyMaterials(id, tx));
      if (built.blockers.length) throw new CreativeError(409, built.blockers.join(" "));
      if (!data.publicMode) throw new CreativeError(409, "Konsep internal tidak dapat disetujui untuk publik.");
      const files = await readyMaterials(id, tx);
      const pending = await tx.select({ id: conceptAttachments.id }).from(conceptAttachments).where(and(eq(conceptAttachments.conceptId, id), eq(conceptAttachments.state, "PENDING"))).limit(1);
      if (pending.length) throw new CreativeError(409, "Selesaikan atau hapus unggahan tertunda sebelum review.");
      if (files.length && !data.materialConsent) throw new CreativeError(409, "Nyatakan semua bahan boleh digunakan untuk publik sebelum mengajukan review.");
      // A reviewer must explicitly record the human examination, not a blank click.
      if (input.status === "APPROVED" && !input.note.trim()) throw new CreativeError(400, "Tuliskan catatan pemeriksaan manusia sebelum menyetujui.");
      if (input.status === "APPROVED" && (!input.factsChecked || input.note.trim().length < 10)) throw new CreativeError(400, "Reviewer wajib memeriksa seluruh klaim/naskah/bahan; tandai pemeriksaan fakta dan tulis catatan minimal10karakter.");
    }
    const nextVersion = row.version + 1;
    await tx.insert(creativeReviews).values({
      id: randomUUID(), conceptId: id, actorId: me.id, action: input.status,
      note: input.note, version: nextVersion,
    });
    const [result] = await tx.update(creativeConcepts).set({
      status: input.status, version: nextVersion, updatedAt: new Date(),
      submittedAt: input.status === "DRAFT" ? null : row.submittedAt ?? new Date(),
    }).where(eq(creativeConcepts.id, id)).returning();
    await captureVersion(result!, tx);
    await audit(me.id, `CONTENT_${input.status}`, id, { version: row.version, status: row.status }, { version: nextVersion, status: input.status, note: input.note, factsChecked: input.factsChecked }, tx);
    await tx.insert(auditLog).values({ id: randomUUID(), userId: me.id, action: `CONCEPT_${input.status}`, description: "Status konsep diubah dengan pemeriksaan hak akses dan pemisahan pembuat/reviewer." });
    return result!;
  });
  res.json(await serializeConcept(updated, me));
});
