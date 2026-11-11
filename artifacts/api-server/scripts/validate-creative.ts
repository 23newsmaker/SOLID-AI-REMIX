// Development-only validation. Calls real domain handlers in-process, not auth
// bypass endpoints. All fixture IDs are unique; no owner rows are edited.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db, pool, members, characters, knowledgeSources, creativeCategories, creativeTemplates,
  creativeConcepts, conceptAttachments, creativeReviews, auditLog, type MemberRecord,
} from "@workspace/db";
import type { CreativeConcept, CreativeConceptInput, CreativeCategory, CreativeTemplate } from "@workspace/api-zod";
import { creativeConceptRouter } from "../src/routes/creative-concepts";
import { creativeUploadRouter } from "../src/routes/creative-uploads";
import { creativeLibraryRouter } from "../src/routes/creative-library";
import { buildCreative, parseConcept, staleReasons } from "../src/lib/creative-builder";
import { checkQuota, checkSegments, checkTransition, canReadConcept, limits, CreativeError } from "../src/lib/creative-policy";
import { seedCreativeLibrary } from "../src/lib/creative-seed";
import { creativeFile, validateMaterial, cleanupCreativeObjects } from "../src/lib/creative-storage";
import type { Router } from "express";

const suffix = randomUUID();
const fixtureIds = ["creator", "other", "admin", "super", "reviewer", "viewer"].map(r => `creative-test-${r}-${suffix}`);
const sourceIds = ["mini", "mikro", "regular", "company", "internal", "restricted", "conflict"].map(r => `creative-test-source-${r}-${suffix}`);
const outputDir = fileURLToPath(new URL("../../../generated-artifacts/phase-b-validation", import.meta.url));
const checks: { name: string; status: "PASS" | "FAIL" | "NOT TESTED"; detail?: string }[] = [];
const objects = new Set<string>();
const assertReject = async (fn: () => Promise<unknown> | unknown, status?: number) => {
  await assert.rejects(async () => fn(), (e: unknown) => e instanceof CreativeError && (!status || e.status === status));
};
async function check(name: string, fn: () => Promise<void> | void) {
  try { await fn(); checks.push({ name, status: "PASS" }); }
  catch (e) { checks.push({ name, status: "FAIL", detail: e instanceof Error ? e.message : String(e) }); }
}
// Route handlers use generated Zod contracts, real DB transactions and storage.
// Authentication middleware is covered separately by authenticated browser tests.
async function call<T = CreativeConcept>(router: Router, method: string, path: string, actor: MemberRecord, body: unknown = {}, params: Record<string, string> = {}): Promise<T> {
  const layer = (router as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
  assert(layer, `Missing route ${method} ${path}`);
  let payload: T;
  let status = 200;
  const req = { member: actor, body, params, query: {}, log: { warn() {}, error() {}, info() {} } };
  const res = { status(n: number) { status = n; return this; }, json(value: T) { payload = value; return this; } };
  const handlers = layer.route.stack;
  await handlers[handlers.length - 1].handle(req, res, (e: unknown) => { if (e) throw e; });
  if (status >= 400) throw new CreativeError(status, JSON.stringify(payload!));
  return payload!;
}
async function fingerprint() {
  const data = await db.execute(sql`
    SELECT 'members' scope, count(*)::int total, md5(coalesce(string_agg(row_to_json(t)::text, '' order by id),'')) fingerprint
    FROM solid_members t WHERE id NOT LIKE 'creative-test-%'
    UNION ALL SELECT 'characters', count(*)::int, md5(coalesce(string_agg(row_to_json(t)::text, '' order by id),''))
    FROM solid_characters t WHERE user_id NOT LIKE 'creative-test-%'
    UNION ALL SELECT 'knowledge', count(*)::int, md5(coalesce(string_agg(row_to_json(t)::text, '' order by id),''))
    FROM solid_knowledge_sources t WHERE id NOT LIKE 'creative-test-source-%'`);
  return data.rows;
}
await mkdir(outputDir, { recursive: true });
const baseline = await fingerprint();
let actors: MemberRecord[] = [];
let sampleId = "";
let libraryCategoryId: string | undefined;
let libraryTemplateId: string | undefined;
try {
  const roles = ["CREATOR", "CREATOR", "ADMIN", "SUPER_ADMIN", "REVIEWER_COMPLIANCE", "VIEWER"] as const;
  actors = await db.insert(members).values(fixtureIds.map((id, i) => ({
    id, email: `${id}@example.invalid`, name: `Creative Test ${i}`, role: roles[i]!, status: "ACTIVE" as const,
  }))).returning();
  const actor = (role: string) => actors.find(a => a.role === role)!;
  const creator = actors.find(a => a.id === fixtureIds[0])!;
  const other = actors.find(a => a.id === fixtureIds[1])!;
  const chars = await db.insert(characters).values([creator, other, actor("SUPER_ADMIN")].map(a => ({
    id: `character-${a.id}`, userId: a.id, name: "Karakter uji sintetis",
    objectPath: "/objects/characters/nonexistent-test-photo.jpg", consentAt: new Date(),
  }))).returning();
  const char = chars.find(c => c.userId === creator.id)!;
  await seedCreativeLibrary();
  const categories = await db.select().from(creativeCategories).where(eq(creativeCategories.active, true));
  const templates = await db.select().from(creativeTemplates).where(eq(creativeTemplates.active, true));
  const input: CreativeConceptInput = {
    title: "Contoh konsep netral tersimpan — validasi Tahap B", characterId: char.id,
    categoryId: categories[0]!.id, segments: ["NONE"], style: "UGC", mode: "HEMAT", templateId: null,
    purpose: "Mengundang audiens mempelajari informasi resmi tanpa klaim produk.",
    direction: "  Presenter menyapa.\nJangan mengubah teks asli saya.  ",
    scenes: "Pembuka: menyapa. Isi: pengantar topik. Penutup: ajakan memeriksa informasi resmi.",
    characterMotion: "Gestur tangan natural.", cameraMotion: "Zoom perlahan.", visual: "Latar sederhana.",
    narration: "Mari pelajari informasi resmi dan pahami risikonya terlebih dahulu.",
    subtitle: "Pelajari informasi resmi.", cta: "Cari informasi resmi.",
    format: "9:16", durationSeconds: 12, sourceIds: [], publicMode: true, materialConsent: true,
  };
  await check("Admin menambah/mengubah/menonaktifkan kategori dan seluruh kolom template", async () => {
    const admin = actor("ADMIN");
    let cat = await call<CreativeCategory>(creativeLibraryRouter, "post", "/categories", admin, { name: "Kategori uji terisolasi", active: true });
    libraryCategoryId = cat.id;
    const templateInput = { ...templates[0]!, name: "Template uji terisolasi", categoryId: cat.id };
    let t = await call<CreativeTemplate>(creativeLibraryRouter, "post", "/templates", admin, templateInput);
    libraryTemplateId = t.id;
    const snapshot = await buildCreative({ ...input, categoryId: cat.id, templateId: t.id }, creator);
    t = await call<CreativeTemplate>(creativeLibraryRouter, "put", "/templates/:id", admin, { ...t, name: "Diubah", active: false }, { id: t.id });
    assert.equal(t.active, false); assert.equal(t.version, 2);
    await assertReject(() => call(creativeLibraryRouter, "put", "/templates/:id", admin, { ...t, version: 1 }, { id: t.id }), 409);
    assert((await staleReasons(snapshot.snapshot)).some(r => r.includes("Template")));
    cat = await call<CreativeCategory>(creativeLibraryRouter, "put", "/categories/:id", admin, { name: cat.name, active: false, version: cat.version }, { id: cat.id });
    assert.equal(cat.version, 2);
    await assertReject(() => buildCreative({ ...input, categoryId: cat.id }, creator), 400);
    assert.equal(snapshot.snapshot.template?.name, "Template uji terisolasi");
  });
  await check("Tujuh kategori dan semua kombinasi segmen/gaya/mode", async () => {
    assert(categories.length >= 7);
    const combinations: CreativeConceptInput["segments"][] = [["MIKRO"], ["MINI"], ["REGULAR"], ["MIKRO", "MINI"], ["MIKRO", "REGULAR"], ["MINI", "REGULAR"], ["MIKRO", "MINI", "REGULAR"], ["NONE"]];
    for (const cat of categories.slice(0, 7)) for (const segments of combinations) for (const style of ["UGC", "CINEMATIC"] as const) for (const mode of ["HEMAT", "AI"] as const) {
      const result = await buildCreative({ ...input, categoryId: cat.id, segments, style, mode }, creator);
      const prompt = JSON.parse(result.prompt);
      assert.equal(prompt.creative.style, style); assert.equal(prompt.creative.mode, mode);
      assert.deepEqual(prompt.productSegments, segments);
      if (!segments.includes("NONE")) assert(result.blockers.length > 0);
    }
  });
  await check("Segmen NONE eksklusif dan duplikasi ditolak", async () => {
    await assertReject(() => checkSegments(["NONE", "MINI"]), 400);
    await assertReject(() => checkSegments(["MIKRO", "MIKRO"]), 400);
  });
  await check("Template netral, kompatibilitas, teks asli utuh dan deterministik", async () => {
    const t = templates.find(t => t.style === "UGC")!;
    const d = { ...input, templateId: t.id, categoryId: t.categoryId, scenes: t.scenes, narration: t.narration };
    const a = await buildCreative(d, creator); const b = await buildCreative(d, creator);
    assert.equal(a.prompt, b.prompt);
    assert.equal(JSON.parse(a.prompt).creative.originalUserDirection, input.direction);
    assert.equal(a.snapshot.template?.version, t.version);
    assert(!/\d+%|keuntungan pasti/i.test(t.narration));
    await assertReject(() => buildCreative({ ...d, style: "CINEMATIC" }, creator), 400);
  });
  let concept = await call(creativeConceptRouter, "post", "/concepts", creator, input);
  sampleId = concept.id;
  await check("Contoh prompt benar-benar tersimpan dan dibaca ulang", async () => {
    const loaded = await call(creativeConceptRouter, "get", "/concepts/:id", creator, {}, { id: concept.id });
    assert.equal(loaded.prompt, concept.prompt);
    assert.equal(loaded.direction, input.direction);
    assert.equal(JSON.parse(loaded.prompt).technical.targetDurationSeconds, 12);
    await writeFile(`${outputDir}/saved-prompt-example.json`, JSON.stringify({
      evidence: "Created through real concept handler, reloaded from PostgreSQL, then fixture cleaned after validation.",
      id: loaded.id, version: loaded.version, createdAt: loaded.createdAt, prompt: JSON.parse(loaded.prompt),
    }, null, 2));
  });
  await check("Simpan/edit bertahan, konflik versi tidak menimpa", async () => {
    const old = concept;
    concept = await call(creativeConceptRouter, "put", "/concepts/:id", creator, { ...input, title: "Judul versi baru", version: concept.version }, { id: concept.id });
    await assertReject(() => call(creativeConceptRouter, "put", "/concepts/:id", creator, { ...input, version: old.version }, { id: concept.id }), 409);
    const loaded = await call(creativeConceptRouter, "get", "/concepts/:id", creator, {}, { id: concept.id });
    assert.equal(loaded.title, "Judul versi baru");
  });
  await check("Isolasi kreator, viewer hanya baca, admin/reviewer sesuai izin", async () => {
    await assertReject(() => call(creativeConceptRouter, "get", "/concepts/:id", other, {}, { id: concept.id }), 404);
    await assertReject(() => call(creativeConceptRouter, "get", "/concepts/:id", actor("REVIEWER_COMPLIANCE"), {}, { id: concept.id }), 404);
    await call(creativeConceptRouter, "get", "/concepts/:id", actor("ADMIN"), {}, { id: concept.id });
    await assertReject(() => call(creativeConceptRouter, "put", "/concepts/:id", actor("ADMIN"), { ...input, version: concept.version }, { id: concept.id }), 403);
    await assertReject(() => call(creativeConceptRouter, "post", "/concepts", actor("VIEWER"), input), 403);
    await call(creativeConceptRouter, "get", "/concepts/:id", { ...creator, role: "VIEWER" }, {}, { id: concept.id });
    assert(!canReadConcept(actor("VIEWER"), { ownerId: creator.id, status: "DRAFT", submittedAt: null }));
  });
  await check("Review, self-approval, admin bukan compliance, edit membatalkan approval", async () => {
    concept = await call(creativeConceptRouter, "post", "/concepts/:id/status", creator, { version: concept.version, status: "READY_FOR_REVIEW", note: "" }, { id: concept.id });
    await assertReject(() => call(creativeConceptRouter, "post", "/concepts/:id/status", { ...creator, role: "SUPER_ADMIN" }, { version: concept.version, status: "APPROVED", note: "self" }, { id: concept.id }), 403);
    await assertReject(() => call(creativeConceptRouter, "post", "/concepts/:id/status", actor("ADMIN"), { version: concept.version, status: "APPROVED", note: "admin" }, { id: concept.id }), 403);
    concept = await call(creativeConceptRouter, "post", "/concepts/:id/status", actor("REVIEWER_COMPLIANCE"), { version: concept.version, status: "REJECTED", note: "Uji penolakan" }, { id: concept.id });
    concept = await call(creativeConceptRouter, "post", "/concepts/:id/status", creator, { version: concept.version, status: "READY_FOR_REVIEW", note: "Periksa ulang" }, { id: concept.id });
    concept = await call(creativeConceptRouter, "post", "/concepts/:id/status", actor("SUPER_ADMIN"), { version: concept.version, status: "APPROVED", note: "Pemeriksaan manusia pada fixture netral" }, { id: concept.id });
    assert.equal(concept.status, "APPROVED");
    concept = await call(creativeConceptRouter, "put", "/concepts/:id", creator, { ...input, version: concept.version }, { id: concept.id });
    assert.equal(concept.status, "DRAFT");
    await assertReject(() => call(creativeConceptRouter, "get", "/concepts/:id", actor("REVIEWER_COMPLIANCE"), {}, { id: concept.id }), 404);
  });
  await check("Batas 10 konsep atomik saat pembuatan bersamaan", async () => {
    const result = await Promise.allSettled(Array.from({ length: 11 }, () => call(creativeConceptRouter, "post", "/concepts", creator, input)));
    assert.equal(result.filter(r => r.status === "fulfilled").length, 9);
    assert.equal(result.filter(r => r.status === "rejected").length, 2);
  });
  await check("Fakta publik/akses/konflik dan Mini tidak disalin ke Mikro", async () => {
    const segs = ["MINI", "MIKRO", "REGULAR", "COMPANY", "MINI", "MINI", "MINI"];
    await db.insert(knowledgeSources).values(sourceIds.map((id, i) => ({
      id, sourceId: id, title: "TEST ONLY — synthetic reference", segment: segs[i]!,
      category: "TEST", validation: "APPROVED",
      access: i === 4 ? "INTERNAL_GENERAL" : i === 5 ? "INTERNAL_RESTRICTED" : "APPROVED_FOR_PUBLIC_CONTENT",
      version: "test", fileName: "test.txt", objectPath: "/objects/test-nonexistent",
      content: `TEST ONLY ${segs[i]} ${i}`, sha256: "synthetic", warnings: i === 6 ? ["TEST CONFLICT"] : [],
    })));
    const built = await buildCreative({ ...input, segments: ["MIKRO", "MINI"], sourceIds: [sourceIds[0]!] }, creator);
    const facts = JSON.parse(built.prompt).factsBySegment;
    assert.equal(facts.find((f: any) => f.segment === "MIKRO").sources.length, 0);
    assert.equal(facts.find((f: any) => f.segment === "MINI").sources.length, 1);
    assert(built.blockers.some(b => b.includes("MIKRO")));
    const restricted = await buildCreative({ ...input, segments: ["MINI"], sourceIds: [sourceIds[5]!] }, creator);
    assert(!restricted.prompt.includes("TEST ONLY MINI 5"));
    const internal = await buildCreative({ ...input, segments: ["MINI"], sourceIds: [sourceIds[4]!] }, creator);
    assert(!internal.prompt.includes("TEST ONLY MINI 4"));
    const conflict = await buildCreative({ ...input, segments: ["MINI"], sourceIds: [sourceIds[6]!] }, creator);
    assert(conflict.blockers.length > 0);
    const wrong = await buildCreative({ ...input, segments: ["REGULAR"], sourceIds: [sourceIds[0]!] }, creator);
    assert(!wrong.prompt.includes("TEST ONLY MINI 0"));
    concept = await call(creativeConceptRouter, "put", "/concepts/:id", creator,
      { ...input, segments: ["MINI"], sourceIds: [sourceIds[0]!], version: concept.version }, { id: concept.id });
    await db.update(knowledgeSources).set({ access: "INTERNAL_RESTRICTED" }).where(eq(knowledgeSources.id, sourceIds[0]!));
    const revoked = await call(creativeConceptRouter, "get", "/concepts/:id", creator, {}, { id: concept.id });
    assert(!revoked.prompt.includes("TEST ONLY MINI 0"));
    assert(revoked.stale);
    await db.update(knowledgeSources).set({ access: "APPROVED_FOR_PUBLIC_CONTENT" }).where(eq(knowledgeSources.id, sourceIds[0]!));
    concept = await call(creativeConceptRouter, "put", "/concepts/:id", creator,
      { ...input, version: concept.version }, { id: concept.id });
  });
  await check("Perubahan sumber/template/karakter menghasilkan tanda kedaluwarsa", async () => {
    const built = await buildCreative({ ...input, segments: ["MINI"], sourceIds: [sourceIds[0]!] }, creator);
    await db.update(knowledgeSources).set({ version: "test-changed" }).where(eq(knowledgeSources.id, sourceIds[0]!));
    assert((await staleReasons(built.snapshot)).length > 0);
    await db.update(characters).set({ updatedAt: new Date(Date.now() + 2000) }).where(eq(characters.id, char.id));
    assert((await staleReasons(built.snapshot)).some(r => r.includes("Karakter")));
    // Only a newly created test template is changed, never a seed/owner template.
    const [t] = await db.insert(creativeTemplates).values({ ...templates[0]!, id: `creative-test-template-${suffix}` }).returning();
    const withTemplate = await buildCreative({ ...input, categoryId: t!.categoryId, templateId: t!.id }, creator);
    await db.update(creativeTemplates).set({ active: false, version: 2 }).where(eq(creativeTemplates.id, t!.id));
    assert((await staleReasons(withTemplate.snapshot)).some(r => r.includes("Template")));
  });
  // Refresh the selected concept after the test character revision changed.
  concept = await call(creativeConceptRouter, "put", "/concepts/:id", creator, { ...input, version: concept.version }, { id: concept.id });
  await check("Batas ukuran, jumlah gambar/video dan total termasuk pending", async () => {
    await assertReject(() => checkQuota([], { contentType: "image/png", size: limits.maxImageBytes + 1 }), 409);
    await assertReject(() => checkQuota([], { contentType: "video/mp4", size: limits.maxVideoBytes + 1 }), 409);
    await assertReject(() => checkQuota(Array.from({ length: 3 }, () => ({ contentType: "image/png", size: 1 })), { contentType: "image/jpeg", size: 1 }), 409);
    await assertReject(() => checkQuota([{ contentType: "video/mp4", size: 1 }], { contentType: "video/mp4", size: 1 }), 409);
    checkQuota([{ contentType: "video/mp4", size: limits.maxVideoBytes }, ...Array.from({ length: 2 }, () => ({ contentType: "image/png", size: limits.maxImageBytes }))], { contentType: "image/png", size: limits.maxImageBytes });
    const reservations = await Promise.allSettled(Array.from({ length: 4 }, () =>
      call(creativeUploadRouter, "post", "/concepts/:id/uploads", creator, {
        version: concept.version, name: "pending.png", contentType: "image/png", size: 1,
      }, { id: concept.id })));
    assert.equal(reservations.filter(r => r.status === "fulfilled").length, 3);
    assert.equal(reservations.filter(r => r.status === "rejected").length, 1);
    const pending = await db.select().from(conceptAttachments).where(eq(conceptAttachments.conceptId, concept.id));
    assert.equal(pending.length, 3);
    for (const row of pending) objects.add(row.stagingPath);
    await assertReject(() => call(creativeConceptRouter, "post", "/concepts/:id/status", creator, {
      version: concept.version, status: "READY_FOR_REVIEW", note: "",
    }, { id: concept.id }), 409);
    // These test tickets are never uploaded; advance only their fixture expiry.
    await db.update(conceptAttachments).set({ expiresAt: new Date(Date.now() - 120_000) })
      .where(inArray(conceptAttachments.id, pending.map(p => p.id)));
    await cleanupCreativeObjects();
  });
  await check("Validasi isi gambar dan MP4 lokal, pemalsuan ditolak", async () => {
    const png = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#dd6644" } }).png().toBuffer();
    await validateMaterial(png, "image/png");
    await assertReject(() => validateMaterial(Buffer.from("fake png"), "image/png"), 400);
    await assertReject(() => validateMaterial(png, "image/jpeg"), 400);
    await assertReject(() => validateMaterial(Buffer.from("fake video"), "video/mp4"), 400);
    const video = execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=c=black:s=32x32:d=0.2", "-an", "-c:v", "libx264", "-movflags", "frag_keyframe+empty_moov", "-f", "mp4", "pipe:1"], { maxBuffer: 1024 * 1024 });
    await validateMaterial(video, "video/mp4");
  });
  await check("Unggah langsung privat, kepemilikan, final immutable, consent dan hapus", async () => {
    const png = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#225544" } }).png().toBuffer();
    const ticket = await call<{ uploadId: string; uploadURL: string }>(creativeUploadRouter, "post", "/concepts/:id/uploads", creator, { version: concept.version, name: "test.png", contentType: "image/png", size: png.length }, { id: concept.id });
    const [reserved] = await db.select().from(conceptAttachments).where(eq(conceptAttachments.id, ticket.uploadId));
    objects.add(reserved!.stagingPath);
    const put = await fetch(ticket.uploadURL, { method: "PUT", body: png, headers: { "Content-Type": "image/png" } });
    assert(put.ok);
    await assertReject(() => call(creativeUploadRouter, "post", "/concepts/:id/uploads/:uploadId", other, { version: concept.version }, { id: concept.id, uploadId: ticket.uploadId }), 404);
    concept = await call(creativeUploadRouter, "post", "/concepts/:id/uploads/:uploadId", creator, { version: concept.version }, { id: concept.id, uploadId: ticket.uploadId });
    const [ready] = await db.select().from(conceptAttachments).where(eq(conceptAttachments.id, ticket.uploadId));
    objects.add(ready!.finalPath!);
    assert.notEqual(ready!.stagingPath, ready!.finalPath);
    assert.equal(concept.materialConsent, false);
    assert.equal(concept.status, "DRAFT");
    assert.equal(JSON.parse(concept.prompt).materials.length, 1);
    assert.deepEqual(Object.keys(JSON.parse(concept.prompt).materials[0]).sort(),
      ["id", "name", "contentType", "size", "validation", "publicUseDeclared"].sort());
    await assertReject(() => call(creativeConceptRouter, "post", "/concepts/:id/status", creator, { version: concept.version, status: "READY_FOR_REVIEW", note: "" }, { id: concept.id }), 409);
    const before = createHash("sha256").update(await (await creativeFile(ready!.finalPath!).download())[0]).digest("hex");
    await fetch(ticket.uploadURL, { method: "PUT", body: Buffer.from("changed staging"), headers: { "Content-Type": "image/png" } });
    const after = createHash("sha256").update(await (await creativeFile(ready!.finalPath!).download())[0]).digest("hex");
    assert.equal(before, after);
    concept = await call(creativeUploadRouter, "delete", "/concepts/:id/uploads/:uploadId", creator, { version: concept.version }, { id: concept.id, uploadId: ticket.uploadId });
    assert.equal(concept.attachments.length, 0);
    await db.update(conceptAttachments).set({ expiresAt: new Date(Date.now() - 120_000) }).where(eq(conceptAttachments.id, ticket.uploadId));
    await cleanupCreativeObjects();
    assert.equal((await creativeFile(ready!.finalPath!).exists())[0], false);
    assert.equal((await creativeFile(ready!.stagingPath).exists())[0], false);
  });
  await check("API hapus memakai versi dan konsep hilang setelah hapus", async () => {
    await assertReject(() => call(creativeConceptRouter, "delete", "/concepts/:id", creator, { version: concept.version - 1 }, { id: concept.id }), 409);
    await call(creativeConceptRouter, "delete", "/concepts/:id", creator, { version: concept.version }, { id: concept.id });
    await assertReject(() => call(creativeConceptRouter, "get", "/concepts/:id", creator, {}, { id: concept.id }), 404);
  });
} finally {
  for (const path of objects) await creativeFile(path).delete({ ignoreNotFound: true });
  await db.delete(creativeReviews).where(inArray(creativeReviews.actorId, fixtureIds));
  await db.delete(conceptAttachments).where(inArray(conceptAttachments.ownerId, fixtureIds));
  await db.delete(creativeConcepts).where(inArray(creativeConcepts.ownerId, fixtureIds));
  await db.delete(creativeTemplates).where(eq(creativeTemplates.id, `creative-test-template-${suffix}`));
  if (libraryTemplateId) await db.delete(creativeTemplates).where(eq(creativeTemplates.id, libraryTemplateId));
  if (libraryCategoryId) await db.delete(creativeCategories).where(eq(creativeCategories.id, libraryCategoryId));
  await db.delete(knowledgeSources).where(inArray(knowledgeSources.id, sourceIds));
  await db.delete(characters).where(inArray(characters.userId, fixtureIds));
  await db.delete(auditLog).where(inArray(auditLog.userId, fixtureIds));
  await db.delete(members).where(inArray(members.id, fixtureIds));
  await check("Data uji dibersihkan, akun/aset/sumber pemilik tidak berubah", async () => {
    assert.deepEqual(await fingerprint(), baseline);
  });
  await writeFile(`${outputDir}/api-validation.json`, JSON.stringify({
    at: new Date().toISOString(), method: "In-process real domain handlers + real PostgreSQL/private App Storage. Auth is covered by a separate browser pass.",
    samplePersistedThenCleaned: sampleId, checks,
  }, null, 2));
  process.stdout.write(JSON.stringify(checks, null, 2) + "\n");
  await pool.end();
}
if (checks.some(c => c.status === "FAIL")) process.exitCode = 1;
