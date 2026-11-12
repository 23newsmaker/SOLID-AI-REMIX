/** Real authenticated HTTP + worker checks. Only recorded synthetic fixtures are cleaned. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { and, eq, inArray } from "drizzle-orm";
import sharp from "sharp";
import { db, pool, members, studioFolders, studioSelfChecks, characters, characterUploads,
  creativeConcepts, conceptAttachments, creativeReviews, conceptVersions, videoJobs, finalReviews,
  auditLog, knowledgeSources, type KnowledgeRecord } from "@workspace/db";
import { newStudioToken, STUDIO_COOKIE } from "../src/lib/studio-access";
import { ObjectStorageService, objectStorageClient } from "../src/lib/objectStorage";
import { buildCreative, parseConcept, staleReasons } from "../src/lib/creative-builder";
import { eligibleConcept, jobReferenceFolder, quotaDay } from "../src/lib/video/policy";
import { getSettings, enforceBudgets } from "../src/lib/operations/controls";
import { studioReferences, STUDIO_REFERENCE_POLICY } from "../src/lib/studio-references";

const label = `SYNTHETIC-REFERENCES-${randomUUID()}`;
const sourceIds = [randomUUID(), randomUUID(), randomUUID()];
const checks: string[] = [];
let owner = "", folder = "";
const cookie = `${STUDIO_COOKIE}=${newStudioToken()}`;
const base = "http://localhost:80/api";
const headers = () => ({ Cookie: cookie, "Content-Type": "application/json", "X-Solid-Folder": folder });
async function call(path: string, method = "GET", body?: unknown, status = 200) {
  const response = await fetch(`${base}${path}`, { method, headers: headers(),
    body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(response.status, status, `${method} ${path}: ${response.status} (expected ${status})`);
  return response.json();
}
function mark(test: string) { checks.push(test); console.info(`PASS ${test}`); }

// Only replace KB reads; real identity/category checks continue to use the DB.
function withSources(rows: KnowledgeRecord[]): Pick<typeof db, "select"> {
  return { select: (...args: unknown[]) => ({
    from: (table: unknown) => table === knowledgeSources
      ? { where: () => Object.assign(Promise.resolve(rows), { limit: async () => rows.slice(0, 1) }) }
      : (db.select as Function)(...args).from(table),
  }) } as Pick<typeof db, "select">;
}

async function main() {
  assert.notEqual(process.env.NODE_ENV, "production");
  await mkdir("../../generated-artifacts/studio-references", { recursive: true });
  const created = await call("/studio/folders", "POST", { name: label });
  owner = created.memberId; folder = created.id;
  await writeFile("../../generated-artifacts/studio-references/fixtures.json", JSON.stringify({ owner, folder, sourceIds }));
  const [member] = await db.select().from(members).where(eq(members.id, owner));
  const portrait = await sharp({ create: { width: 720, height: 1280, channels: 3, background: "#243c58" } }).jpeg().toBuffer();
  const upload = await call("/character/uploads", "POST", { name: "synthetic.jpg", size: portrait.length, contentType: "image/jpeg" });
  assert((await fetch(upload.uploadURL, { method: "PUT", body: new Uint8Array(portrait), headers: { "Content-Type": "image/jpeg" } })).ok);
  const character = await call("/character", "PUT", { name: label, uploadId: upload.uploadId, consent: true });
  const library = await call("/creative/library");
  const input = parseConcept({
    title: label, characterId: character.id, categoryId: library.categories.find((c: { active: boolean }) => c.active).id,
    segments: ["MIKRO"], style: "UGC", mode: "HEMAT", templateId: null,
    purpose: "Pengujian sintetis, bukan klaim produk nyata.", direction: "  Pertahankan arahan ini.\n", scenes: "Foto sintetis",
    characterMotion: "", cameraMotion: "", visual: "", narration: "Ini naskah uji Mikro milik pembuat.",
    subtitle: "Ini naskah uji Mikro milik pembuat.", cta: "", disclaimer: "",
    format: "9:16", durationSeconds: 10, sourceIds: [], factIds: [], noFactualClaims: false, publicMode: true, materialConsent: true,
  });
  const noKb = await buildCreative(input, member!, withSources([]), [], folder);
  assert.deepEqual(noKb.blockers, []);
  assert(noKb.warnings.some(w => w.includes("Tidak ada rujukan")));
  assert.equal(JSON.parse(noKb.prompt).factualVerification, "NOT_PERFORMED");
  assert.equal(JSON.parse(noKb.prompt).narration.text, input.narration);
  mark("KB kosong tidak menghalangi dan tidak dianggap verifikasi berhasil");
  await assert.rejects(() => buildCreative(input, member!, db, [], randomUUID()));
  mark("Folder yang tidak sah ditolak, bukan dipercaya dari flag");
  for (const [index, id] of sourceIds.entries()) await db.insert(knowledgeSources).values({
    id, sourceId: `000-${label}-${index}`, title: index === 1 ? "RESTRICTED_SENTINEL" : `${label}-${index}`,
    segment: index === 2 ? "REGULAR" : "MIKRO", category: "SYNTHETIC", validation: "APPROVED",
    access: index === 1 ? "INTERNAL_RESTRICTED" : "APPROVED_FOR_PUBLIC_CONTENT", version: "1",
    fileName: "synthetic.md", objectPath: "SYNTHETIC_NO_FILE", content: `NEVER_COPY_FULL_DOCUMENT_${id}`,
    sha256: randomUUID(), warnings: [],
  });
  const sourceRows = await db.select().from(knowledgeSources).where(inArray(knowledgeSources.id, sourceIds));
  const unmatched = await studioReferences({ ...input, segments: ["MINI"] }, withSources(sourceRows));
  assert.deepEqual(unmatched, []);
  const referenced = await buildCreative({ ...input, sourceIds, factIds: [randomUUID()] }, member!, withSources(sourceRows), [], folder);
  assert.equal(referenced.blockers.length, 0);
  assert.deepEqual(referenced.snapshot.sources.map(s => s.id), [sourceIds[0]]);
  assert(!referenced.prompt.includes("RESTRICTED_SENTINEL"));
  assert(sourceRows.every(s => !referenced.prompt.includes(s.content)));
  mark("Pencocokan metadata memisahkan segmen dan menolak sumber terbatas tanpa menyalin dokumen");
  const conflicted = await studioReferences(input, withSources([{ ...sourceRows[0]!, warnings: ["conflict"] }]));
  assert.deepEqual(conflicted, []);
  const privateBuilt = await buildCreative(input, member!);
  assert(privateBuilt.blockers.length > 0);
  mark("Alur privat tetap membutuhkan syarat fakta lama");
  const config = await getSettings();
  for (const limits of [{ ...config, paused: true }, { ...config, budgetUsd: 0 }, { ...config, dailyBudgetUsd: 0 }, { ...config, userBudgetUsd: 0 }]) {
    assert.throws(() => enforceBudgets(limits, [], owner, 0, false));
  }
  mark("Jeda dan batas anggaran bulanan/harian/anggota tetap menolak");
  for (const segment of ["MIKRO", "MINI", "REGULAR"] as const) {
    const data = { ...input, segments: [segment], narration: `Ini naskah uji ${segment} milik pembuat.`, subtitle: `Ini naskah uji ${segment} milik pembuat.` };
    let concept = await call("/creative/concepts", "POST", data);
    assert.equal(concept.blockers.length, 0);
    assert.equal(concept.noFactualClaims, false);
    assert.equal(concept.narration, data.narration);
    const options = { motion: "ZOOM_IN", logoPosition: "TOP_RIGHT", brandingMode: "NONE",
      postTextMode: "MANUAL_AFTER_DOWNLOAD", cues: [{ start: 0, end: 10 }] };
    const request = () => ({ conceptId: concept.id, version: concept.version, mode: "HEMAT", confirmed: true,
      options, requestKey: randomUUID() });
    if (segment === "MIKRO") {
      await call("/video/jobs", "POST", { ...request(), version: 999 }, 409);
      await call("/video/jobs", "POST", { ...request(), options: { ...options, cues: [{ start: 5, end: 3 }] } }, 400);
      const ticket = await call(`/creative/concepts/${concept.id}/uploads`, "POST", {
        version: concept.version, name: "synthetic.png", size: 100, contentType: "image/png",
      });
      await call("/video/jobs", "POST", request(), 409);
      concept = await call(`/creative/concepts/${concept.id}/uploads/${ticket.uploadId}`, "DELETE", { version: concept.version });
      await assert.rejects(() => eligibleConcept(concept.id, concept.version, { ...member!, status: "SUSPENDED" }, options as any, undefined, folder));
      const forged = await buildCreative({ ...data, characterId: randomUUID() }, member!, db, [], folder).then(() => false, () => true);
      assert(forged);
      // Older jobs retain the legacy policy even when the folder now exists.
      await assert.rejects(() => eligibleConcept(concept.id, concept.version, member!, options as any));
      const before = (await db.select().from(creativeConcepts).where(eq(creativeConcepts.id, concept.id)))[0];
      await call(`/creative/concepts/${concept.id}`);
      const after = (await db.select().from(creativeConcepts).where(eq(creativeConcepts.id, concept.id)))[0];
      assert.deepEqual(after, before, "Opening a page must not mutate saved evidence");
      mark("Versi salah, subtitle rusak, unggahan tertunda, anggota nonaktif, dan karakter asing ditolak");
      mark("Pembacaan tidak mengubah konsep dan job tanpa kebijakan baru tetap ketat");
    }
    const payload = request();
    // Persisted folder MUST come from the session, not caller-supplied options.
    payload.options = { ...options, referencePolicy: STUDIO_REFERENCE_POLICY, studioFolderId: randomUUID() } as typeof options;
    const job = await call("/video/jobs", "POST", payload);
    assert.equal(job.options.referencePolicy, STUDIO_REFERENCE_POLICY);
    assert.equal(job.options.studioFolderId, folder);
    assert.equal(jobReferenceFolder(job.options), folder);
    const snapshot = (await db.select().from(creativeConcepts).where(eq(creativeConcepts.id, concept.id)))[0]!.snapshot;
    if (segment === "MIKRO") {
      await db.update(knowledgeSources).set({ version: "2", access: "INTERNAL_RESTRICTED" }).where(eq(knowledgeSources.id, sourceIds[0]!));
      assert((await staleReasons(snapshot as any)).length > 0);
      assert.deepEqual(await staleReasons(snapshot as any, db, false), []);
      const loaded = await call(`/creative/concepts/${concept.id}`);
      assert.equal(loaded.stale, false);
      assert.equal(loaded.blockers.length, 0);
      assert(loaded.warnings.some((w: string) => w.includes("Rujukan KB tersimpan berubah")));
      assert(!loaded.prompt.includes(sourceIds[0]!));
      // Exactly the worker/restart validation path, after revocation.
      await eligibleConcept(concept.id, concept.version, member!, job.options, undefined, jobReferenceFolder(job.options));
    }
    let finished = job;
    for (let i = 0; i < 120 && !["COMPLETED", "FAILED", "CANCELLED", "UNKNOWN"].includes(finished.status); i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      finished = await call(`/video/jobs/${job.id}`);
    }
    assert.equal(finished.status, "COMPLETED", finished.error ?? "Worker did not finish");
    const download = await fetch(`http://localhost:80${finished.resultUrl}`, { headers: headers() });
    assert.equal(download.status, 200); assert.equal(download.headers.get("content-type"), "video/mp4");
    const bytes = Buffer.from(await download.arrayBuffer());
    assert(bytes.length > 1000);
    await writeFile(`../../generated-artifacts/studio-references/${segment.toLowerCase()}.mp4`, bytes);
    const anonymous = await fetch(`http://localhost:80${finished.resultUrl}`);
    assert.equal(anonymous.status, 401);
    const checkPath = `/studio/folders/${folder}/checks/${job.id}`;
    assert.equal((await call(checkPath, "POST", { confirmed: true, conceptVersion: concept.version })).checked, true);
    if (segment === "MIKRO") {
      await db.update(knowledgeSources).set({ active: false }).where(eq(knowledgeSources.id, sourceIds[0]!));
      assert.equal((await call(checkPath)).checked, true, "External KB changes do not invalidate new self-checks");
    }
    assert.equal((await call("/video/jobs", "POST", payload)).id, job.id);
    mark(`${segment}: MP4 nyata tanpa pilihan fakta, unduh privat, pemeriksaan mandiri dan idempotensi berhasil`);
  }
  assert.equal((await call("/video/config")).dailyUsed, 3);
  const concept = (await call("/creative/concepts"))[0];
  await call("/video/jobs", "POST", { conceptId: concept.id, version: concept.version, mode: "HEMAT", confirmed: true,
    requestKey: randomUUID(), options: { motion: "ZOOM_IN", logoPosition: "TOP_RIGHT", brandingMode: "NONE",
      postTextMode: "MANUAL_AFTER_DOWNLOAD", cues: [{ start: 0, end: 10 }] } }, 409);
  mark(`Kuota harian ${quotaDay()} tetap menolak job keempat`);
}

async function cleanup() {
  await db.delete(knowledgeSources).where(inArray(knowledgeSources.id, sourceIds));
  if (!owner) return;
  const [member] = await db.select().from(members).where(eq(members.id, owner));
  assert.equal(member?.name, label); assert.equal(member?.email, "folder@studio.invalid");
  const cs = await db.select().from(characters).where(eq(characters.userId, owner));
  const ups = await db.select().from(characterUploads).where(eq(characterUploads.userId, owner));
  const ats = await db.select().from(conceptAttachments).where(eq(conceptAttachments.ownerId, owner));
  const jobs = await db.select().from(videoJobs).where(eq(videoJobs.ownerId, owner));
  assert(!jobs.some(j => ["QUEUED", "PROCESSING", "SUBMITTED"].includes(j.status)), "Do not remove active fixtures");
  const storage = new ObjectStorageService();
  const paths = [...cs.map(c => c.objectPath), ...ups.map(u => u.objectPath), ...ats.flatMap(a => [a.stagingPath, a.finalPath]),
    ...jobs.flatMap(j => [j.resultPath, j.rawResultPath, `/objects/videos/${j.id}-final.mp4`])].filter((p): p is string => !!p);
  for (const path of new Set(paths)) {
    assert(/^\/objects\/(characters|uploads|concepts|videos)\/[a-zA-Z0-9._-]+$/.test(path));
    const [bucket, ...parts] = `${storage.getPrivateObjectDir()}/${path.slice(9)}`.replace(/^\/+/, "").split("/");
    await objectStorageClient.bucket(bucket!).file(parts.join("/")).delete({ ignoreNotFound: true });
  }
  await db.transaction(async tx => {
    const jobIds = jobs.map(j => j.id);
    const concepts = await tx.select().from(creativeConcepts).where(eq(creativeConcepts.ownerId, owner));
    if (jobIds.length) {
      await tx.delete(studioSelfChecks).where(inArray(studioSelfChecks.jobId, jobIds));
      await tx.delete(finalReviews).where(inArray(finalReviews.jobId, jobIds));
    }
    if (concepts.length) await tx.delete(creativeReviews).where(inArray(creativeReviews.conceptId, concepts.map(c => c.id)));
    await tx.delete(videoJobs).where(eq(videoJobs.ownerId, owner));
    await tx.delete(conceptAttachments).where(eq(conceptAttachments.ownerId, owner));
    await tx.delete(conceptVersions).where(eq(conceptVersions.ownerId, owner));
    await tx.delete(creativeConcepts).where(eq(creativeConcepts.ownerId, owner));
    await tx.delete(characterUploads).where(eq(characterUploads.userId, owner));
    await tx.delete(characters).where(eq(characters.userId, owner));
    await tx.delete(auditLog).where(eq(auditLog.userId, owner));
    await tx.delete(studioFolders).where(and(eq(studioFolders.id, folder), eq(studioFolders.memberId, owner)));
    await tx.delete(members).where(eq(members.id, owner));
  });
  mark("Hanya fixture tercatat dan objek privat sintetis dibersihkan");
}
let passed = false;
main().then(() => { passed = true; }).catch(error => {
  console.error(error instanceof Error ? error.message : "Verification failed"); process.exitCode = 1;
}).finally(async () => {
  try {
    await cleanup();
    await writeFile("../../generated-artifacts/studio-references/results.json", JSON.stringify({ passed, checks }, null, 2));
  } finally { await pool.end(); }
});
