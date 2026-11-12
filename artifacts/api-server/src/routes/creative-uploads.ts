import { Router } from "express";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, conceptAttachments, creativeConcepts, auditLog } from "@workspace/db";
import { rateLimit } from "express-rate-limit";
import {
  RequestConceptUploadParams, RequestConceptUploadBody, RequestConceptUploadResponse,
  FinalizeConceptUploadParams, FinalizeConceptUploadBody, DeleteConceptAttachmentParams,
  DeleteConceptAttachmentBody, GetConceptAttachmentParams,
} from "@workspace/api-zod";
import { CreativeError, checkVersion, checkQuota, requireOwnerEditor, limits } from "../lib/creative-policy";
import { creativeStorage, creativeFile, boundedMaterial, validateMaterial, cleanupCreativeObjects } from "../lib/creative-storage";
import { setObjectAclPolicy } from "../lib/objectAcl";
import { ownerLock, readConcept, rebuildConcept, serializeConcept } from "../lib/creative-service";
import { captureVersion } from "../lib/operations/versions";
import { parseConcept } from "../lib/creative-builder";
import { materialConsentForSave, materialConsentEvidence } from "../lib/studio-policy";

export const creativeUploadRouter = Router();
creativeUploadRouter.post("/concepts/:id/uploads", rateLimit({
  windowMs: 60 * 60_000, limit: 12, keyGenerator: req => req.member!.id,
  standardHeaders: "draft-7", legacyHeaders: false,
  message: { error: "Batas 12 permintaan unggah per jam tercapai." },
}), async (req, res) => {
  const { id } = RequestConceptUploadParams.parse(req.params);
  const input = RequestConceptUploadBody.parse(req.body);
  const me = req.member!;
  await cleanupCreativeObjects();
  const result = await db.transaction(async tx => {
    await ownerLock(tx, me.id);
    const row = await readConcept(id, me, tx);
    requireOwnerEditor(me, row); checkVersion(row.version, input.version);
    await captureVersion(row, tx);
    const reservations = await tx.select().from(conceptAttachments).where(eq(conceptAttachments.conceptId, id));
    checkQuota(reservations, input);
    const [ownerBytes] = await tx.select({ bytes: sql<number>`COALESCE(sum(${conceptAttachments.size}), 0)::bigint` })
      .from(conceptAttachments).where(eq(conceptAttachments.ownerId, me.id));
    if (Number(ownerBytes!.bytes) + input.size > limits.maxConcepts * limits.maxTotalBytes) {
      throw new CreativeError(409, "Kuota penyimpanan anggota termasuk unggahan tertunda/pembersihan terlampaui. Tunggu pembersihan selesai.");
    }
    const uploadURL = await creativeStorage.getObjectEntityUploadURL();
    const stagingPath = creativeStorage.normalizeObjectEntityPath(uploadURL.split("?")[0]!);
    if (!stagingPath.startsWith("/objects/uploads/")) throw new Error("Invalid staging object");
    const uploadId = randomUUID();
    await tx.insert(conceptAttachments).values({
      id: uploadId, conceptId: id, ownerId: me.id, name: input.name, contentType: input.contentType,
      size: input.size, stagingPath, expiresAt: new Date(Date.now() + 15 * 60_000),
    });
    return { uploadId, uploadURL };
  });
  res.json(RequestConceptUploadResponse.parse(result));
});
creativeUploadRouter.post("/concepts/:id/uploads/:uploadId", async (req, res) => {
  const { id, uploadId } = FinalizeConceptUploadParams.parse(req.params);
  const { version } = FinalizeConceptUploadBody.parse(req.body);
  const me = req.member!;
  let createdFinal: string | null = null;
  let committed = false;
  try {
    const result = await db.transaction(async tx => {
      await ownerLock(tx, me.id);
      const row = await readConcept(id, me, tx);
      requireOwnerEditor(me, row); checkVersion(row.version, version);
      await captureVersion(row, tx);
      const [ticket] = await tx.select().from(conceptAttachments).where(and(
        eq(conceptAttachments.id, uploadId), eq(conceptAttachments.conceptId, id), eq(conceptAttachments.ownerId, me.id),
      )).for("update");
      if (!ticket || ticket.state !== "PENDING" || ticket.expiresAt < new Date()) throw new CreativeError(400, "Unggahan tidak valid, telah dipakai, atau kedaluwarsa.");
      const file = creativeFile(ticket.stagingPath);
      const [meta] = await file.getMetadata();
      if (Number(meta.size) !== ticket.size || meta.contentType !== ticket.contentType) throw new CreativeError(400, "Jenis/ukuran unggahan berbeda dari reservasi.");
      const bytes = await boundedMaterial(ticket.stagingPath, ticket.size);
      const validated = await validateMaterial(bytes, ticket.contentType);
      const others = await tx.select().from(conceptAttachments).where(eq(conceptAttachments.conceptId, id));
      checkQuota(others.filter(r => r.id !== uploadId), { contentType: ticket.contentType, size: validated.length });
      const finalPath = `/objects/concepts/${randomUUID()}`;
      createdFinal = finalPath;
      await creativeFile(finalPath).save(validated, { contentType: ticket.contentType, resumable: false, metadata: { cacheControl: "private, no-store" } });
      await setObjectAclPolicy(creativeFile(finalPath), { owner: me.id, visibility: "private" });
      await tx.update(conceptAttachments).set({ state: "READY", finalPath, size: validated.length }).where(eq(conceptAttachments.id, ticket.id));
      const data = parseConcept(row.data);
      const materialConsent = materialConsentForSave(false, req.studioFolderId);
      if (req.studioFolderId) await tx.insert(auditLog).values({
        id: randomUUID(), userId: me.id, action: "STUDIO_MATERIAL_ADDED", objectId: uploadId,
        description: "Bahan disimpan berdasarkan izin internal pemilik studio.",
        after: materialConsentEvidence(materialConsent, req.studioFolderId),
      });
      return rebuildConcept({ ...row, data: { ...data, materialConsent } }, me, tx, req.studioFolderId);
    });
    committed = true;
    res.json(await serializeConcept(result, me, req.studioFolderId));
  } catch (error) {
    if (createdFinal && !committed) {
      // The pending ticket survives rollback, recording this orphan for retry
      // even if object deletion is temporarily unavailable.
      try { await creativeFile(createdFinal).delete({ ignoreNotFound: true }); }
      catch {
        await db.insert(conceptAttachments).values({
          id: randomUUID(), ownerId: me.id, conceptId: null, name: "cleanup",
          contentType: "application/octet-stream", size: 0, stagingPath: "", finalPath: createdFinal,
          state: "REMOVED", expiresAt: new Date(),
        });
      }
    }
    throw error;
  }
});
creativeUploadRouter.delete("/concepts/:id/uploads/:uploadId", async (req, res) => {
  const { id, uploadId } = DeleteConceptAttachmentParams.parse(req.params);
  const { version } = DeleteConceptAttachmentBody.parse(req.body);
  const me = req.member!;
  const result = await db.transaction(async tx => {
    await ownerLock(tx, me.id);
    const row = await readConcept(id, me, tx);
    requireOwnerEditor(me, row); checkVersion(row.version, version);
    await captureVersion(row, tx);
    const [attachment] = await tx.select().from(conceptAttachments).where(and(
      eq(conceptAttachments.id, uploadId), eq(conceptAttachments.conceptId, id), eq(conceptAttachments.ownerId, me.id),
    )).for("update");
    if (!attachment || attachment.state === "REMOVED") throw new CreativeError(404, "Bahan tidak ditemukan.");
    await tx.update(conceptAttachments).set({
      state: "REMOVED", expiresAt: sql`LEAST(${conceptAttachments.expiresAt}, NOW() + INTERVAL '16 minutes')`,
    }).where(eq(conceptAttachments.id, attachment.id));
    const data = parseConcept(row.data);
    const materialConsent = materialConsentForSave(false, req.studioFolderId);
    if (req.studioFolderId) await tx.insert(auditLog).values({
      id: randomUUID(), userId: me.id, action: "STUDIO_MATERIAL_REMOVED", objectId: uploadId,
      description: "Bahan dilepas; bahan studio lainnya mengikuti izin internal pemilik.",
      after: materialConsentEvidence(materialConsent, req.studioFolderId),
    });
    return rebuildConcept({ ...row, data: { ...data, materialConsent } }, me, tx, req.studioFolderId);
  });
  res.json(await serializeConcept(result, me, req.studioFolderId));
});
creativeUploadRouter.get("/concepts/:id/attachments/:uploadId", async (req, res, next) => {
  const { id, uploadId } = GetConceptAttachmentParams.parse(req.params);
  await readConcept(id, req.member!);
  const [a] = await db.select().from(conceptAttachments).where(and(
    eq(conceptAttachments.id, uploadId), eq(conceptAttachments.conceptId, id), eq(conceptAttachments.state, "READY"),
  ));
  if (!a?.finalPath) throw new CreativeError(404, "Bahan tidak ditemukan.");
  res.set({
    "Content-Type": a.contentType, "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(a.name)}`,
  });
  creativeFile(a.finalPath).createReadStream().on("error", next).pipe(res);
});
