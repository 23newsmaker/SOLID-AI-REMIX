import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db, characters, characterVoiceProfiles as profiles, characterVoiceSamples as samples, auditLog, type MemberRecord } from "@workspace/db";
import { type VoiceSampleInput, type VoiceUploadInput, type VoiceVersionInput, GetCharacterVoiceResponse } from "@workspace/api-zod";
import { CreativeError } from "./creative-policy";
import { normalizeVoiceAudio } from "./voice-audio";
import { voiceStorage, voiceFile, voiceLock, readVoiceStaging, notifyVoiceCleanup, retireCharacterVoice } from "./voice-storage";
import { setObjectAclPolicy } from "./objectAcl";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function ownedCharacter(tx: Tx | typeof db, ownerId: string, id?: string) {
  const [character] = await tx.select().from(characters).where(eq(characters.userId, ownerId));
  if (!character || (id && character.id !== id)) throw new CreativeError(404, "Karakter tidak tersedia di folder ini.");
  return character;
}
function editable(me: MemberRecord) {
  if (me.status !== "ACTIVE" || me.role === "VIEWER") throw new CreativeError(403, "Hak tulis karakter aktif diperlukan.");
}
async function profileVersion(tx: Tx, characterId: string, expected: number) {
  const [profile] = await tx.select().from(profiles).where(eq(profiles.characterId, characterId));
  if ((profile?.version ?? 0) !== expected) throw new CreativeError(409, "Sampel sudah berubah di sesi lain. Muat ulang sebelum mengganti atau menghapus.");
  return profile;
}
export async function getCharacterVoice(ownerId: string, tx: Tx | typeof db = db) {
  const [character] = await tx.select().from(characters).where(eq(characters.userId, ownerId));
  const [profile] = character ? await tx.select().from(profiles).where(eq(profiles.characterId, character.id)) : [];
  const [sample] = profile?.activeSampleId ? await tx.select().from(samples).where(and(
    eq(samples.id, profile.activeSampleId), eq(samples.ownerId, ownerId), eq(samples.characterId, character!.id), eq(samples.state, "ACTIVE"),
  )) : [];
  return GetCharacterVoiceResponse.parse({
    characterId: character?.id ?? null, version: profile?.version ?? 0,
    status: sample ? "SAMPLE_SAVED_AUTOMATION_DISABLED" : "NO_SAMPLE",
    sampleUrl: sample ? `/api/character/voice/sample?v=${profile!.version}` : null,
    durationSeconds: sample?.durationMs ? sample.durationMs / 1000 : null,
    updatedAt: profile?.updatedAt.toISOString() ?? null, providerEnabled: false,
  });
}
export async function requestVoiceUpload(input: VoiceUploadInput, me: MemberRecord) {
  editable(me);
  return db.transaction(async tx => {
    await voiceLock(tx, me.id);
    await ownedCharacter(tx, me.id, input.characterId);
    await profileVersion(tx, input.characterId, input.expectedVersion);
    const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(samples).where(and(
      eq(samples.ownerId, me.id), eq(samples.state, "STAGING"), sql`${samples.expiresAt} > now()`,
    ));
    if (count!.n >= 3) throw new CreativeError(429, "Tiga unggahan suara masih tertunda. Tunggu tiket kedaluwarsa sebelum mencoba lagi.");
    const uploadURL = await voiceStorage.getObjectEntityUploadURL();
    const stagingPath = voiceStorage.normalizeObjectEntityPath(uploadURL.split("?")[0]!);
    const id = randomUUID();
    await tx.insert(samples).values({
      id, ownerId: me.id, characterId: input.characterId, expectedVersion: input.expectedVersion,
      stagingPath, finalPath: `/objects/character-voices/${id}.wav`, expectedSize: input.size,
      contentType: input.contentType, expiresAt: new Date(Date.now() + 15 * 60_000),
    });
    return { uploadId: id, uploadURL };
  });
}
export async function saveVoice(input: VoiceSampleInput, me: MemberRecord, folderId?: string) {
  editable(me);
  if (input.consent !== true) throw new CreativeError(400, "Konfirmasi hak penggunaan suara diperlukan.");
  const result = await db.transaction(async tx => {
    await voiceLock(tx, me.id);
    await ownedCharacter(tx, me.id, input.characterId);
    const [ticket] = await tx.select().from(samples).where(and(eq(samples.id, input.uploadId),
      eq(samples.ownerId, me.id), eq(samples.characterId, input.characterId))).for("update");
    if (!ticket || ticket.expectedVersion !== input.expectedVersion) throw new CreativeError(400, "Tiket sampel tidak cocok dengan karakter/versi.");
    const [known] = await tx.select().from(profiles).where(eq(profiles.characterId, input.characterId));
    // Retrying an acknowledged/lost response never creates a second sample version.
    if (ticket.state === "ACTIVE" && known?.activeSampleId === ticket.id) return getCharacterVoice(me.id, tx);
    await profileVersion(tx, input.characterId, input.expectedVersion);
    if (ticket.state !== "STAGING" || ticket.expiresAt < new Date() || !ticket.finalPath) throw new CreativeError(400, "Tiket suara kedaluwarsa atau sudah dipakai. Unggah ulang.");
    const normalized = await normalizeVoiceAudio(await readVoiceStaging(ticket.stagingPath, ticket.expectedSize, ticket.contentType), ticket.contentType);
    const final = voiceFile(ticket.finalPath);
    await final.save(normalized.bytes, { resumable: false, contentType: "audio/wav", metadata: { cacheControl: "private, no-store" } });
    await setObjectAclPolicy(final, { owner: me.id, visibility: "private" });
    await retireCharacterVoice(tx, input.characterId);
    const version = input.expectedVersion + 1, now = new Date();
    await tx.update(samples).set({ state: "ACTIVE", version, durationMs: normalized.durationMs, consentAt: now,
      consentBasis: "VOICE_RIGHTS_UPLOADER_CONFIRMATION" }).where(eq(samples.id, ticket.id));
    await tx.insert(profiles).values({ characterId: input.characterId, ownerId: me.id, version, activeSampleId: ticket.id, updatedAt: now })
      .onConflictDoUpdate({ target: profiles.characterId, set: { version, activeSampleId: ticket.id, updatedAt: now,
        provider: null, providerProfileId: null, providerVoiceVersion: null, providerStatus: "DISABLED" } });
    await tx.insert(auditLog).values({ id: randomUUID(), userId: me.id, action: "CHARACTER_VOICE_SAMPLE_SAVED",
      description: "Sampel suara privat disimpan; cloning dan transfer eksternal tidak diaktifkan.",
      after: { characterId: input.characterId, sampleId: ticket.id, version, consentBasis: "VOICE_RIGHTS_UPLOADER_CONFIRMATION",
        externalCloningConsent: false, ...(folderId ? { folderId, identityVerified: false } : {}) } });
    return getCharacterVoice(me.id, tx);
  });
  notifyVoiceCleanup();
  return result;
}
export async function deleteVoice(input: VoiceVersionInput, me: MemberRecord) {
  editable(me);
  const result = await db.transaction(async tx => {
    await voiceLock(tx, me.id);
    await ownedCharacter(tx, me.id, input.characterId);
    const profile = await profileVersion(tx, input.characterId, input.expectedVersion);
    if (!profile?.activeSampleId) return getCharacterVoice(me.id, tx);
    await retireCharacterVoice(tx, input.characterId);
    await tx.update(profiles).set({ version: profile.version + 1, updatedAt: new Date() }).where(eq(profiles.characterId, input.characterId));
    await tx.insert(auditLog).values({ id: randomUUID(), userId: me.id, action: "CHARACTER_VOICE_SAMPLE_DELETED",
      description: "Akses sampel ditutup; pembersihan file diantrekan dengan retry. Foto, video, riwayat dan kuota tetap.",
      after: { characterId: input.characterId, version: profile.version + 1 } });
    return getCharacterVoice(me.id, tx);
  });
  notifyVoiceCleanup();
  return result;
}

/** Snapshot metadata only; NEVER expose object paths or feed a sample to renderer. */
export async function voiceJobBinding(tx: Tx, ownerId: string, characterId: string) {
  const [profile] = await tx.select().from(profiles).where(and(eq(profiles.characterId, characterId), eq(profiles.ownerId, ownerId)));
  return { characterId, sampleId: profile?.activeSampleId ?? null, sampleVersion: profile?.version ?? 0,
    provider: null, providerProfileId: null, providerVoiceVersion: null, synthesisEnabled: false };
}
