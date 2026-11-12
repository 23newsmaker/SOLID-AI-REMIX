import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, and, sql } from "drizzle-orm";
import sharp from "sharp";
import { db, pool, members, studioFolders, studioSelfChecks, characters, characterUploads, creativeConcepts, conceptAttachments, creativeReviews, conceptVersions, videoJobs, finalReviews, auditLog } from "@workspace/db";
import { newStudioToken, STUDIO_COOKIE } from "../src/lib/studio-access";
import { ObjectStorageService, objectStorageClient } from "../src/lib/objectStorage";

// Authenticated HTTP/API test with synthetic assets, not a physical-browser test.
async function main() {
  assert.notEqual(process.env.NODE_ENV, "production");
  const cookie = `${STUDIO_COOKIE}=${newStudioToken()}`;
  const label = `SYNTHETIC-BRANDING-${randomUUID()}`;
  let owner = "", folder = "", conceptId = "";
  const call = async (path: string, method = "GET", body?: unknown) => {
    const response = await fetch(`http://localhost:80/api${path}`, { method,
      headers: { Cookie: cookie, "Content-Type": "application/json", ...(folder ? { "X-Solid-Folder": folder } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    assert.equal(response.status, 200, `${method} ${path} returned ${response.status}`);
    return response.json();
  };
  try {
    const created = await call("/studio/folders", "POST", { name: label });
    folder = created.id; owner = created.memberId;
    assert(owner.startsWith("studio_") && folder);
    const portrait = await sharp({ create: { width: 720, height: 1280, channels: 3, background: "#1644aa" } }).jpeg().toBuffer();
    const ticket = await call("/character/uploads", "POST", { name: "synthetic.jpg", size: portrait.length, contentType: "image/jpeg" });
    assert((await fetch(ticket.uploadURL, { method: "PUT", body: new Uint8Array(portrait), headers: { "Content-Type": "image/jpeg" } })).ok);
    const character = await call("/character", "PUT", { name: label, uploadId: ticket.uploadId, consent: true });
    const library = await call("/creative/library");
    const input = { title: label, characterId: character.id, categoryId: library.categories.find((c: { active: boolean }) => c.active).id,
      segments: ["NONE"], style: "UGC", mode: "HEMAT", templateId: null, purpose: "Internal synthetic technical verification",
      direction: "", scenes: "Synthetic portrait", characterMotion: "", cameraMotion: "zoom", visual: "",
      narration: "Ini video uji internal.", subtitle: "Ini video uji internal.", cta: "", disclaimer: "",
      format: "9:16", durationSeconds: 10, sourceIds: [], factIds: [], noFactualClaims: true, publicMode: true, materialConsent: false };
    let concept = await call("/creative/concepts", "POST", input); conceptId = concept.id;
    assert.equal(concept.materialConsent, true, "Owner policy must apply without a checkbox declaration");
    concept = await call(`/creative/concepts/${conceptId}`, "PUT", { ...input, version: concept.version });
    assert.equal(concept.materialConsent, true);
    const image = await sharp({ create: { width: 200, height: 150, channels: 3, background: "#ff0000" } }).png().toBuffer();
    async function upload(name: string) {
      const t = await call(`/creative/concepts/${conceptId}/uploads`, "POST", { version: concept.version, name, size: image.length, contentType: "image/png" });
      assert((await fetch(t.uploadURL, { method: "PUT", body: new Uint8Array(image), headers: { "Content-Type": "image/png" } })).ok);
      concept = await call(`/creative/concepts/${conceptId}/uploads/${t.uploadId}`, "POST", { version: concept.version });
      assert.equal(concept.materialConsent, true, "Finalization must not reset studio permission");
      return t.uploadId;
    }
    const oldLogoId = await upload("synthetic-old-logo.png");
    const removedId = await upload("synthetic-remove.png");
    concept = await call(`/creative/concepts/${conceptId}/uploads/${removedId}`, "DELETE", { version: concept.version });
    assert.equal(concept.materialConsent, true, "Removal must not reset permission on remaining materials");
    const legacyId = randomUUID();
    await db.insert(videoJobs).values({ id: legacyId, ownerId: owner, conceptId, conceptVersion: concept.version,
      characterId: character.id, title: label, requestKey: randomUUID(), requestHash: "synthetic-fixture-only",
      options: { motion: "ZOOM_IN", logoPosition: "TOP_RIGHT", logoAttachmentId: oldLogoId, cues: [{ start: 0, end: 10 }] },
      durationSeconds: 10, quotaDay: "1900-01-01", simulation: true, deleted: true, status: "COMPLETED" });
    const request = { conceptId, version: concept.version, mode: "HEMAT", confirmed: true, requestKey: randomUUID(),
      options: { motion: "ZOOM_IN", logoPosition: "TOP_RIGHT", brandingMode: "NONE", postTextMode: "MANUAL_AFTER_DOWNLOAD",
        legacyLogoAttachmentIds: ["forged-caller-id"], cues: [{ start: 0, end: 10 }] } };
    const job = await call("/video/jobs", "POST", request);
    assert.equal(job.options.brandingMode, "NONE");
    assert.deepEqual(job.options.legacyLogoAttachmentIds, [oldLogoId]);
    assert.equal(job.options.logoAttachmentId, undefined);
    let finished = job;
    for (let i = 0; i < 60 && !["COMPLETED", "FAILED", "CANCELLED", "UNKNOWN"].includes(finished.status); i++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const rows = await call("/video/jobs"); finished = rows.find((row: { id: string }) => row.id === job.id);
    }
    assert.equal(finished.status, "COMPLETED", "The live worker must finish a real unbranded MP4");
    const download = await fetch(`http://localhost:80${finished.resultUrl}`, { headers: { Cookie: cookie } });
    assert.equal(download.status, 200);
    assert.equal(download.headers.get("content-type"), "video/mp4");
    assert((await download.arrayBuffer()).byteLength > 100);
    assert.equal((await call("/video/jobs", "POST", request)).id, job.id);
    assert.equal((await call("/video/config")).dailyUsed, 1);
    const [saved] = await db.select().from(videoJobs).where(eq(videoJobs.id, job.id));
    assert.deepEqual((saved!.options as { legacyLogoAttachmentIds: string[] }).legacyLogoAttachmentIds, [oldLogoId]);
    const evidence = await db.select().from(auditLog).where(and(eq(auditLog.userId, owner), eq(auditLog.action, "STUDIO_MATERIAL_ADDED")));
    assert.equal(evidence.length, 2);
    assert(evidence.every(e => (e.after as { materialConsentBasis: string }).materialConsentBasis === "STUDIO_OWNER_POLICY"));
    console.log(JSON.stringify({ result: "PASS", checks: ["studio save/update without checkbox", "signed upload/finalize", "permission retained after material removal",
      "legacy logo excluded without deleting it", "forged exclusion discarded", "real worker MP4 without logo", "private download", "idempotent request", "daily quota", "honest permission evidence"] }));
  } finally {
    if (owner) {
      const [member] = await db.select().from(members).where(eq(members.id, owner));
      assert.equal(member?.name, label); assert.equal(member.email, "folder@studio.invalid");
      const cs = await db.select().from(characters).where(eq(characters.userId, owner));
      const ups = await db.select().from(characterUploads).where(eq(characterUploads.userId, owner));
      const ats = await db.select().from(conceptAttachments).where(eq(conceptAttachments.ownerId, owner));
      const jobs = await db.select().from(videoJobs).where(eq(videoJobs.ownerId, owner));
      assert(!jobs.some(j => ["QUEUED", "PROCESSING", "SUBMITTED"].includes(j.status)), "Do not clean an active fixture; preserve for diagnosis");
      const paths = [...cs.map(c => c.objectPath), ...ups.map(u => u.objectPath), ...ats.flatMap(a => [a.stagingPath, a.finalPath]),
        ...jobs.flatMap(j => [j.resultPath, j.rawResultPath, `/objects/videos/${j.id}-final.mp4`])].filter((p): p is string => !!p);
      const storage = new ObjectStorageService();
      await Promise.all([...new Set(paths)].map(path => {
        assert(/^\/objects\/(characters|uploads|concepts|videos)\/[a-zA-Z0-9._-]+$/.test(path));
        const [bucket, ...parts] = `${storage.getPrivateObjectDir()}/${path.slice(9)}`.replace(/^\/+/, "").split("/");
        return objectStorageClient.bucket(bucket!).file(parts.join("/")).delete({ ignoreNotFound: true });
      }));
      await db.transaction(async tx => {
        const ids = jobs.map(j => j.id);
        if (ids.length) {
          await tx.delete(studioSelfChecks).where(inArray(studioSelfChecks.jobId, ids));
          await tx.delete(finalReviews).where(inArray(finalReviews.jobId, ids));
        }
        await tx.delete(videoJobs).where(eq(videoJobs.ownerId, owner));
        await tx.delete(conceptAttachments).where(eq(conceptAttachments.ownerId, owner));
        if (conceptId) await tx.delete(creativeReviews).where(eq(creativeReviews.conceptId, conceptId));
        await tx.delete(conceptVersions).where(eq(conceptVersions.ownerId, owner));
        await tx.delete(creativeConcepts).where(eq(creativeConcepts.ownerId, owner));
        await tx.delete(characterUploads).where(eq(characterUploads.userId, owner));
        await tx.delete(characters).where(eq(characters.userId, owner));
        await tx.delete(auditLog).where(eq(auditLog.userId, owner));
        await tx.delete(studioFolders).where(eq(studioFolders.id, folder));
        await tx.delete(members).where(eq(members.id, owner));
      });
      const remaining = await db.execute(sql`select count(*)::int n from solid_members where id=${owner}`);
      assert.equal(remaining.rows[0]!.n, 0);
      console.log("Synthetic fixture and private objects removed; other members/assets untouched.");
    }
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Verification failed"); process.exitCode = 1; }).finally(() => pool.end());
