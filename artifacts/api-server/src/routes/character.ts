import { Router } from "express";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db, characters, characterUploads, auditLog } from "@workspace/db";
import { RequestCharacterUploadBody, SaveCharacterBody, GetCharacterResponse, SaveCharacterResponse, RequestCharacterUploadResponse } from "@workspace/api-zod";
import { requireMember, requireActive, requireCharacterEditor } from "../middlewares/member";
import { ObjectStorageService, objectStorageClient } from "../lib/objectStorage";
import { setObjectAclPolicy } from "../lib/objectAcl";
import { rateLimit } from "express-rate-limit";

const storage = new ObjectStorageService();
const MAX_BYTES = 5 * 1024 * 1024;
export const characterRouter = Router();
characterRouter.use("/character", requireMember, requireActive);
const serialize = (c: typeof characters.$inferSelect) => ({
  id: c.id, name: c.name,
  photoUrl: `/api/character/photo?v=${encodeURIComponent(c.updatedAt.toISOString())}`,
  updatedAt: c.updatedAt.toISOString(), consentAt: c.consentAt.toISOString(),
});

function privateFile(objectPath: string) {
  if (!objectPath.startsWith("/objects/")) throw new Error("Invalid private object path");
  const full = `${storage.getPrivateObjectDir()}/${objectPath.slice("/objects/".length)}`;
  const [bucket, ...parts] = full.replace(/^\/+/, "").split("/");
  return objectStorageClient.bucket(bucket!).file(parts.join("/"));
}

async function readBounded(file: ReturnType<typeof privateFile>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = file.createReadStream();
    stream.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BYTES) stream.destroy(new Error("Foto melebihi batas 5 MB."));
      else chunks.push(chunk);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

