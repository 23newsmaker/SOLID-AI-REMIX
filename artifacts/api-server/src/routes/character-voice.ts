import { Router } from "express";
import { and, eq } from "drizzle-orm";
import { db, characters, characterVoiceProfiles, characterVoiceSamples } from "@workspace/db";
import { RequestVoiceSampleUploadBody, RequestVoiceSampleUploadResponse, SaveCharacterVoiceBody, DeleteCharacterVoiceBody } from "@workspace/api-zod";
import { requireCharacterEditor } from "../middlewares/member";
import { rateLimit } from "express-rate-limit";
import { getCharacterVoice, requestVoiceUpload, saveVoice, deleteVoice } from "../lib/character-voice";
import { voiceFile, voiceLock } from "../lib/voice-storage";
import { CreativeError } from "../lib/creative-policy";

// Mounted under characterRouter AFTER the existing studio/member/active guards.
export const characterVoiceRouter = Router();
characterVoiceRouter.get("/voice", async (req, res) => { res.json(await getCharacterVoice(req.member!.id)); });
characterVoiceRouter.post("/voice/uploads", requireCharacterEditor, rateLimit({
  windowMs: 60 * 60_000, limit: 12, standardHeaders: "draft-7", legacyHeaders: false,
  keyGenerator: req => req.member!.id, message: { error: "Batas 12 unggahan suara/jam tercapai. Coba lagi nanti." },
}), async (req, res) => {
  res.json(RequestVoiceSampleUploadResponse.parse(await requestVoiceUpload(RequestVoiceSampleUploadBody.parse(req.body), req.member!)));
});
characterVoiceRouter.put("/voice", requireCharacterEditor, async (req, res) => {
  res.json(await saveVoice(SaveCharacterVoiceBody.parse(req.body), req.member!, req.studioFolderId));
});
characterVoiceRouter.delete("/voice", requireCharacterEditor, async (req, res) => {
  res.json(await deleteVoice(DeleteCharacterVoiceBody.parse(req.body), req.member!));
});
characterVoiceRouter.get("/voice/sample", async (req, res) => {
  // Buffer the bounded normalized WAV while holding the same lock as revocation.
  // Never serve a path, sample ID or owner supplied by the caller.
  const bytes = await db.transaction(async tx => {
    await voiceLock(tx, req.member!.id);
    const [row] = await tx.select({ sample: characterVoiceSamples, profile: characterVoiceProfiles }).from(characters)
      .innerJoin(characterVoiceProfiles, eq(characterVoiceProfiles.characterId, characters.id))
      .innerJoin(characterVoiceSamples, and(eq(characterVoiceSamples.id, characterVoiceProfiles.activeSampleId),
        eq(characterVoiceSamples.ownerId, characters.userId), eq(characterVoiceSamples.characterId, characters.id)))
      .where(and(eq(characters.userId, req.member!.id), eq(characterVoiceSamples.state, "ACTIVE")));
    if (!row?.sample.finalPath || (req.query.v !== undefined && String(req.query.v) !== String(row.profile.version))) {
      throw new CreativeError(404, "Sampel aktif tidak tersedia.");
    }
    const [meta] = await voiceFile(row.sample.finalPath).getMetadata();
    if (Number(meta.size) > 60 * 32000 + 44) throw new CreativeError(400, "Ukuran sampel tidak valid.");
    const [data] = await voiceFile(row.sample.finalPath).download();
    return data;
  });
  res.set({ "Content-Type": "audio/wav", "Content-Length": String(bytes.length), "Cache-Control": "private, no-store",
    "Cross-Origin-Resource-Policy": "same-origin", "X-Content-Type-Options": "nosniff" });
  res.end(bytes);
});
