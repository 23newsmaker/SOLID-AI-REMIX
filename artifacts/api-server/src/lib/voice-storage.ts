import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import { db, characterVoiceSamples, characterVoiceProfiles } from "@workspace/db";
import { ObjectStorageService, objectStorageClient } from "./objectStorage";
import { CreativeError } from "./creative-policy";
import { VOICE_MAX_BYTES } from "./voice-audio";
import { DemandRunner } from "./demand-runner";
import { logger } from "./logger";
import { readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const voiceStorage = new ObjectStorageService();
export function voiceFile(path: string) {
  if (!/^\/objects\/(?:uploads\/[a-zA-Z0-9-]+|character-voices\/[a-zA-Z0-9-]+\.wav)$/.test(path)) throw new Error("Invalid voice path");
  const full = `${voiceStorage.getPrivateObjectDir()}/${path.slice("/objects/".length)}`;
  const [bucket, ...parts] = full.replace(/^\/+/, "").split("/");
  return objectStorageClient.bucket(bucket!).file(parts.join("/"));
}
export async function readVoiceStaging(path: string, expectedSize: number, mime: string) {
  const file = voiceFile(path);
  const [meta] = await file.getMetadata();
  if (Number(meta.size) !== expectedSize || Number(meta.size) > VOICE_MAX_BYTES || meta.contentType !== mime) {
    throw new CreativeError(400, "Ukuran atau jenis unggahan berbeda. Unggah ulang sampelnya.");
  }
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of file.createReadStream()) {
    size += part.length;
    if (size > expectedSize || size > VOICE_MAX_BYTES) throw new CreativeError(400, "Isi audio melebihi batas unggahan.");
    parts.push(Buffer.from(part));
  }
  if (size !== expectedSize) throw new CreativeError(400, "Unggahan audio belum lengkap.");
  return Buffer.concat(parts);
}
export const voiceLock = (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ownerId: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 71014))`);

export async function cleanupVoiceObjects(remove: (path: string) => Promise<unknown> = path => voiceFile(path).delete({ ignoreNotFound: true })) {
  // Every final key is allocated in a committed staging row BEFORE writing bytes.
  // Thus a failed transaction/process exit still has a retryable cleanup record.
  const rows = await db.select().from(characterVoiceSamples).where(or(
    and(eq(characterVoiceSamples.state, "RETIRED"), isNotNull(characterVoiceSamples.finalPath)),
    lt(characterVoiceSamples.expiresAt, new Date(Date.now() - 60_000)),
  )).limit(100);
  let failed = false;
  for (const row of rows) {
    try {
      await db.transaction(async tx => {
        await voiceLock(tx, row.ownerId);
        const [sample] = await tx.select().from(characterVoiceSamples).where(eq(characterVoiceSamples.id, row.id)).for("update");
        if (!sample) return;
        const [active] = await tx.select().from(characterVoiceProfiles).where(eq(characterVoiceProfiles.activeSampleId, sample.id));
        if (!active && sample.finalPath && (sample.state === "RETIRED" || sample.expiresAt.getTime() < Date.now() - 60_000)) {
          await remove(sample.finalPath);
          await tx.update(characterVoiceSamples).set({ finalPath: null }).where(eq(characterVoiceSamples.id, sample.id));
        }
        // Signed PUT is valid 15 minutes: keep tombstones through expiry + grace.
        if (sample.expiresAt.getTime() >= Date.now() - 60_000) return;
        if (sample.stagingPath) await remove(sample.stagingPath);
        if (active) {
          await tx.update(characterVoiceSamples).set({ stagingPath: "", expiresAt: new Date("9999-01-01T00:00:00Z") })
            .where(eq(characterVoiceSamples.id, sample.id));
        } else await tx.delete(characterVoiceSamples).where(eq(characterVoiceSamples.id, sample.id));
      });
    } catch { failed = true; }
  }
  // Crash-only local temporaries; never touch video/other namespaces.
  for (const name of await readdir(tmpdir())) {
    if (!/^solid-voice-[a-zA-Z0-9]+$/.test(name)) continue;
    const path = join(tmpdir(), name);
    if ((await stat(path)).mtimeMs < Date.now() - 60 * 60_000) await rm(path, { recursive: true, force: true });
  }
  return failed ? "contended" as const : "idle" as const;
}
const cleaner = new DemandRunner(cleanupVoiceObjects, () => logger.warn("Voice cleanup deferred; private content not logged"), 15 * 60_000, 60 * 60_000);
export function startVoiceCleanup() { cleaner.start(); }
export function notifyVoiceCleanup() { cleaner.wake(); }
export function stopVoiceCleanup() { cleaner.stop(); }

export async function retireCharacterVoice(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], characterId: string) {
  await tx.update(characterVoiceProfiles).set({ activeSampleId: null, providerStatus: "DISABLED", providerProfileId: null, providerVoiceVersion: null, provider: null })
    .where(eq(characterVoiceProfiles.characterId, characterId));
  await tx.update(characterVoiceSamples).set({ state: "RETIRED",
    expiresAt: sql`least(${characterVoiceSamples.expiresAt}, now() + interval '16 minutes')` })
    .where(and(eq(characterVoiceSamples.characterId, characterId), eq(characterVoiceSamples.state, "ACTIVE")));
}
