import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import sharp from "sharp";
import { db, pool, members, characters, studioFolders, characterUploads, characterVoiceProfiles, characterVoiceSamples, auditLog } from "@workspace/db";
import { ObjectStorageService, objectStorageClient } from "../src/lib/objectStorage";

// No password, session token or real-owner identity is written to the manifest.
const root = fileURLToPath(new URL("../../../generated-artifacts/voice/", import.meta.url));
const manifestPath = `${root}browser-fixture.json`;
type Fixture = { owners: string[]; folders: string[]; characterIds: string[]; photoPaths: string[] };
const storage = new ObjectStorageService();
function file(path: string) {
  assert(/^\/objects\/(characters|uploads|character-voices)\/[a-zA-Z0-9.-]+$/.test(path));
  const [bucket, ...parts] = `${storage.getPrivateObjectDir()}/${path.slice("/objects/".length)}`.replace(/^\/+/, "").split("/");
  return objectStorageClient.bucket(bucket!).file(parts.join("/"));
}
assert.notEqual(process.env.NODE_ENV, "production");
try {
  if (process.argv.includes("--cleanup")) {
    const fixture: Fixture = JSON.parse(await readFile(manifestPath, "utf8"));
    assert(fixture.owners.every(id => /^voice-browser-[a-f0-9-]+$/.test(id)));
    let privateFixture: { clerkUserId: string; email: string; characterId: string; photoPath: string } | null = null;
    try { privateFixture = JSON.parse(await readFile(`${root}browser-clerk-fixture.json`, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (privateFixture) {
      const f = privateFixture;
      assert(/^voice-synthetic-[a-z0-9]+@example\.com$/.test(f.email));
      assert(fixture.photoPaths.includes(f.photoPath));
      const [member] = await db.select().from(members).where(eq(members.id, f.clerkUserId));
      if (member) {
        assert.equal(member.email.toLowerCase(), f.email.toLowerCase(), "Only the recorded synthetic application membership may be removed.");
        const owned = await db.select().from(characters).where(eq(characters.userId, f.clerkUserId));
        assert(owned.length === 1 && owned[0]!.id === f.characterId && owned[0]!.objectPath === f.photoPath);
        const samples = await db.select().from(characterVoiceSamples).where(eq(characterVoiceSamples.ownerId, f.clerkUserId));
        for (const row of samples) {
          if (row.stagingPath) await file(row.stagingPath).delete({ ignoreNotFound: true });
          if (row.finalPath) await file(row.finalPath).delete({ ignoreNotFound: true });
        }
        await db.delete(characterVoiceSamples).where(eq(characterVoiceSamples.ownerId, f.clerkUserId));
        await db.delete(characterVoiceProfiles).where(eq(characterVoiceProfiles.ownerId, f.clerkUserId));
        await db.delete(characters).where(eq(characters.id, f.characterId));
        await db.delete(auditLog).where(eq(auditLog.userId, f.clerkUserId));
        await db.delete(members).where(eq(members.id, f.clerkUserId));
        assert.equal((await db.select().from(members).where(eq(members.id, f.clerkUserId))).length, 0);
      }
      // Login claims may differ from the actual Clerk profile. Never delete
      // that identity unless the provider itself confirms the synthetic data.
      const actual = await clerkClient.users.getUser(f.clerkUserId);
      const exactIdentity = actual.firstName === "VoiceSynthetic" && actual.lastName === "Test"
        && actual.emailAddresses.some(e => e.emailAddress.toLowerCase() === f.email.toLowerCase());
      if (exactIdentity) { await clerkClient.users.deleteUser(f.clerkUserId); process.stdout.write("Verified disposable Clerk identity removed.\n"); }
      else process.stdout.write("Clerk profile did not match synthetic claims; identity preserved. Exact synthetic app rows removed.\n");
    }
    const rows = await db.select().from(characterVoiceSamples).where(inArray(characterVoiceSamples.ownerId, fixture.owners));
    for (const r of rows) {
      if (r.stagingPath) await file(r.stagingPath).delete({ ignoreNotFound: true });
      if (r.finalPath) await file(r.finalPath).delete({ ignoreNotFound: true });
    }
    const photos = await db.select().from(characters).where(inArray(characters.userId, fixture.owners));
    const uploads = await db.select().from(characterUploads).where(inArray(characterUploads.userId, fixture.owners));
    for (const path of new Set([...fixture.photoPaths, ...photos.map(r => r.objectPath), ...uploads.map(r => r.objectPath)])) await file(path).delete({ ignoreNotFound: true });
    await db.delete(characterVoiceSamples).where(inArray(characterVoiceSamples.ownerId, fixture.owners));
    await db.delete(characterVoiceProfiles).where(inArray(characterVoiceProfiles.ownerId, fixture.owners));
    await db.delete(characterUploads).where(inArray(characterUploads.userId, fixture.owners));
    await db.delete(characters).where(inArray(characters.userId, fixture.owners));
    await db.delete(studioFolders).where(inArray(studioFolders.id, fixture.folders));
    await db.delete(auditLog).where(inArray(auditLog.userId, fixture.owners));
    await db.delete(members).where(inArray(members.id, fixture.owners));
    process.stdout.write("Exact synthetic browser fixture cleaned.\n");
  } else {
    const fixture: Fixture = { owners: [0, 1].map(() => `voice-browser-${randomUUID()}`), folders: [randomUUID(), randomUUID()],
      characterIds: [randomUUID(), randomUUID()], photoPaths: [0, 1].map(() => `/objects/characters/${randomUUID()}.jpg`) };
    await mkdir(root, { recursive: true });
    await writeFile(manifestPath, JSON.stringify(fixture, null, 2));
    const photo = await sharp({ create: { width: 240, height: 280, channels: 3, background: "#604070" } }).jpeg().toBuffer();
    for (const i of [0, 1]) {
      await db.insert(members).values({ id: fixture.owners[i]!, email: `${randomUUID()}@example.invalid`,
        name: `SYNTHETIC VOICE BROWSER ${i}`, role: "CREATOR", status: "ACTIVE" });
      await db.insert(studioFolders).values({ id: fixture.folders[i]!, memberId: fixture.owners[i]!,
        name: `SYNTHETIC VOICE BROWSER ${i}`, sharedBy: fixture.owners[i]! });
      await file(fixture.photoPaths[i]!).save(photo, { resumable: false, contentType: "image/jpeg" });
      await db.insert(characters).values({ id: fixture.characterIds[i]!, userId: fixture.owners[i]!,
        name: `SYNTHETIC VOICE BROWSER ${i}`, objectPath: fixture.photoPaths[i]!, consentAt: new Date() });
    }
    process.stdout.write("Synthetic browser fixture created. See generated-artifacts/voice/browser-fixture.json.\n");
  }
} finally { await pool.end(); }
