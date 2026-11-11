/** Isolated synthetic fixtures only. Does not approve real KB, activate providers or change global settings. */
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { eq, inArray } from "drizzle-orm";
import { db, pool, members, characters, creativeCategories, creativeConcepts, conceptAttachments,
  creativeReviews, videoJobs, knowledgeSources, publicFacts, factEvents, conceptVersions, finalReviews, auditLog } from "@workspace/db";
import { parseConcept, buildCreative, staleReasons } from "../src/lib/creative-builder";
import { checkTransition } from "../src/lib/creative-policy";
import { readyMaterials } from "../src/lib/creative-service";
import { getSettings, enforceBudgets, costRecord } from "../src/lib/operations/controls";
import { saveFact, reviewFact, facts, reviewSource } from "../src/lib/operations/facts";
import { captureVersion, versions } from "../src/lib/operations/versions";
import { finalChecklist, finalTransition, finalStale, filePermission } from "../src/lib/operations/final-review";
import { csvCell, report, reportFilter } from "../src/lib/operations/reports";
import { retentionPreview, approveRetention } from "../src/lib/operations/retention";
import { createJob, readJob, videoConfig, cancelJob, serializeJob } from "../src/lib/video/service";
import { quotaDay } from "../src/lib/video/policy";
import { runVideoWorker } from "../src/lib/video/worker";
import { creativeFile } from "../src/lib/creative-storage";
import { videoFile } from "../src/lib/video/storage";

