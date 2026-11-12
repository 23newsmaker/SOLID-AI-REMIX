import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { db, pool, members, characters, characterUploads, characterVoiceSamples as samples, characterVoiceProfiles as profiles,
  studioFolders, auditLog, videoJobs } from "@workspace/db";
import { normalizeVoiceAudio, VOICE_MAX_BYTES } from "../src/lib/voice-audio";
import { voiceFile, cleanupVoiceObjects } from "../src/lib/voice-storage";
import { voiceJobBinding, requestVoiceUpload, saveVoice, deleteVoice } from "../src/lib/character-voice";
import { newStudioToken, STUDIO_COOKIE } from "../src/lib/studio-access";
import { ObjectStorageService, objectStorageClient } from "../src/lib/objectStorage";

const results: string[] = [];
const check = (text: string) => { results.push(text); process.stdout.write(`PASS ${text}\n`); };
export function syntheticAudio(format = "wav", seconds = 6, silent = false) {
  const bytes = execFileSync("ffmpeg", ["-v", "error", "-threads", "1", "-f", "lavfi", "-i",
    silent ? "anullsrc=r=16000:cl=mono" : "sine=frequency=440:sample_rate=16000", "-t", String(seconds),
    ...(format === "mp4" ? ["-c:a", "aac", "-movflags", "frag_keyframe+empty_moov"] : []),
    "-f", format, "pipe:1"], { maxBuffer: 12 * 1024 * 1024 });
  if (format === "wav") {
    // FFmpeg cannot seek stdout to finalize RIFF lengths; finalize our fixture.
    bytes.writeUInt32LE(bytes.length - 8, 4);
    const data = bytes.indexOf("data");
    assert(data >= 0);
    bytes.writeUInt32LE(bytes.length - data - 8, data + 4);
  }
  return bytes;
}
const ids = [randomUUID(), randomUUID()].map(id => `voice-fixture-${id}`);
const folders = [randomUUID(), randomUUID()];
const charIds = [randomUUID(), randomUUID()];
const storage = new ObjectStorageService();
const savedPaths = new Set<string>();
function photoFile(path: string) {
  const full = `${storage.getPrivateObjectDir()}/${path.slice("/objects/".length)}`.replace(/^\/+/, "");
  const [bucket, ...parts] = full.split("/");
  return objectStorageClient.bucket(bucket!).file(parts.join("/"));
}
async function main() {
  assert.notEqual(process.env.NODE_ENV, "production");
  const wav = syntheticAudio();
  for (const [format, mime] of [["wav", "audio/wav"], ["webm", "audio/webm"], ["ogg", "audio/ogg"],
    ["mp4", "audio/mp4"], ["mp3", "audio/mpeg"], ["adts", "audio/aac"]] as const) {
    const normalized = await normalizeVoiceAudio(syntheticAudio(format), mime);
    assert(normalized.durationMs >= 5000 && normalized.durationMs <= 7000);
    assert.equal(normalized.bytes.toString("ascii", 0, 4), "RIFF");
  }
  check("Local full decode normalizes WAV/WebM/OGG/mobile MP4/MP3/AAC without external services");
  const video = execFileSync("ffmpeg", ["-v", "error", "-threads", "1", "-f", "lavfi", "-i", "color=size=16x16:rate=1",
    "-f", "lavfi", "-i", "sine=frequency=440", "-t", "6", "-c:v", "libvpx", "-c:a", "libopus", "-f", "webm", "pipe:1"]);
  for (const [bytes, mime] of [[Buffer.from("not audio"), "audio/wav"], [wav, "audio/mpeg"], [video, "audio/webm"],
    [syntheticAudio("wav", 2), "audio/wav"], [syntheticAudio("wav", 61), "audio/wav"], [syntheticAudio("wav", 6, true), "audio/wav"],
    [Buffer.alloc(VOICE_MAX_BYTES + 1), "audio/wav"]] as const) await assert.rejects(normalizeVoiceAudio(bytes, mime));
  check("Rejects forged MIME, corrupt bytes, video, too short/long, silence and oversized input");
  for (const seconds of [5, 60]) assert.equal((await normalizeVoiceAudio(syntheticAudio("wav", seconds), "audio/wav")).durationMs, seconds * 1000);
  check("Exact five/sixty-second duration boundaries pass after PCM decode");

  await db.insert(members).values(ids.map(id => ({ id, email: `${randomUUID()}@example.invalid`,
    name: "SYNTHETIC VOICE ONLY", role: "CREATOR", status: "ACTIVE" })));
  await db.insert(studioFolders).values(folders.map((id, i) => ({ id, memberId: ids[i]!, name: `SYNTHETIC VOICE ${i}`, sharedBy: ids[i]! })));
  const cookie = `${STUDIO_COOKIE}=${newStudioToken()}`;
  async function call(path: string, method = "GET", body?: unknown, folder: string | null = folders[0]!, status = 200, authenticated = true) {
    const res = await fetch(`http://localhost:80/api${path}`, { method,
      headers: { "Content-Type": "application/json", ...(authenticated ? { Cookie: cookie } : {}), ...(folder ? { "X-Solid-Folder": folder } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal(res.status, status, `${method} ${path}: expected ${status}, got ${res.status}`);
    return res;
  }
  const photo = await sharp({ create: { width: 200, height: 240, channels: 3, background: "#345678" } }).jpeg().toBuffer();
  async function put(url: string, bytes: Buffer, mime: string) {
    assert((await fetch(url, { method: "PUT", body: new Uint8Array(bytes), headers: { "Content-Type": mime } })).ok);
  }
  // Real photo APIs, but exclusively in our two recorded synthetic folders.
  async function savePhoto(folder: string) {
    const ticket = await (await call("/character/uploads", "POST", { name: "synthetic.jpg", size: photo.length, contentType: "image/jpeg" }, folder)).json();
    await put(ticket.uploadURL, photo, "image/jpeg");
    const char = await (await call("/character", "PUT", { name: "SYNTHETIC VOICE ONLY", uploadId: ticket.uploadId, consent: true }, folder)).json();
    const [row] = await db.select().from(characters).where(eq(characters.id, char.id));
    savedPaths.add(row!.objectPath);
    return char;
  }
  const char = await savePhoto(folders[0]!);
  const other = await savePhoto(folders[1]!);
  charIds[0] = char.id; charIds[1] = other.id;
  const input = (version: number) => ({ characterId: char.id, expectedVersion: version });
  assert.equal((await (await call("/character/voice")).json()).status, "NO_SAMPLE");
  await call("/character/voice", "GET", undefined, folders[0]!, 401, false);
  await call("/character/voice/sample", "GET", undefined, folders[0]!, 401, false);
  await call("/character/voice", "GET", undefined, randomUUID(), 401);
  const config = await (await call("/video/config")).json();
  assert.equal(config.aiEnabled, false);
  assert.equal(config.dailyUsed, 0);
  await db.transaction(async tx => assert.deepEqual((await voiceJobBinding(tx, ids[0]!, char.id)).sampleId, null));
  check("Legacy character/no sample remains usable; anonymous and unknown folder denied");
  await db.update(members).set({ status: "SUSPENDED" }).where(eq(members.id, ids[0]!));
  await call("/character/voice", "GET", undefined, folders[0]!, 401);
  await db.update(members).set({ status: "ACTIVE" }).where(eq(members.id, ids[0]!));

  async function ticket(version: number, bytes = wav, mime = "audio/wav") {
    const t = await (await call("/character/voice/uploads", "POST", { ...input(version), size: bytes.length, contentType: mime })).json();
    await put(t.uploadURL, bytes, mime);
    return t;
  }
  const t = await ticket(0);
  const saveInput = { ...input(0), uploadId: t.uploadId, consent: true };
  await call("/character/voice", "PUT", { ...saveInput, consent: false }, folders[0]!, 400);
  await call("/character/voice", "PUT", saveInput, folders[1]!, 404);
  await call("/character/voice", "PUT", { ...saveInput, characterId: other.id }, folders[1]!, 400);
  const voice = await (await call("/character/voice", "PUT", saveInput)).json();
  assert.equal(voice.version, 1); assert.equal(voice.providerEnabled, false);
  assert(voice.sampleUrl.includes(`folder=${folders[0]}`));
  assert.equal((await (await call("/character/voice", "PUT", saveInput)).json()).version, 1);
  const [sample] = await db.select().from(samples).where(eq(samples.id, t.uploadId));
  assert(sample!.consentAt); assert.equal(sample!.consentBasis, "VOICE_RIGHTS_UPLOADER_CONFIRMATION");
  const [meta] = await voiceFile(sample!.finalPath!).getMetadata();
  assert.deepEqual(JSON.parse(String(meta.metadata?.["custom:aclPolicy"])), { owner: ids[0], visibility: "private" });
  const [creator] = await db.select().from(members).where(eq(members.id, ids[0]!));
  const viewer = { ...creator!, role: "VIEWER" as const };
  for (const denied of [
    () => requestVoiceUpload({ ...input(1), size: 42, contentType: "audio/wav" }, viewer),
    () => saveVoice(saveInput, viewer),
    () => deleteVoice(input(1), viewer),
    () => deleteVoice(input(1), { ...creator!, status: "SUSPENDED" as const }),
  ]) await assert.rejects(denied, (e: unknown) => (e as { status?: number }).status === 403);
  const served = await call(`/character/voice/sample?v=1`);
  assert.equal(served.headers.get("cache-control"), "private, no-store");
  assert.equal(Buffer.from(await served.arrayBuffer()).toString("ascii", 0, 4), "RIFF");
  await call("/character/voice/sample?v=1", "GET", undefined, folders[1]!, 404);
  await call("/character/voice/sample?v=0", "GET", undefined, folders[0]!, 404);
  check("Voice consent independent of photo, private folder-bound serving and idempotent finalization");
  await savePhoto(folders[0]!);
  assert.equal((await (await call("/character/voice")).json()).version, 1);
  check("Replacing a character photo preserves its exact saved voice profile");

  const bad = await ticket(1, Buffer.from("bogus"));
  await call("/character/voice", "PUT", { ...input(1), uploadId: bad.uploadId, consent: true }, folders[0]!, 400);
  await db.update(samples).set({ expiresAt: new Date(Date.now() - 120_000) }).where(eq(samples.id, bad.uploadId));
  await call("/character/voice", "PUT", { ...input(1), uploadId: bad.uploadId, consent: true }, folders[0]!, 400);
  // Cleanup only our expired ticket here; don't sweep owner data as part of assertions.
  await voiceFile((await db.select().from(samples).where(eq(samples.id, bad.uploadId)))[0]!.stagingPath).delete({ ignoreNotFound: true });
  await db.delete(samples).where(eq(samples.id, bad.uploadId));
  const mismatch = await ticket(1);
  await db.update(samples).set({ expectedSize: wav.length + 1 }).where(eq(samples.id, mismatch.uploadId));
  await call("/character/voice", "PUT", { ...input(1), uploadId: mismatch.uploadId, consent: true }, folders[0]!, 400);
  await voiceFile((await db.select().from(samples).where(eq(samples.id, mismatch.uploadId)))[0]!.stagingPath).delete({ ignoreNotFound: true });
  await db.delete(samples).where(eq(samples.id, mismatch.uploadId));
  check("Server rejects corrupt/expired/size-mismatched tickets and retains prior active sample");

  const replacement = await ticket(1, syntheticAudio("mp4"), "audio/mp4");
  const next = await (await call("/character/voice", "PUT", { ...input(1), uploadId: replacement.uploadId, consent: true })).json();
  assert.equal(next.version, 2);
  await call("/character/voice", "DELETE", input(1), folders[0]!, 409);
  const binding = await db.transaction(tx => voiceJobBinding(tx, ids[0]!, char.id));
  assert.equal(binding.sampleId, replacement.uploadId); assert.equal(binding.sampleVersion, 2); assert.equal(binding.synthesisEnabled, false);
  assert.equal("finalPath" in binding, false);
  // Keep an old synthetic job to prove voice deletion doesn't erase it or quota history.
  const jobId = randomUUID();
  await db.insert(videoJobs).values({ id: jobId, ownerId: ids[0]!, conceptVersion: 1, characterId: char.id, requestKey: jobId,
    requestHash: "synthetic", title: "SYNTHETIC VOICE HISTORY", voiceBinding: binding, options: {}, status: "CANCELLED",
    durationSeconds: 10, quotaDay: "1900-01-01", simulation: true });
  const deleted = await (await call("/character/voice", "DELETE", input(2))).json();
  assert.equal(deleted.status, "NO_SAMPLE"); assert.equal(deleted.version, 3);
  assert.equal(binding.sampleVersion, 2);
  await call("/character/voice/sample?v=2", "GET", undefined, folders[0]!, 404);
  assert.equal((await db.select().from(videoJobs).where(eq(videoJobs.id, jobId))).length, 1);
  assert.equal((await db.select().from(characters).where(eq(characters.id, char.id))).length, 1);
  assert.equal((await (await call("/video/config")).json()).dailyUsed, 0);
  check("Replacement/deletion enforce versions, revoke sample access, preserve photo/jobs/quota and snapshot");
  // Test cleanup retries without affecting any real files: fault only synthetic file handles.
  // New isolated cleanup fixture, not a route-retired file the background runner
  // may already have removed. No route wake occurs during this fault injection.
  const retryId = randomUUID(), retryPath = `/objects/character-voices/${retryId}.wav`;
  await voiceFile(retryPath).save(wav, { resumable: false, contentType: "audio/wav" });
  await db.insert(samples).values({ id: retryId, ownerId: ids[0]!, characterId: char.id, expectedVersion: 0,
    stagingPath: "", finalPath: retryPath, expectedSize: wav.length, contentType: "audio/wav", state: "RETIRED",
    expiresAt: new Date(Date.now() + 16 * 60_000) });
  assert.equal(await cleanupVoiceObjects(path => {
    if (path === retryPath) throw new Error("synthetic storage outage");
    return voiceFile(path).delete({ ignoreNotFound: true });
  }), "contended");
  assert((await db.select().from(samples).where(eq(samples.id, retryId)))[0]!.finalPath, "Failed deletion remains retryable");
  assert.equal(await cleanupVoiceObjects(), "idle");
  assert.equal((await voiceFile(retryPath).exists())[0], false);
  const [tombstone] = await db.select().from(samples).where(eq(samples.id, retryId));
  assert(tombstone && tombstone.finalPath === null, "Staging tombstone retained through signed PUT expiry");
  await db.update(samples).set({ expiresAt: new Date(Date.now() - 120_000) }).where(and(eq(samples.ownerId, ids[0]!), eq(samples.state, "RETIRED")));
  await cleanupVoiceObjects();
  check("Storage outage leaves durable retry; retry removes retired files and expires staging tombstones");
  // Save again then delete whole synthetic character; active voice must be retired, not orphaned.
  const final = await ticket(3);
  await call("/character/voice", "PUT", { ...input(3), uploadId: final.uploadId, consent: true });
  await call("/character", "DELETE");
  await call("/character/voice/sample", "GET", undefined, folders[0]!, 404);
  assert.equal((await db.select().from(profiles).where(eq(profiles.characterId, char.id))).length, 0);
  assert.equal((await db.select().from(samples).where(eq(samples.id, final.uploadId)))[0]!.state, "RETIRED");
  check("Whole-character deletion queues its voice cleanup without deleting old video history");
}
try { await main(); }
catch (error) { process.stderr.write(`${error instanceof Error ? error.stack : "Validation failed"}\n`); process.exitCode = 1; }
finally {
  // Exact recorded synthetic IDs only; never infer real-owner data from role/name.
  const rows = await db.select().from(samples).where(inArray(samples.ownerId, ids));
  for (const row of rows) {
    if (row.stagingPath) await voiceFile(row.stagingPath).delete({ ignoreNotFound: true });
    if (row.finalPath) await voiceFile(row.finalPath).delete({ ignoreNotFound: true });
  }
  for (const path of savedPaths) await photoFile(path).delete({ ignoreNotFound: true });
  const uploads = await db.select().from(characterUploads).where(inArray(characterUploads.userId, ids));
  for (const row of uploads) await photoFile(row.objectPath).delete({ ignoreNotFound: true });
  await db.delete(samples).where(inArray(samples.ownerId, ids));
  await db.delete(profiles).where(inArray(profiles.ownerId, ids));
  await db.delete(videoJobs).where(inArray(videoJobs.ownerId, ids));
  await db.delete(characters).where(inArray(characters.userId, ids));
  await db.delete(characterUploads).where(inArray(characterUploads.userId, ids));
  await db.delete(studioFolders).where(inArray(studioFolders.memberId, ids));
  await db.delete(auditLog).where(inArray(auditLog.userId, ids));
  await db.delete(members).where(inArray(members.id, ids));
  const out = fileURLToPath(new URL("../../../generated-artifacts/voice/", import.meta.url));
  await mkdir(out, { recursive: true });
  await writeFile(`${out}validation.json`, JSON.stringify({ passed: !process.exitCode, checks: results, syntheticIds: ids, cleaned: true }, null, 2));
  await pool.end();
}