characterRouter.get("/character", async (req, res) => {
  const [character] = await db.select().from(characters).where(eq(characters.userId, req.member!.id));
  res.json(GetCharacterResponse.parse({ character: character ? serialize(character) : null }));
});
characterRouter.get("/character/photo", async (req, res, next) => {
  const [character] = await db.select().from(characters).where(eq(characters.userId, req.member!.id));
  if (!character) { res.status(404).json({ error: "Karakter belum terdaftar." }); return; }
  res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" });
  privateFile(character.objectPath).createReadStream().on("error", next).pipe(res);
});
characterRouter.post("/character/uploads", requireCharacterEditor, rateLimit({
  windowMs: 60 * 60 * 1000, limit: 8, standardHeaders: "draft-7", legacyHeaders: false,
  keyGenerator: req => req.member!.id,
  message: { error: "Batas delapan unggahan per jam tercapai. Coba lagi nanti." },
}), async (req, res) => {
  const input = RequestCharacterUploadBody.parse(req.body);
  // Bound abandoned staging objects; expired tickets never permit finalization.
  const expired = await db.select().from(characterUploads).where(and(eq(characterUploads.userId, req.member!.id), isNull(characterUploads.consumedAt), lt(characterUploads.expiresAt, new Date()))).limit(30);
  for (const row of expired) {
    await privateFile(row.objectPath).delete({ ignoreNotFound: true });
    await db.delete(characterUploads).where(eq(characterUploads.id, row.id));
  }
  const uploadURL = await storage.getObjectEntityUploadURL();
  const objectPath = storage.normalizeObjectEntityPath(uploadURL.split("?")[0]!);
  if (!objectPath.startsWith("/objects/uploads/")) throw new Error("Invalid staging path");
  const uploadId = randomUUID();
  await db.insert(characterUploads).values({
    id: uploadId, userId: req.member!.id, objectPath,
    expectedSize: input.size, contentType: input.contentType,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  });
  res.json(RequestCharacterUploadResponse.parse({ uploadId, uploadURL }));
});
characterRouter.put("/character", requireCharacterEditor, async (req, res) => {
  const input = SaveCharacterBody.parse(req.body);
  if (!input.name.trim()) { res.status(400).json({ error: "Nama karakter tidak boleh kosong." }); return; }
  if (!input.consent) { res.status(400).json({ error: "Persetujuan penggunaan foto wajib diberikan." }); return; }
  const result = await db.transaction(async tx => {
    // Same per-member lock for replacement/deletion. Only one character survives.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${req.member!.id}, 71014))`);
    const [ticket] = await tx.select().from(characterUploads).where(and(eq(characterUploads.id, input.uploadId), eq(characterUploads.userId, req.member!.id))).for("update");
    if (!ticket || ticket.consumedAt || ticket.expiresAt < new Date()) {
      return { error: "Unggahan tidak valid atau kedaluwarsa. Unggah ulang fotonya.", status: 400 } as const;
    }
    const file = privateFile(ticket.objectPath);
    const [meta] = await file.getMetadata();
    const size = Number(meta.size);
    if (!size || size > MAX_BYTES || size !== ticket.expectedSize || meta.contentType !== ticket.contentType) {
      await file.delete({ ignoreNotFound: true });
      return { error: "Ukuran atau jenis unggahan tidak sesuai. Gunakan JPG, PNG, atau WebP maksimal 5 MB.", status: 400 } as const;
    }
    const buffer = await readBounded(file);
    let normalized: Buffer;
    try {
      const image = sharp(buffer, { limitInputPixels: 36_000_000, animated: false });
      const info = await image.metadata();
      const allowed = ({ "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[ticket.contentType];
      if (info.format !== allowed || !info.width || !info.height || info.width < 128 || info.height < 128 || (info.pages ?? 1) > 1) throw new Error("Invalid image");
      normalized = await image.rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).jpeg({ quality: 90 }).toBuffer();
    } catch {
      await file.delete({ ignoreNotFound: true });
      return { error: "Isi foto tidak valid. Gunakan foto JPG, PNG, atau WebP biasa, minimal 128 × 128 piksel.", status: 400 } as const;
    }
    // Final object is a DIFFERENT key: the old signed PUT can never change a saved character.
    const finalPath = `/objects/characters/${randomUUID()}.jpg`;
    const finalFile = privateFile(finalPath);
    await finalFile.save(normalized, { contentType: "image/jpeg", resumable: false, metadata: { cacheControl: "private, no-store" } });
    await setObjectAclPolicy(finalFile, { owner: req.member!.id, visibility: "private" });
    const [old] = await tx.select().from(characters).where(eq(characters.userId, req.member!.id));
    const now = new Date();
    const [saved] = await tx.insert(characters).values({
      id: old?.id ?? randomUUID(), userId: req.member!.id, name: input.name.trim(),
      objectPath: finalPath, consentAt: now, updatedAt: now,
    }).onConflictDoUpdate({ target: characters.userId, set: {
      name: input.name.trim(), objectPath: finalPath, consentAt: now, updatedAt: now,
    } }).returning();
    await tx.update(characterUploads).set({ consumedAt: now }).where(eq(characterUploads.id, ticket.id));
    await tx.insert(auditLog).values({
      id: randomUUID(), userId: req.member!.id,
      action: old ? "CHARACTER_REPLACED" : "CHARACTER_SAVED",
      description: old ? "Foto karakter diganti dengan persetujuan baru." : "Karakter pribadi disimpan dengan persetujuan penggunaan foto.",
    });
    await file.delete({ ignoreNotFound: true });
    if (old) await privateFile(old.objectPath).delete({ ignoreNotFound: true });
    return { character: saved! } as const;
  });
  if ("error" in result) { res.status(result.status ?? 400).json({ error: result.error }); return; }
  res.json(SaveCharacterResponse.parse(serialize(result.character)));
});
characterRouter.delete("/character", requireCharacterEditor, async (req, res) => {
  await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${req.member!.id}, 71014))`);
    const [character] = await tx.select().from(characters).where(eq(characters.userId, req.member!.id));
    if (!character) return;
    await privateFile(character.objectPath).delete({ ignoreNotFound: true });
    await tx.delete(characters).where(eq(characters.id, character.id));
    await tx.insert(auditLog).values({ id: randomUUID(), userId: req.member!.id, action: "CHARACTER_DELETED", description: "Karakter dan foto aktif dihapus dari penyimpanan privat." });
  });
  res.json({ ok: true });
});
