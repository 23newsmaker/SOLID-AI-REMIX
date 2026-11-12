import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, pool, members, adminGrants, auditLog, type MemberRecord } from "@workspace/db";
import { activatePendingOwner } from "../src/lib/bootstrapAdmin";
import { GetAppInfoResponse } from "@workspace/api-zod";
import { videoConfig } from "../src/lib/video/service";

const ids: string[] = [], emails: string[] = [];
const checks: { test: string; status: string }[] = [];
const pass = (test: string) => checks.push({ test, status: "PASS" });
async function fixture(status: MemberRecord["status"] = "PENDING", role: MemberRecord["role"] = "VIEWER") {
  const id = `owner-test-${randomUUID()}`, email = `${randomUUID()}@example.com`;
  ids.push(id); emails.push(email);
  const [member] = await db.insert(members).values({ id, email, name: "SYNTHETIC OWNER TEST", status, role }).returning();
  return member!;
}
async function grant(m: MemberRecord, consumedBy: string | null = null) {
  await db.insert(adminGrants).values({ email: m.email, consumedBy, consumedAt: consumedBy ? new Date() : null });
}
const identify = (m: MemberRecord) => async () => ({ email: m.email, verified: true });
async function main() {
  assert.notEqual(process.env.NODE_ENV, "production", "Development-only test");
  const ordinary = await fixture();
  assert.equal((await activatePendingOwner(ordinary, async () => { assert.fail("No grant must not call Clerk"); })).status, "PENDING");
  pass("Ordinary pending member cannot become owner and causes no identity API call");
  const candidate = await fixture(); await grant(candidate);
  assert.equal((await activatePendingOwner(candidate, async () => ({ email: candidate.email, verified: false }))).status, "PENDING");
  pass("Unverified primary email cannot claim owner access");
  assert.equal((await activatePendingOwner(candidate, async () => ({ email: ordinary.email, verified: true }))).status, "PENDING");
  pass("Different verified primary email cannot claim stored owner email");
  const [unconsumed] = await db.select().from(adminGrants).where(eq(adminGrants.email, candidate.email));
  assert.equal(unconsumed!.consumedBy, null);
  pass("Rejected owner claims do not consume the grant");
  const results = await Promise.all([
    activatePendingOwner(candidate, identify(candidate)),
    activatePendingOwner(candidate, identify(candidate)),
  ]);
  assert(results.every(m => m.role === "SUPER_ADMIN" && m.status === "ACTIVE"));
  const [used] = await db.select().from(adminGrants).where(eq(adminGrants.email, candidate.email));
  assert.equal(used!.consumedBy, candidate.id);
  const [events] = await db.select({ n: sql<number>`count(*)::int` }).from(auditLog)
    .where(and(eq(auditLog.userId, candidate.id), eq(auditLog.action, "ADMIN_ACTIVATED")));
  assert.equal(events!.n, 1);
  pass("Concurrent verified owner claims activate once and record exactly one audit event");
  assert.equal((await activatePendingOwner(results[0]!, async () => { assert.fail("Active owner must not call Clerk"); })).role, "SUPER_ADMIN");
  pass("Existing active owner is reused without a new identity or password");
  const [revoked] = await db.update(members).set({ role: "VIEWER", status: "PENDING" }).where(eq(members.id, candidate.id)).returning();
  assert.equal((await activatePendingOwner(revoked!, identify(revoked!))).status, "PENDING");
  pass("Consumed grant cannot restore deliberately revoked access on later requests");
  const suspended = await fixture("SUSPENDED"); await grant(suspended);
  assert.equal((await activatePendingOwner(suspended, identify(suspended))).status, "SUSPENDED");
  pass("Suspended owner candidate is not automatically restored");
  const decided = await fixture(); await grant(decided);
  await db.insert(auditLog).values({
    id: randomUUID(), userId: candidate.id, objectId: decided.id,
    action: "MEMBER_ACCESS_CHANGED", description: "Synthetic explicit admin decision",
  });
  assert.equal((await activatePendingOwner(decided, identify(decided))).status, "PENDING");
  pass("An explicit membership decision by another admin is respected");
  const taken = await fixture(); await grant(taken, candidate.id);
  assert.equal((await activatePendingOwner(taken, identify(taken))).status, "PENDING");
  pass("A grant consumed by another identity cannot be reused");
  const creator = await fixture("ACTIVE", "CREATOR"); await grant(creator);
  assert.equal((await activatePendingOwner(creator, identify(creator))).role, "CREATOR");
  pass("Existing non-pending role is not silently elevated");
  const config = await videoConfig(results[0]!);
  assert(config.dailyLimit >= 1 && config.dailyLimit <= 3);
  assert.equal(config.aiEnabled, false);
  pass("Video quota remains at most three per user and AI stays disabled");
  assert.equal(GetAppInfoResponse.parse({
    name: "SOLID AI REMIX", stage: "test", generationEnabled: true, llmEnabled: false,
    dailyLimit: 3, maxMembers: null,
  }).maxMembers, null);
  pass("Unlimited member count is represented explicitly as null in the API contract");
}

try { await main(); }
catch (error) { checks.push({ test: error instanceof Error ? error.message : String(error), status: "FAIL" }); process.exitCode = 1; }
finally {
  if (ids.length) {
    await db.delete(auditLog).where(inArray(auditLog.userId, ids));
    await db.delete(adminGrants).where(inArray(adminGrants.email, emails));
    await db.delete(members).where(inArray(members.id, ids));
  }
  await mkdir("../../generated-artifacts/owner-access", { recursive: true });
  await writeFile("../../generated-artifacts/owner-access/backend-tests.json", JSON.stringify({ checks, fixtureCleanup: true }, null, 2));
  console.info(JSON.stringify({ checks: checks.length, failures: checks.filter(c => c.status === "FAIL"), fixtureCleanup: true }));
  await pool.end();
}
