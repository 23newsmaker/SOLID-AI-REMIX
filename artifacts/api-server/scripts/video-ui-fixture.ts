// Creates/cleans only explicitly identified synthetic Phase C browser fixtures.
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { eq, inArray } from "drizzle-orm";
import { db, pool, members, characters, creativeCategories, creativeConcepts, creativeReviews, conceptAttachments, videoJobs, auditLog } from "@workspace/db";
import { buildCreative, parseConcept } from "../src/lib/creative-builder";
import { creativeFile } from "../src/lib/creative-storage";
import { videoFile } from "../src/lib/video/storage";

const folder = path.resolve("../../generated-artifacts/phase-c");
const file = path.join(folder, "ui-fixture.json");
async function run() {
  if (process.env.NODE_ENV === "production") throw new Error("Development fixtures only");
  if (process.argv[2] === "cleanup") {
    const fixture = JSON.parse(await readFile(file, "utf8"));
    const ids = [fixture.ownerId, fixture.otherId] as string[];
    const rows = await db.select().from(members).where(inArray(members.id, ids));
    if (rows.some(r => !r.name.startsWith("Phase C") || !r.email.endsWith("@example.com"))) throw new Error("Unsafe fixture identity");
    const jobs = await db.select().from(videoJobs).where(inArray(videoJobs.ownerId, ids));
    for (const job of jobs) await videoFile(`/objects/videos/${job.id}-final.mp4`).delete({ ignoreNotFound: true });
    for (const p of fixture.paths) await creativeFile(p).delete({ ignoreNotFound: true });
    await db.delete(videoJobs).where(inArray(videoJobs.ownerId, ids));
    await db.delete(conceptAttachments).where(inArray(conceptAttachments.ownerId, ids));
    await db.delete(creativeConcepts).where(inArray(creativeConcepts.ownerId, ids));
    await db.delete(characters).where(inArray(characters.userId, ids));
    await db.delete(creativeCategories).where(eq(creativeCategories.id, fixture.categoryId));
    await db.delete(auditLog).where(inArray(auditLog.userId, ids));
    await db.delete(members).where(inArray(members.id, ids));
    process.stdout.write("Exact browser test data and private objects cleaned; Clerk identities handled separately.\n");
    return;
  }
  const ids = process.argv.slice(2, 4);
  if (ids.length !== 2 || ids.some(id => !/^user_[a-zA-Z0-9]+$/.test(id))) throw new Error("Two explicit Clerk test IDs required");
  const rows = await db.select().from(members).where(inArray(members.id, ids));
  if (rows.length !== 2 || rows.some(r => !r.name.startsWith("Phase C") || !r.email.endsWith("@example.com"))) throw new Error("Only Phase C fake test accounts allowed");
  const existing = await db.select().from(characters).where(inArray(characters.userId, ids));
  if (existing.length) throw new Error("Do not overwrite existing characters");
  const ownerId = ids[0]!, otherId = ids[1]!;
  const [owner] = await db.update(members).set({ status: "ACTIVE", role: "CREATOR" }).where(eq(members.id, ownerId)).returning();
  await db.update(members).set({ status: "ACTIVE", role: "REVIEWER_COMPLIANCE" }).where(eq(members.id, otherId));
  const characterId = randomUUID(), conceptId = randomUUID(), categoryId = randomUUID(), logoId = randomUUID();
  const paths = [0, 1].map(() => `/objects/concepts/${randomUUID()}`);
  const picture = await sharp(Buffer.from('<svg width="720" height="1280" xmlns="http://www.w3.org/2000/svg"><rect width="720" height="1280" fill="#e4bd60"/><circle cx="360" cy="450" r="180" fill="#4d2b5d"/><text x="360" y="130" text-anchor="middle" font-size="48">TEST UI</text></svg>')).png().toBuffer();
  const logo = await sharp(Buffer.from('<svg width="240" height="120" xmlns="http://www.w3.org/2000/svg"><rect width="240" height="120" fill="#35233f"/><text x="120" y="80" text-anchor="middle" font-size="45" fill="#ffda70">DEMO</text></svg>')).png().toBuffer();
  await creativeFile(paths[0]!).save(picture, { contentType: "image/png", resumable: false });
  await creativeFile(paths[1]!).save(logo, { contentType: "image/png", resumable: false });
  await db.insert(creativeCategories).values({ id: categoryId, name: "Phase C UI TEST", active: true });
  await db.insert(characters).values({ id: characterId, userId: ownerId, name: "KARAKTER SINTETIS TEST", objectPath: paths[0]!, consentAt: new Date() });
  const data = parseConcept({
    title: "PHASE C UI TEST — MP4 HEMAT", characterId, categoryId, segments: ["NONE"], style: "UGC", mode: "HEMAT", templateId: null,
    purpose: "Pengujian teknis", direction: "", scenes: "Bentuk sintetis", characterMotion: "", cameraMotion: "zoom", visual: "",
    narration: "Ini contoh video sintetis untuk pemeriksaan aplikasi internal.", subtitle: "Ini contoh video sintetis untuk pemeriksaan aplikasi internal.",
    cta: "CONTOH TEKNIS", disclaimer: "DEMO SINTETIS — BUKAN KONTEN PERUSAHAAN.", format: "9:16", durationSeconds: 10,
    sourceIds: [], publicMode: true, materialConsent: true,
  });
  const built = await buildCreative(data, owner!);
  await db.insert(creativeConcepts).values({ id: conceptId, ownerId, version: 3, status: "APPROVED", data, snapshot: built.snapshot, prompt: built.prompt,
    warnings: built.warnings, blockers: built.blockers, submittedAt: new Date() });
  await db.insert(creativeReviews).values({ id: randomUUID(), conceptId, actorId: otherId, action: "APPROVED", note: "Synthetic technical fixture only", version: 3 });
  await db.insert(conceptAttachments).values({ id: logoId, conceptId, ownerId, name: "DEMO-logo.png", contentType: "image/png", size: logo.length,
    stagingPath: "", finalPath: paths[1], state: "READY", expiresAt: new Date("9999-01-01") });
  await mkdir(folder, { recursive: true });
  await writeFile(file, JSON.stringify({ ownerId, otherId, characterId, conceptId, categoryId, logoId, paths }));
  process.stdout.write(JSON.stringify({ conceptId, logoId, ownerId, otherId }) + "\n");
}
run().catch(() => { process.stderr.write("Fixture operation failed; only exact test identities may be used.\n"); process.exitCode = 1; }).finally(() => pool.end());
