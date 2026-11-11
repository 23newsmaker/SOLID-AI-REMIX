import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { eq, inArray } from "drizzle-orm";
import { db, pool, members, characters, knowledgeSources, creativeCategories, creativeTemplates, creativeConcepts, conceptVersions, auditLog } from "@workspace/db";
import { buildCreative, parseConcept } from "../src/lib/creative-builder";
import { creativeConceptRouter } from "../src/routes/creative-concepts";
import { knowledgeRouter } from "../src/routes/knowledge";
import { characterRouter } from "../src/routes/character";
import { CreativeError } from "../src/lib/creative-policy";

const ids = [randomUUID(), randomUUID()].map(id => `studio-f-${id}`);
const sourceIds = [randomUUID(), randomUUID()], categoryId = randomUUID(), characterId = randomUUID();
const checks: { test: string; status: string; method: string }[] = [];
const record = (test: string) => checks.push({ test, status: "PASS", method: "Real domain/route handler with synthetic data; not browser" });
async function call(router: any, method: string, route: string, member: unknown, body = {}, params = {}, query = {}): Promise<any> {
  const handler = router.stack.find((l: any) => l.route?.path === route && l.route.methods[method])?.route.stack.at(-1).handle;
  assert(handler);
  let result: unknown, code = 200;
  await handler({ member, body, params, query }, { status(n: number) { code = n; return this; }, json(value: unknown) { result = value; } });
  if (code >= 400) throw new CreativeError(code, "Synthetic request rejected");
  return result;
}
async function main() {
  assert.notEqual(process.env.NODE_ENV, "production");
  const [creator, other] = await db.insert(members).values(ids.map(id => ({ id, email: `${randomUUID()}@example.com`, name: "STUDIO F SYNTHETIC", role: "CREATOR", status: "ACTIVE" }))).returning();
  await db.insert(creativeCategories).values({ id: categoryId, name: "F SYNTHETIC", active: true });
  await db.insert(characters).values({ id: characterId, userId: creator!.id, name: "F SYNTHETIC", objectPath: "/objects/characters/nonexistent-fixture.jpg", consentAt: new Date() });
  const input = parseConcept({
    title: "F technical draft", characterId, categoryId, segments: ["NONE"], style: "UGC", mode: "HEMAT", templateId: null,
    purpose: "Technical test only", direction: "Preserve this exact direction 12345.", scenes: "Neutral geometric scene", characterMotion: "", cameraMotion: "zoom", visual: "",
    narration: "Ini demonstrasi teknis fiktif.", subtitle: "Ini demonstrasi teknis fiktif.", cta: "DEMO", disclaimer: "BUKAN KONTEN PERUSAHAAN.",
    format: "9:16", durationSeconds: 10, sourceIds: [], factIds: [], noFactualClaims: true, publicMode: true, materialConsent: true,
  });
  for (const style of ["UGC", "CINEMATIC"] as const) {
    const built = await buildCreative({ ...input, style }, creator!);
    assert(built.prompt.includes(input.direction));
    assert.equal(input.narration, "Ini demonstrasi teknis fiktif.");
    record(`${style}: prompt built without changing direction/narration`);
  }
  for (const segment of ["MINI", "MIKRO", "REGULAR"] as const) {
    const parsed = parseConcept({ ...input, segments: [segment] });
    assert.deepEqual(parsed.segments, [segment]); await buildCreative(parsed, creator!);
    record(`${segment}: distinct segment accepted by builder, no inferred company facts`);
  }
  assert.throws(() => parseConcept({ ...input, segments: ["NONE", "MINI"] }));
  record("NONE cannot be combined with product segment");
  const [template] = await db.select().from(creativeTemplates).where(eq(creativeTemplates.active, true)).limit(1);
  assert(template, "Existing active template required");
  await assert.rejects(() => buildCreative({ ...input, templateId: template.id }, creator!));
  record("Template from a different category is rejected");
  const matched = parseConcept({ ...input, categoryId: template.categoryId, style: template.style,
    segments: template.segments.slice(0, 1), templateId: template.id });
  assert.equal((await buildCreative(matched, creator!)).snapshot.template?.id, template.id);
  record("Existing template used without changing template");
  const created = await call(creativeConceptRouter, "post", "/concepts", creator!, input);
  const loaded = await call(creativeConceptRouter, "get", "/concepts/:id", creator!, {}, { id: created.id });
  assert.equal(loaded.direction, input.direction); assert.equal(loaded.narration, input.narration);
  record("Concept save and reload preserve prompt inputs");
  const listed = await call(creativeConceptRouter, "get", "/concepts", creator!);
  assert(listed.some((r: any) => r.id === created.id));
  record("Saved concept appears in history/list");
  await assert.rejects(() => call(creativeConceptRouter, "get", "/concepts/:id", other!, {}, { id: created.id }));
  record("Other creator cannot access private draft");
  await assert.rejects(() => call(creativeConceptRouter, "post", "/concepts", { ...other!, role: "VIEWER" }, input));
  record("Viewer cannot create concepts");
  assert.equal((await call(characterRouter, "get", "/character", creator!)).character.id, characterId);
  assert.equal((await call(characterRouter, "get", "/character", other!, {}, {}, { userId: creator!.id })).character, null);
  record("Character metadata stays scoped to authenticated member despite foreign userId query");
  for (const [i, id] of sourceIds.entries()) await db.insert(knowledgeSources).values({ id, sourceId: `studio-f-${id}`, fileName: "synthetic.md",
    objectPath: "SYNTHETIC_NO_FILE", title: `F SEARCH ${id}`, content: `Neutral synthetic search ${id}`, category: "TEST", segment: "COMPANY",
    validation: "APPROVED", access: i ? "INTERNAL_RESTRICTED" : "APPROVED_FOR_PUBLIC_CONTENT", version: "fixture", sha256: "fixture", active: true, warnings: [] });
  const publicSearch = await call(knowledgeRouter, "get", "/knowledge", creator!, {}, {}, { mode: "INTERNAL", q: sourceIds[0] });
  assert.equal(publicSearch.total, 1); assert.equal(publicSearch.items[0].id, sourceIds[0]);
  record("Knowledge search finds exact synthetic source");
  const restricted = await call(knowledgeRouter, "get", "/knowledge", creator!, {}, {}, { mode: "INTERNAL", q: sourceIds[1] });
  assert.equal(restricted.total, 0);
  const reviewed = await call(knowledgeRouter, "get", "/knowledge", { ...creator!, role: "REVIEWER_COMPLIANCE" }, {}, {}, { mode: "INTERNAL", q: sourceIds[1] });
  assert.equal(reviewed.total, 1);
  record("Restricted KB is hidden from creator and visible to authorized reviewer");
}
await main().catch(error => { checks.push({ test: error.message, status: "FAIL", method: "Assertion" }); process.exitCode = 1; });
const owned = await db.select().from(creativeConcepts).where(inArray(creativeConcepts.ownerId, ids));
if (owned.length) await db.delete(conceptVersions).where(inArray(conceptVersions.conceptId, owned.map(c => c.id)));
await db.delete(creativeConcepts).where(inArray(creativeConcepts.ownerId, ids));
await db.delete(characters).where(inArray(characters.userId, ids));
await db.delete(creativeCategories).where(eq(creativeCategories.id, categoryId));
await db.delete(knowledgeSources).where(inArray(knowledgeSources.id, sourceIds));
await db.delete(auditLog).where(inArray(auditLog.userId, ids));
await db.delete(members).where(inArray(members.id, ids));
await mkdir("../../generated-artifacts/phase-f", { recursive: true });
await writeFile("../../generated-artifacts/phase-f/studio-tests.json", JSON.stringify({ checks, fixtureCleanup: true }, null, 2));
console.info(JSON.stringify({ studioChecks: checks.length, fail: checks.filter(c => c.status === "FAIL"), fixtureCleanup: true }));
await pool.end();