const ids = Array.from({ length: 4 }, () => `test_d_${randomUUID()}`);
const categoryId = randomUUID(), characterId = randomUUID(), sourceId = randomUUID(), conceptId = randomUUID(), logoId = randomUUID();
const objectPaths = [`/objects/concepts/${randomUUID()}.png`, `/objects/concepts/${randomUUID()}.png`];
const out = path.resolve("../../generated-artifacts/phase-d");
const results: { test: string; status: string; evidence: unknown }[] = [];
const record = (test: string, evidence: unknown) => results.push({ test, status: "PASS", evidence });
async function denied(test: string, fn: () => unknown | Promise<unknown>) {
  let refused = false;
  try { await fn(); } catch { refused = true; }
  assert(refused, test); record(test, "Ditolak oleh server.");
}
let sourceRevision = "", factId = "";
async function main() {
  assert.notEqual(process.env.NODE_ENV, "production");
  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, "backend-fixtures.json"), JSON.stringify({ memberIds: ids, conceptId, sourceId, categoryId, characterId, objectPaths }));
  const [creator, reviewer, admin, other] = await db.insert(members).values(ids.map((id, i) => ({
    id, email: `${randomUUID()}@example.com`, name: `D SYNTHETIC ${i}`, status: "ACTIVE",
    role: ["CREATOR", "REVIEWER_COMPLIANCE", "ADMIN", "CREATOR"][i]!,
  }))).returning();
  const conf = await getSettings();
  assert(!conf.paused && conf.localEnabled && conf.dailyLimit === 3, "Uji nyata memerlukan konfigurasi pengembangan awal3slot, renderer aktif. Tidak diubah otomatis.");
  const picture = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><rect width="720" height="1280" fill="#40304d"/><circle cx="360" cy="400" r="160" fill="#e6bf69"/><text x="360" y="760" text-anchor="middle" font-size="44" fill="#fff">DEMO INTERNAL</text></svg>')).png().toBuffer();
  const logo = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" fill="#efc560"/><text x="120" y="78" text-anchor="middle" font-size="42">TEST</text></svg>')).png().toBuffer();
  for (const [i, bytes] of [picture, logo].entries()) await creativeFile(objectPaths[i]!).save(bytes, { resumable: false, contentType: "image/png" });
  await db.insert(creativeCategories).values({ id: categoryId, name: `TEST D ${categoryId}`, active: true });
  await db.insert(characters).values({ id: characterId, userId: creator!.id, name: "Karakter geometris sintetis", objectPath: objectPaths[0]!, consentAt: new Date() });
  const [source] = await db.insert(knowledgeSources).values({ id: sourceId, sourceId: `test-${sourceId}`, fileName: "d-fixture.md",
    objectPath: "SYNTHETIC_NOT_ORIGINAL_UPLOAD", category: "TEST", title: "SUMBER SINTETIS BUKAN PERUSAHAAN",
    content: "Ini contoh sintetis untuk validasi teknis internal. Tidak memuat fakta produk atau janji investasi.",
    segment: "COMPANY", validation: "APPROVED", access: "APPROVED_FOR_PUBLIC_CONTENT", version: "fixture", sha256: "fixture", warnings: [], active: true }).returning();
  const proposed = await saveFact(null, { sourceId, claim: "Ini contoh sintetis untuk validasi teknis internal.",
    quote: "Ini contoh sintetis untuk validasi teknis internal." }, admin!);
  factId = proposed.id; sourceRevision = proposed.sourceRevision;
  await denied("Pengusul tidak dapat menyetujui fakta sendiri", () => reviewFact(factId, { version: proposed.version, status: "APPROVED", note: "Pemeriksaan sendiri tidak diperbolehkan." }, { ...admin!, role: "SUPER_ADMIN" }));
  const fact = await reviewFact(factId, { version: proposed.version, status: "APPROVED", note: "Fixture teknis sintetis; bukan persetujuan klaim perusahaan." }, reviewer!);
  assert(fact.usable && fact.version === 2); record("Fakta disetujui pemeriksa independen", { version: fact.version, usable: fact.usable });
  await denied("CREATOR tidak dapat menulis registry fakta", () => saveFact(null, { sourceId, claim: fact.claim, quote: fact.quote }, creator!));
  await denied("Kutipan tidak persis ditolak", () => saveFact(null, { sourceId, claim: fact.claim, quote: "Tidak ada kutipan ini dalam sumber." }, admin!));
  const input = parseConcept({ title: "DEMO D — BUKAN UNTUK PUBLIK", characterId, categoryId, segments: ["NONE"], style: "UGC", mode: "HEMAT",
    templateId: null, direction: "", characterMotion: "", cameraMotion: "zoom",
    purpose: "Pengujian teknis", scenes: "Bentuk geometris", visual: "Foto sintetis", narration: "Ini contoh sintetis untuk validasi teknis internal.",
    subtitle: "Ini contoh sintetis untuk validasi teknis internal.", cta: "DEMO INTERNAL", disclaimer: "BUKAN KONTEN PERUSAHAAN.",
    durationSeconds: 10, sourceIds: [], factIds: [factId], noFactualClaims: false, publicMode: true, materialConsent: true, format: "9:16" });
  const built = await buildCreative(input, creator!);
  assert.equal(built.blockers.length, 0, built.blockers.join(";"));
  assert.equal(built.snapshot.facts?.[0]?.version, fact.version);
  assert(!built.prompt.includes("Tidak memuat fakta produk atau janji investasi."), "Isi dokumen tidak boleh disertakan seluruhnya untuk publik.");
  record("Prompt publik memakai klaim spesifik, bukan izin seluruh dokumen", { facts: built.snapshot.facts?.length, policyVersion: built.snapshot.policyVersion });
  assert((await buildCreative({ ...input, factIds: [], noFactualClaims: false }, creator!)).blockers.length > 0);
  assert.equal((await buildCreative({ ...input, factIds: [], noFactualClaims: true }, creator!)).blockers.length, 0);
  record("Konsep netral memerlukan deklarasi eksplisit", "Tanpa fakta/deklarasi diblokir; NONE+deklarasi lolos sebelum review manusia.");
  await denied("Pemilik termasukSUPER tidak dapat review konsep sendiri", () => checkTransition({ id: creator!.id, role: "SUPER_ADMIN" }, { ownerId: creator!.id, status: "READY_FOR_REVIEW" }, "APPROVED"));
  checkTransition(reviewer!, { ownerId: creator!.id, status: "READY_FOR_REVIEW" }, "UNDER_REVIEW");
  checkTransition(reviewer!, { ownerId: creator!.id, status: "UNDER_REVIEW" }, "REVISED");
  record("UNDER_REVIEW dan permintaan revisi tersedia", "Transisi reviewer nonpemilik tervalidasi.");
  const [concept] = await db.insert(creativeConcepts).values({ id: conceptId, ownerId: creator!.id, status: "APPROVED", version: 3,
    data: input, snapshot: built.snapshot, prompt: built.prompt, warnings: built.warnings, blockers: [], submittedAt: new Date() }).returning();
  await db.insert(creativeReviews).values({ id: randomUUID(), conceptId, actorId: reviewer!.id, action: "APPROVED", version: 3, note: "Fixture teknis; bukan persetujuan konten perusahaan." });
  await db.insert(conceptAttachments).values({ id: logoId, conceptId, ownerId: creator!.id, name: "TEST.png", contentType: "image/png", size: logo.length,
    stagingPath: "", finalPath: objectPaths[1], state: "READY", expiresAt: new Date("9999-01-01") });
  await db.transaction(async tx => { await captureVersion(concept!, tx); });
  assert((await versions(conceptId, creator!))[0]!.evidence.includes("Fixture teknis"));
  record("Snapshot versi immutable dengan reviewer/bahan/naskah", "Versi3 tersimpan independen dari tabel konsep.");
  const body = { conceptId, version: 3, mode: "HEMAT", confirmed: true, requestKey: randomUUID(),
    options: { motion: "ZOOM_IN", logoPosition: "TOP_RIGHT", logoAttachmentId: logoId, cues: [{ start: 0, end: 10 }] } };
  const pair = await Promise.all([createJob(body, creator!), createJob(body, creator!)]);
  assert.equal(pair[0]!.id, pair[1]!.id); record("Klik paralel idempotent", "Satu job, satu slot kuota.");
  await runVideoWorker();
  let job = await readJob(pair[0]!.id, creator!);
  for (let i = 0; i < 120 && ["QUEUED", "PROCESSING"].includes(job.status); i++) {
    await new Promise(r => setTimeout(r, 500)); job = await readJob(job.id, creator!);
  }
  assert.equal(job.status, "COMPLETED", job.error ?? "Render belum selesai");
  await videoFile(job.resultPath!).download({ destination: path.join(out, "demo-review-hemat.mp4") });
  assert.equal(costRecord(job).actualUsd, null); assert.equal(costRecord(job).providerUsd, 0); assert(!costRecord(job).legacy);
  record("ModeHemat nyata dan biaya terstruktur", { status: job.status, hash: job.resultHash, cost: costRecord(job) });
  const call = (action: string, me = reviewer!, checklist: string[] = [], version = job.publicationVersion) =>
    finalTransition(job.id, { version, action, note: "Pemeriksaan sintetis untuk validasi teknis saja.", checklist }, me);
  await denied("Video belum diajukan tidak dapat disetujui", () => call("APPROVE"));
  await call("SUBMIT", creator!);
  job = await readJob(job.id, creator!);
  assert(!filePermission(job, reviewer!)); record("Reviewer belum ditugaskan tidak boleh membuka foto/MP4", "Metadata antrean tersedia; filePermission false.");
  await denied("PembuatSUPER tidak boleh mengambil review sendiri", () => call("CLAIM", { ...creator!, role: "SUPER_ADMIN" }));
  await call("CLAIM");
  job = await readJob(job.id, creator!);
  assert(filePermission(job, reviewer!));
  await denied("Checklist parsial tidak dapat menyetujui final", () => call("APPROVE", reviewer!, ["IDENTITY"]));
  await denied("Versi review lama tidak dapat menimpa status baru", () => call("APPROVE", reviewer!, finalChecklist, 0));
  await call("APPROVE", reviewer!, finalChecklist);
  job = await readJob(job.id, creator!);
  assert.equal(job.publicationStatus, "APPROVED_FOR_PUBLICATION"); assert(!(await finalStale(job, true)).stale);
  record("Review final independen10check dan binding MP4", { status: job.publicationStatus, version: job.publicationVersion, downloadable: !!(await serializeJob(job)).publicationUrl });
  await denied("Reviewer tidak dapat membatalkan job anggota lain", () => cancelJob(job.id, reviewer!));
  await denied("Anggota nonaktif tidak boleh membaca job sendiri", () => readJob(job.id, { ...creator!, status: "SUSPENDED" }));
  await denied("VIEWER tidak boleh membuat job", () => createJob(body, { ...creator!, role: "VIEWER" }));
  const race = await Promise.allSettled(Array.from({ length: 3 }, () => createJob({ ...body, requestKey: randomUUID() }, creator!)));
  assert.equal(race.filter(x => x.status === "fulfilled").length, 2);
  for (const r of race) if (r.status === "fulfilled") await cancelJob(r.value.id, creator!);
  assert.equal((await videoConfig(creator!)).dailyUsed, 3);
  record("Kuota3 aman paralel; gagal/batal tetap dihitung", "Dua slot tersisa; tiga request unik -> tepatdua diterima, total3 setelah dibatalkan.");
  const expensive = { ...job, actualCostUsd: 0.8, reservedCostUsd: 0, quotaDay: quotaDay() };
  const active = { ...job, status: "UNKNOWN", actualCostUsd: null, providerCostUsd: 0, reservedCostUsd: 0.4 };
  await denied("Reservasi UNKNOWN mencegah anggaran bulanan berlebih", () => enforceBudgets({ ...conf, budgetUsd: 1 }, [expensive, active], creator!.id, 0.1, true));
  await denied("Anggaran harian dikunci sebelum biaya baru", () => enforceBudgets({ ...conf, dailyBudgetUsd: 0.8 }, [expensive], creator!.id, 0, false));
  await denied("Batas anggota/bulan diterapkan", () => enforceBudgets({ ...conf, userBudgetUsd: 1 }, [expensive], creator!.id, 0.3, true));
  await denied("Biaya berbayar tanpa batas estimasi ditolak", () => enforceBudgets(conf, [], creator!.id, null, true));
  enforceBudgets({ ...conf, budgetUsd: 1 }, [{ ...active, status: "COMPLETED", reservedCostUsd: 0 }], creator!.id, 0.9, true);
  record("Reservasi selesai dilepas dari eksposur", "Hanya biaya aktual/diketahui + reservasi aktif dihitung; unknown bukan nol.");
  const r = await report({ userId: creator!.id }, admin!);
  assert.equal(r.summary.jobs, 3); assert.equal(r.summary.actualUsd, null); assert.equal(r.summary.approved, 1);
  record("Laporan filter anggota, failed/cancelled, estimasi/aktual/unknown", { count: r.summary.jobs, actual: r.summary.actualUsd, unknown: r.summary.unknownCosts });
  assert(csvCell('=HYPERLINK("evil")').startsWith('"\'='));
  assert(csvCell(" \t@SUM(1)").startsWith('"\''));
  assert.equal(reportFilter({ from: "2026-11-11", to: "2026-11-11" }).end - reportFilter({ from: "2026-11-11", to: "2026-11-11" }).start, 86400_000);
  record("CSV aman formula; filter tanggal Jakarta inklusif", "Prefix=,+,-,@ dan whitespace dinetralkan; satu tanggal tepat24jamJakarta.");
  await denied("CREATOR tidak boleh laporan operasional", () => report({}, creator!));
  const retention = await retentionPreview(admin!);
  assert.equal(retention.settings.retentionDays, null); assert.equal(retention.candidates.length, 0);
  await denied("ADMIN bukanSUPER tidak boleh mengaktifkan retensi", () => approveRetention({ version: 0, confirmed: true, note: "Pengujian, bukan persetujuan." }, admin!));
  record("Retensi defaultmanual, tidak menghapus tanpa keputusan pemilik", { days: retention.settings.retentionDays, approved: retention.settings.retentionApproved });
  await reviewFact(factId, { version: fact.version, status: "REVOKED", note: "Fixture dicabut untuk menguji invalidasi persetujuan." }, reviewer!);
  assert((await staleReasons(built.snapshot)).length > 0);
  assert((await finalStale(job)).stale);
  const revokedJob = await serializeJob(job);
  assert.equal(revokedJob.publicationUrl, null); assert.equal(revokedJob.publicationStatus, "REVISION_REQUIRED");
  assert(!(await facts(creator!)).some(f => f.id === factId));
  record("Pencabutan fakta membatalkan izin publikasi, bukan merusak MP4", { render: revokedJob.status, publication: revokedJob.publicationStatus, publicationUrl: revokedJob.publicationUrl });
  await denied("Keputusan sumber lama ditolak bila sumber berubah", () => reviewSource(sourceId, { revision: "old", validation: "APPROVED",
    access: "APPROVED_FOR_PUBLIC_CONTENT", clearWarnings: false, note: "Fixture versi lama tidak sah." }, reviewer!));
  assert.equal((await versions(conceptId, creator!))[0]!.version, 3);
  record("Riwayat persetujuan tetap tersimpan setelah fakta dicabut", "Snapshotversi3 tidak ditulis ulang.");
}
main().catch(e => { results.push({ test: "Validation halted", status: "FAIL", evidence: e instanceof Error ? e.message : "Unknown" }); process.exitCode = 1; })
  .finally(async () => {
    const jobs = await db.select().from(videoJobs).where(eq(videoJobs.ownerId, ids[0]!));
    for (const j of jobs) {
      for (const p of [j.resultPath, `/objects/videos/${j.id}-final.mp4`].filter((x): x is string => !!x)) await videoFile(p).delete({ ignoreNotFound: true });
      await db.delete(finalReviews).where(eq(finalReviews.jobId, j.id));
    }
    for (const p of objectPaths) await creativeFile(p).delete({ ignoreNotFound: true });
    await db.delete(videoJobs).where(eq(videoJobs.ownerId, ids[0]!));
    await db.delete(conceptAttachments).where(eq(conceptAttachments.ownerId, ids[0]!));
    await db.delete(conceptVersions).where(eq(conceptVersions.conceptId, conceptId));
    await db.delete(creativeConcepts).where(eq(creativeConcepts.id, conceptId));
    await db.delete(characters).where(eq(characters.id, characterId));
    await db.delete(creativeCategories).where(eq(creativeCategories.id, categoryId));
    if (factId) { await db.delete(factEvents).where(eq(factEvents.factId, factId)); await db.delete(publicFacts).where(eq(publicFacts.id, factId)); }
    await db.delete(knowledgeSources).where(eq(knowledgeSources.id, sourceId));
    await db.delete(auditLog).where(inArray(auditLog.userId, ids));
    await db.delete(members).where(inArray(members.id, ids));
    await writeFile(path.join(out, "backend-validation.json"), JSON.stringify({ results, fixturesCleaned: true, realSourcesChanged: false }, null, 2));
    console.log(JSON.stringify({ pass: results.filter(r => r.status === "PASS").length, failures: results.filter(r => r.status === "FAIL"), fixturesCleaned: true }));
    await pool.end();
  });
