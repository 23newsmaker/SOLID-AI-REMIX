import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { eq, inArray } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import {
  db, pool, members, characters, creativeCategories, creativeConcepts,
  creativeReviews, conceptAttachments, conceptVersions, videoJobs, finalReviews,
  auditLog, sessionAudits,
} from "@workspace/db";
import { parseConcept, buildCreative } from "../src/lib/creative-builder";
import { captureVersion } from "../src/lib/operations/versions";
import { creativeFile } from "../src/lib/creative-storage";
import { videoFile } from "../src/lib/video/storage";
import { quotaDay } from "../src/lib/video/policy";

const folder = path.resolve("../../generated-artifacts/phase-d");
const manifestPath = path.join(folder, "e2e-fixtures.json");
async function cleanup() {
  const fixture = JSON.parse(await readFile(manifestPath, "utf8"));
  const ids = [fixture.owner.id, fixture.reviewer.id] as string[];
  const rows = await db.select().from(members).where(inArray(members.id, ids));
  const owner = rows.find(x => x.id === fixture.owner.id), reviewer = rows.find(x => x.id === fixture.reviewer.id);
  if (rows.length !== 2 || owner?.email.toLowerCase() !== fixture.owner.email.toLowerCase() ||
      reviewer?.email.toLowerCase() !== fixture.reviewer.email.toLowerCase() ||
      !owner.name.startsWith("D-E2E Creator ") || !reviewer.name.startsWith("D-E2E SuperAdmin ")) {
    throw new Error("Cleanup stopped: exact synthetic identities no longer match manifest");
  }
  for (const p of fixture.creativeObjectPaths as string[]) await creativeFile(p).delete({ ignoreNotFound: true });
  await videoFile(fixture.jobObjectPath).delete({ ignoreNotFound: true });
  await db.transaction(async tx => {
    await tx.delete(finalReviews).where(eq(finalReviews.jobId, fixture.jobId));
    await tx.delete(videoJobs).where(eq(videoJobs.id, fixture.jobId));
    await tx.delete(conceptVersions).where(eq(conceptVersions.conceptId, fixture.conceptId));
    await tx.delete(creativeReviews).where(eq(creativeReviews.conceptId, fixture.conceptId));
    await tx.delete(conceptAttachments).where(eq(conceptAttachments.id, fixture.logoId));
    await tx.delete(creativeConcepts).where(eq(creativeConcepts.id, fixture.conceptId));
    await tx.delete(characters).where(eq(characters.id, fixture.characterId));
    await tx.delete(creativeCategories).where(eq(creativeCategories.id, fixture.categoryId));
    await tx.delete(sessionAudits).where(inArray(sessionAudits.userId, ids));
    await tx.delete(auditLog).where(inArray(auditLog.userId, ids));
    await tx.delete(members).where(inArray(members.id, ids));
  });
  await clerkClient.users.deleteUser(fixture.owner.id);
  await clerkClient.users.deleteUser(fixture.reviewer.id);
  await writeFile(manifestPath, JSON.stringify({ ...fixture, cleanedAt: new Date().toISOString(),
    cleanup: "exact synthetic object paths, records, member rows, and Clerk users deleted" }, null, 2));
  console.log(`Cleaned only manifest identities ${ids.join(", ")}`);
}
async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Development fixture only");
  if (process.argv[2] === "cleanup") { await cleanup(); return; }
  const [ownerId, reviewerId, ownerEmail, reviewerEmail] = process.argv.slice(2);
  if (!ownerId || !reviewerId || !ownerEmail || !reviewerEmail || ownerId === reviewerId) throw new Error("Exact owner/reviewer IDs and emails required");
  const verified = await db.select().from(members).where(inArray(members.id, [ownerId, reviewerId]));
  const owner = verified.find(x => x.id === ownerId), reviewer = verified.find(x => x.id === reviewerId);
  if (verified.length !== 2 || owner?.email.toLowerCase() !== ownerEmail.toLowerCase() ||
      reviewer?.email.toLowerCase() !== reviewerEmail.toLowerCase() ||
      !owner.name.startsWith("D-E2E Creator ") || !reviewer.name.startsWith("D-E2E SuperAdmin ") ||
      owner.status !== "ACTIVE" || owner.role !== "CREATOR" || reviewer.status !== "ACTIVE" || reviewer.role !== "SUPER_ADMIN") {
    throw new Error("Fixture identities do not match the two explicitly verified synthetic accounts");
  }
  if (await db.select().from(characters).where(eq(characters.userId, ownerId)).then(x => x.length)) throw new Error("Owner already has a character; refusing overwrite");
  const [settings] = await db.select().from((await import("@workspace/db")).videoSettings);
  void settings; // Read-only settings observation; never update global settings.

  const characterId = randomUUID(), conceptId = randomUUID(), categoryId = randomUUID(), logoId = randomUUID(), jobId = randomUUID();
  const charPath = `/objects/concepts/${randomUUID()}.png`, logoPath = `/objects/concepts/${randomUUID()}.png`;
  const jobPath = `/objects/videos/${jobId}-final.mp4`;
  const svgChar = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="1280"><rect width="720" height="1280" fill="#e8ddc8"/><circle cx="360" cy="430" r="170" fill="#54746c"/><rect x="220" y="630" width="280" height="360" rx="80" fill="#b8c7a5"/><text x="360" y="1120" text-anchor="middle" font-size="34" fill="#333">FIKSI TEKNIS</text></svg>');
  const svgLogo = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120"><rect width="240" height="120" rx="18" fill="#344b45"/><circle cx="52" cy="60" r="28" fill="#d3c08b"/><text x="152" y="69" text-anchor="middle" font-size="24" fill="#fff">DEMO</text></svg>');
  const charBytes = await sharp(svgChar).png().toBuffer(), logoBytes = await sharp(svgLogo).png().toBuffer();
  const mp4 = await readFile(path.resolve("../../generated-artifacts/phase-d/demo-review-hemat.mp4"));
  const resultHash = createHash("sha256").update(mp4).digest("hex");
  const category = { id: categoryId, name: `D-E2E technical fixture ${categoryId}`, active: true };
  const data = parseConcept({
    title: "D-E2E fictional technical review fixture", characterId, categoryId, segments: ["NONE"],
    style: "UGC", mode: "HEMAT", templateId: null, purpose: "Internal technical gate verification",
    direction: "", scenes: "Abstract geometric, fictional visual only", characterMotion: "",
    cameraMotion: "zoom", visual: "Neutral synthetic illustration; no person or company claims",
    narration: "Ini video teknis fiktif tanpa klaim perusahaan.",
    subtitle: "Ini video teknis fiktif tanpa klaim perusahaan.", cta: "DEMO TEKNIS",
    disclaimer: "FIKSI TEKNIS — BUKAN PUBLIKASI PERUSAHAAN.", format: "9:16", durationSeconds: 10,
    sourceIds: [], factIds: [], noFactualClaims: true, publicMode: true, materialConsent: true,
  });
  const paths = [charPath, logoPath];
  try {
    await creativeFile(charPath).save(charBytes, { contentType: "image/png", resumable: false });
    await creativeFile(logoPath).save(logoBytes, { contentType: "image/png", resumable: false });
    await videoFile(jobPath).save(mp4, { contentType: "video/mp4", resumable: false });
    await db.insert(creativeCategories).values(category);
    await db.insert(characters).values({ id: characterId, userId: ownerId, name: "D-E2E synthetic geometric character", objectPath: charPath, consentAt: new Date() });
    const built = await buildCreative(data, owner!);
    if (built.blockers.length || built.snapshot.policyVersion !== 2) throw new Error(`Concept validation failed: ${built.blockers.join("; ")}`);
    await db.insert(creativeConcepts).values({ id: conceptId, ownerId, version: 3, status: "APPROVED", data,
      snapshot: built.snapshot, prompt: built.prompt, warnings: built.warnings, blockers: [], submittedAt: new Date() });
    await db.insert(creativeReviews).values({ id: randomUUID(), conceptId, actorId: reviewerId, action: "APPROVED",
      note: "SIMULATED initial concept approval for D-E2E technical fixture only; not company approval.", version: 3 });
    await db.insert(conceptAttachments).values({ id: logoId, conceptId, ownerId, name: "fictional-demo-logo.png",
      contentType: "image/png", size: logoBytes.length, stagingPath: "", finalPath: logoPath,
      state: "READY", expiresAt: new Date("9999-01-01T00:00:00Z") });
    const [concept] = await db.select().from(creativeConcepts).where(eq(creativeConcepts.id, conceptId));
    await db.transaction(async tx => { await captureVersion(concept!, tx); });
    const options = { motion: "ZOOM_IN", logoPosition: "TOP_RIGHT", logoAttachmentId: logoId, cues: [{ start: 0, end: 10 }] };
    const job = {
      id: jobId, ownerId, conceptId, conceptVersion: 3, characterId,
      requestKey: randomUUID(), requestHash: createHash("sha256").update(`${jobId}:${ownerId}:fixture-v1`).digest("hex"),
      title: data.title, mode: "HEMAT", provider: "local-compositor", status: "COMPLETED",
      quotaDay: quotaDay(), simulation: false, options, durationSeconds: 10,
      resultPath: jobPath, resultHash, resultBytes: mp4.length, model: "ffmpeg-local",
      costSource: "LOCAL_NO_PAID_API", costDetails: { renderUsd: null, ttsUsd: 0, retryUsd: 0 },
      estimatedCostUsd: null, actualCostUsd: null, providerCostUsd: 0, reservedCostUsd: 0,
      publicationStatus: "GENERATED", publicationVersion: 0, deleted: false,
    };
    await db.insert(videoJobs).values(job);
    await mkdir(folder, { recursive: true });
    const manifest = { owner: { id: ownerId, email: ownerEmail }, reviewer: { id: reviewerId, email: reviewerEmail },
      characterId, conceptId, categoryId, logoId, jobId, creativeObjectPaths: paths, jobObjectPath: jobPath,
      resultHash, resultBytes: mp4.length, fixtureKind: "synthetic technical fixture; initial concept approval simulated; not company approval" };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify(manifest));
  } catch (error) {
    // Leave manifest/records untouched on partial error; clean only the exact paths created by this invocation.
    for (const p of [...paths, jobPath]) {
      try { if (p.startsWith("/objects/videos/")) await videoFile(p).delete({ ignoreNotFound: true }); else await creativeFile(p).delete({ ignoreNotFound: true }); } catch {}
    }
    throw error;
  }
}
main().catch(e => { console.error(e instanceof Error ? e.message : "fixture failed"); process.exitCode = 1; }).finally(() => pool.end());
