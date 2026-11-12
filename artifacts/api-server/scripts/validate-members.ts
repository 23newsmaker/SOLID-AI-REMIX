import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool, members, characters, auditLog } from "@workspace/db";
import { teamRouter } from "../src/routes/team";
import { requireActive, requireTeamManager, requireCharacterEditor, hasRestrictedAccess } from "../src/middlewares/member";

const ids: string[] = [];
const checks: { test: string; status: string; method: string }[] = [];
function record(test: string) { checks.push({ test, status: "PASS", method: "Real handlers/middleware/DB with synthetic rows; not Clerk/browser login" }); }
async function main() {
  assert.notEqual(process.env.NODE_ENV, "production");
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(members).where(eq(members.status, "ACTIVE"));
  for (let i = 0; i < Math.max(3, 11 - n); i++) ids.push(`f-test-${randomUUID()}`);
  const rows = await db.insert(members).values(ids.map((id, i) => ({
    id, name: "F SYNTHETIC", email: `${randomUUID()}@example.com`,
    role: i === 0 ? "SUPER_ADMIN" : "CREATOR",
    status: i === ids.length - 1 ? "PENDING" : "ACTIVE",
  }))).returning();
  const manager = rows[0]!, pending = rows.at(-1)!;
  const layer = (teamRouter as any).stack.find((l: any) => l.route?.path === "/team/:id");
  const handler = layer.route.stack.at(-1).handle;
  async function patch(actor: typeof manager, id: string, body: unknown) {
    let code = 200;
    const res = { status(n: number) { code = n; return this; }, json() {} };
    await handler({ member: actor, params: { id }, body }, res);
    return code;
  }
  assert.equal(await patch(manager, pending.id, { status: "ACTIVE", role: "CREATOR" }), 200);
  assert.equal((await db.select().from(members).where(eq(members.id, pending.id)))[0]!.status, "ACTIVE");
  const [{ active }] = await db.select({ active: sql<number>`count(*)::int` }).from(members).where(eq(members.status, "ACTIVE"));
  assert(active > 10);
  record("Eleventh or later member activates; no application member cap");
  assert.equal(await patch(manager, manager.id, { status: "SUSPENDED", role: "VIEWER" }), 400);
  record("Admin cannot change own access");
  assert.equal(await patch({ ...manager, role: "ADMIN" }, pending.id, { status: "ACTIVE", role: "SUPER_ADMIN" }), 403);
  record("Ordinary admin cannot grant elevated role");
  for (const role of ["SUPER_ADMIN", "ADMIN", "CREATOR", "REVIEWER_COMPLIANCE", "VIEWER"]) {
    const actor = { ...manager, role };
    for (const [middleware, allowed, name] of [
      [requireTeamManager, ["SUPER_ADMIN", "ADMIN"].includes(role), "team"],
      [requireCharacterEditor, role !== "VIEWER", "character write"],
      [requireActive, true, "active membership"],
    ] as const) {
      let next = false, code = 200;
      const res = { status(n: number) { code = n; return this; }, json() {} };
      middleware({ member: actor } as any, res as any, () => { next = true; });
      assert.equal(next, allowed);
      assert.equal(code, allowed ? 200 : 403);
      record(`${role}: ${name} policy`);
    }
    assert.equal(hasRestrictedAccess({ member: actor } as any), ["SUPER_ADMIN", "ADMIN", "REVIEWER_COMPLIANCE"].includes(role));
    record(`${role}: restricted knowledge policy`);
  }
  let denied = false;
  requireActive({ member: { ...pending, status: "PENDING" } } as any,
    { status(n: number) { denied = n === 403; return this; }, json() {} } as any, () => assert.fail());
  assert(denied); record("Pending member has no internal access");
  const values = { userId: manager.id, name: "F SYNTHETIC", objectPath: "/objects/characters/nonexistent-fixture.jpg", consentAt: new Date() };
  await db.insert(characters).values({ ...values, id: randomUUID() });
  await assert.rejects(db.insert(characters).values({ ...values, id: randomUUID() }));
  record("Database enforces one character per user");
}
await main().catch(error => { checks.push({ test: error.message, status: "FAIL", method: "Assertion" }); process.exitCode = 1; });
await db.delete(characters).where(inArray(characters.userId, ids));
await db.delete(auditLog).where(inArray(auditLog.userId, ids));
await db.delete(members).where(inArray(members.id, ids));
await mkdir("../../generated-artifacts/phase-f", { recursive: true });
await writeFile("../../generated-artifacts/phase-f/member-tests.json", JSON.stringify({ checks, fixtureCleanup: true }, null, 2));
console.info(JSON.stringify({ memberChecks: checks.length, fail: checks.filter(c => c.status === "FAIL"), fixtureCleanup: true }));
await pool.end();
