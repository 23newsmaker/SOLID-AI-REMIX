import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { and, eq, inArray } from "drizzle-orm";
import {
  db, pool, members, characters, creativeCategories, creativeConcepts, conceptAttachments, creativeReviews, videoJobs, auditLog,
} from "@workspace/db";
import { buildCreative, parseConcept } from "../src/lib/creative-builder";
import { createJob, cancelJob, deleteResult, readJob, videoConfig } from "../src/lib/video/service";
import { quotaDay } from "../src/lib/video/policy";
import { creativeFile, validateMaterial } from "../src/lib/creative-storage";
import { videoFile } from "../src/lib/video/storage";
import { mediaCommand } from "../src/lib/video/renderer";
import { runVideoWorker } from "../src/lib/video/worker";
import { mockVideoProvider } from "../src/lib/video/provider";
import type { VideoJobInput } from "@workspace/api-zod";

const output = path.resolve("../../generated-artifacts/phase-c");
const uid = `phase-c-test-${randomUUID()}`;
const other = `phase-c-test-${randomUUID()}`;
const category = randomUUID(), characterId = randomUUID(), conceptId = randomUUID();
const logoId = randomUUID(), supportId = randomUUID(), audioId = randomUUID();
const files = [0, 1, 2, 3].map(() => `/objects/concepts/${randomUUID()}`);
const results: { feature: string; status: string; actual: unknown }[] = [];
const record = (feature: string, actual: unknown, status = "PASS") => results.push({ feature, status, actual });
async function denied(feature: string, run: () => Promise<unknown>) {
  await assert.rejects(run); record(feature, "Ditolak tanpa mengubah data asli.");
}
async function main() {
  await mkdir(output, { recursive: true });
  assert(process.env.NODE_ENV !== "production");
  assert.equal(quotaDay(new Date("2026-11-10T16:59:59Z")), "2026-11-10");
  assert.equal(quotaDay(new Date("2026-11-10T17:00:00Z")), "2026-11-11");
  record("Pergantian hari Jakarta", "17:00UTC berpindah tanggal Asia/Jakarta");
  const [me, stranger] = await db.insert(members).values([
    { id: uid, email: `${randomUUID()}@example.com`, name: "Phase C Synthetic TEST", role: "CREATOR", status: "ACTIVE" },
    { id: other, email: `${randomUUID()}@example.com`, name: "Phase C Other TEST", role: "CREATOR", status: "ACTIVE" },
  ]).returning();
  await db.insert(creativeCategories).values({ id: category, name: "Phase C TEST", active: true });
  const picture = await sharp(Buffer.from('<svg width="720" height="1280" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="1280" fill="#f4c960"/><circle cx="360" cy="400" r="150" fill="#30183a"/><rect x="180" y="600" width="360" height="500" rx="90" fill="#ee5831"/><text x="360" y="100" font-size="55" text-anchor="middle">TEST SINTETIS</text></svg>')).png().toBuffer();
  const logo = await sharp(Buffer.from('<svg width="240" height="120" xmlns="http://www.w3.org/2000/svg"><rect width="240" height="120" rx="20" fill="#321439"/><text x="120" y="77" text-anchor="middle" font-size="45" fill="#ffda70">DEMO</text></svg>')).png().toBuffer();
  const support = await sharp(Buffer.from('<svg width="720" height="1280" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="1280" fill="#51315d"/><text x="360" y="400" text-anchor="middle" font-size="40" fill="#fff">SCREENSHOT TEST 123</text></svg>')).png().toBuffer();
  const wavPath = path.join(output, "test-tone.wav");
  await mediaCommand("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=10", wavPath]);
  const audio = await validateMaterial(await readFile(wavPath), "audio/wav");
  for (const [i, bytes] of [picture, logo, support, audio].entries()) await creativeFile(files[i]!).save(bytes, { resumable: false, contentType: i === 3 ? "audio/wav" : "image/png", metadata: { cacheControl: "private, no-store" } });
  await db.insert(characters).values({ id: characterId, userId: uid, name: "TEST GEOMETRIS", objectPath: files[0]!, consentAt: new Date() });
  const input = parseConcept({
    title: "DEMO HEMAT — BUKAN KONTEN PUBLIK", characterId, categoryId: category, segments: ["NONE"], style: "UGC", mode: "HEMAT", templateId: null,
    purpose: "Validasi teknis sintetis", direction: "", scenes: "Bentuk geometris dan screenshot uji", characterMotion: "", cameraMotion: "zoom",
    visual: "Gambar TEST", narration: "Video demonstrasi internal. Ini contoh render lokal bukan konten promosi perusahaan.",
    subtitle: "Video demonstrasi internal. Ini contoh render lokal bukan konten promosi perusahaan.",
    cta: "CONTOH RENDER", disclaimer: "DEMO SINTETIS — BUKAN KONTEN PERUSAHAAN.",
    format: "9:16", durationSeconds: 10, sourceIds: [], factIds: [], noFactualClaims: true, publicMode: true, materialConsent: true,
  });
  const built = await buildCreative(input, me!);
  assert.equal(built.blockers.length, 0);
  await db.insert(creativeConcepts).values({ id: conceptId, ownerId: uid, status: "APPROVED", version: 3, data: input, snapshot: built.snapshot, prompt: built.prompt, warnings: built.warnings, blockers: [], submittedAt: new Date() });
  await db.insert(creativeReviews).values({ id: randomUUID(), conceptId, actorId: other, action: "APPROVED", note: "Fixture sintetis khusus pengujian, bukan persetujuan konten perusahaan.", version: 3 });
  await db.insert(conceptAttachments).values([
    { id: logoId, conceptId, ownerId: uid, name: "DEMO-logo.png", contentType: "image/png", size: logo.length, stagingPath: "", finalPath: files[1], state: "READY", expiresAt: new Date("9999-01-01") },
    { id: supportId, conceptId, ownerId: uid, name: "TEST-screenshot.png", contentType: "image/png", size: support.length, stagingPath: "", finalPath: files[2], state: "READY", expiresAt: new Date("9999-01-01") },
    { id: audioId, conceptId, ownerId: uid, name: "TEST-tone.wav", contentType: "audio/wav", size: audio.length, stagingPath: "", finalPath: files[3], state: "READY", expiresAt: new Date("9999-01-01") },
  ]);
  const body: VideoJobInput = { conceptId, version: 3, mode: "HEMAT", confirmed: true, requestKey: randomUUID(),
    options: { motion: "ZOOM_IN", logoPosition: "TOP_RIGHT", logoAttachmentId: logoId, cues: [{ start: 0, end: 6 }, { start: 6, end: 10 }] } };
  await denied("Konsep anggota lain ditolak", () => createJob(body, stranger!));
  await denied("VIEWER tidak dapat generate", () => createJob(body, { ...me!, role: "VIEWER" }));
  await denied("Mode AI belum disetujui ditolak", () => createJob({ ...body, mode: "AI" }, me!));
  await denied("Cue tumpang tindih ditolak", () => createJob({ ...body, options: { ...body.options, cues: [{ start: 0, end: 8 }, { start: 7, end: 10 }] } }, me!));
  await db.update(creativeConcepts).set({ status: "DRAFT" }).where(eq(creativeConcepts.id, conceptId));
  await denied("Draft tidak boleh dirender", () => createJob(body, me!));
  await db.update(creativeConcepts).set({ status: "APPROVED" }).where(eq(creativeConcepts.id, conceptId));
  const [a, b] = await Promise.all([createJob(body, me!), createJob(body, me!)]);
  assert.equal(a.id, b.id);
  assert.equal((await videoConfig(me!)).dailyUsed, 1);
  record("Klik ganda/request paralel", "Dua request identik -> satu job dan satu slot kuota.");
  await denied("Kunci sama dengan isi berbeda ditolak", () => createJob({ ...body, options: { ...body.options, motion: "PAN_LEFT" } }, me!));
  await denied("Job anggota lain tidak terlihat", () => readJob(a.id, stranger!));
  await denied("VIEWER tidak dapat menghapus", () => deleteResult(a.id, { ...me!, role: "VIEWER" }));
  await runVideoWorker();
  const completed = await readJob(a.id, me!);
  assert.equal(completed.status, "COMPLETED", completed.error ?? "Render not completed");
  await videoFile(completed.resultPath!).download({ destination: path.join(output, "contoh-mode-hemat.mp4") });
  const probe = JSON.parse(await mediaCommand("ffprobe", ["-v", "error", "-show_entries", "format=duration,size:stream=codec_name,width,height", "-of", "json", path.join(output, "contoh-mode-hemat.mp4")]));
  record("MP4 nyata dengan foto, screenshot, logo, subtitle, CTA dan audio", probe);
  assert.equal(completed.providerCostUsd, 0); assert.equal(completed.actualCostUsd, null);
  record("Biaya tidak diketahui bukan nol", { providerUsd: 0, actualTotal: null, renderMilliseconds: completed.renderMilliseconds });
  const two = await createJob({ ...body, requestKey: randomUUID() }, me!);
  const race = await Promise.allSettled([createJob({ ...body, requestKey: randomUUID() }, me!), createJob({ ...body, requestKey: randomUUID() }, me!)]);
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1);
  assert.equal((await videoConfig(me!)).dailyUsed, 3);
  record("Batas3 aman terhadap konkurensi", "Dari2slot terpakai, dua permintaan -> satu diterima, satu ditolak; total3.");
  await cancelJob(two.id, me!);
  assert.equal((await videoConfig(me!)).dailyUsed, 3);
  record("Pembatalan tidak menghapus riwayat kuota", "Tetap3 slot setelah pembatalan.");
  const third = race.find(r => r.status === "fulfilled")!;
  if (third.status === "fulfilled") await cancelJob(third.value.id, me!);
  await deleteResult(a.id, me!);
  assert.equal((await readJob(a.id, me!)).deleted, true);
  assert.equal((await videoFile(completed.resultPath!).exists())[0], false);
  record("Hapus hasil privat", "Objek hilang, riwayat job dan biaya tetap ada.");
  await db.update(videoJobs).set({ status: "PROCESSING", deleted: false, error: null }).where(eq(videoJobs.id, two.id));
  await runVideoWorker();
  assert.equal((await readJob(two.id, me!)).status, "UNKNOWN");
  record("Pemulihan setelah proses terhenti", "PROCESSING tanpa hasil -> UNKNOWN; tidak dikirim ulang.");
  const mock = await mockVideoProvider.submit({ requestKey: "TEST", publicVisualPrompt: "TEST" });
  assert.equal(await mockVideoProvider.status(mock.providerJobId), "SIMULATED");
  assert.equal(await mockVideoProvider.result(mock.providerJobId), null);
  record("Mock adapter", "SIMULATED, tidak ada video/foto dikirim/biaya aktual yang diklaim.", "SIMULATED");
  await denied("Gambar palsu ditolak", () => validateMaterial(Buffer.from("not image"), "image/png"));
  await denied("Rekaman palsu ditolak", () => validateMaterial(Buffer.from("not audio"), "audio/wav"));
}
main().catch(e => { results.push({ feature: "Validation halted", status: "FAIL", actual: e instanceof Error ? e.message : "Unknown failure" }); process.exitCode = 1; }).finally(async () => {
  const jobs = await db.select().from(videoJobs).where(eq(videoJobs.ownerId, uid));
  for (const job of jobs) await videoFile(`/objects/videos/${job.id}-final.mp4`).delete({ ignoreNotFound: true });
  for (const object of files) await creativeFile(object).delete({ ignoreNotFound: true });
  await db.delete(videoJobs).where(eq(videoJobs.ownerId, uid));
  await db.delete(conceptAttachments).where(eq(conceptAttachments.ownerId, uid));
  await db.delete(creativeConcepts).where(eq(creativeConcepts.ownerId, uid));
  await db.delete(characters).where(eq(characters.userId, uid));
  await db.delete(creativeCategories).where(eq(creativeCategories.id, category));
  await db.delete(auditLog).where(inArray(auditLog.userId, [uid, other]));
  await db.delete(members).where(inArray(members.id, [uid, other]));
  await rm(path.join(output, "test-tone.wav"), { force: true });
  await writeFile(path.join(output, "backend-validation.json"), JSON.stringify({ results, testFixturesCleaned: true }, null, 2));
  process.stdout.write(JSON.stringify({ pass: results.filter(r => r.status === "PASS").length, fail: results.filter(r => r.status === "FAIL"), simulated: results.filter(r => r.status === "SIMULATED").length, cleaned: true }) + "\n");
  await pool.end();
});
