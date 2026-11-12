import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { studioKey, encodeStudioSession, decodeStudioSession, studioPasswordMatches } from "./studio-access";
import { creatorForFolder, equalStudioBinding } from "./studio-policy";
import { CLEANUP_PENDING, previousVideoError, videoResultPaths, cleanVideoObjects } from "./video/result-cleanup";
import type { MemberRecord } from "@workspace/db";

const now = 1_800_000_000_000;
const key = studioKey("synthetic-password-for-unit-tests", "synthetic-signing-key");
test("signed studio session validates and expires after twelve hours", () => {
  const token = encodeStudioSession(key, now);
  assert.ok(decodeStudioSession(token, key, now));
  assert.equal(decodeStudioSession(token, key, now + 12 * 60 * 60_000), null);
});
test("password rotation and key rotation revoke existing studio sessions", () => {
  const token = encodeStudioSession(key, now);
  assert.equal(decodeStudioSession(token, studioKey("changed", "synthetic-signing-key"), now), null);
  assert.equal(decodeStudioSession(token, studioKey("synthetic-password-for-unit-tests", "changed"), now), null);
});
test("tampered payload, signature, malformed and oversized cookies are rejected", () => {
  const token = encodeStudioSession(key, now);
  for (const bad of ["", "invalid", `${token}.extra`, `${token.slice(0, -2)}XX`, "x".repeat(1025)]) {
    assert.equal(decodeStudioSession(bad, key, now), null);
  }
  const payload = Buffer.from(JSON.stringify({ id: "a".repeat(48), expiresAt: now + 24 * 60 * 60_000 })).toString("base64url");
  const signedFuture = `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
  assert.equal(decodeStudioSession(signedFuture, key, now), null);
});
test("password comparison rejects incorrect, empty and oversized inputs", () => {
  assert.equal(studioPasswordMatches("test-password", "test-password"), true);
  assert.equal(studioPasswordMatches("bad", "test-password"), false);
  assert.equal(studioPasswordMatches("", ""), false);
  assert.equal(studioPasswordMatches("a".repeat(257), "a".repeat(257)), false);
});
test("selecting any folder, including a super admin's, grants creator access only", () => {
  for (const role of ["SUPER_ADMIN", "ADMIN", "REVIEWER_COMPLIANCE", "CREATOR", "VIEWER"] as const) {
    const source: MemberRecord = { id: "fixture-owner", name: "Original", email: "fixture@invalid.test", role, status: "ACTIVE", createdAt: new Date(now) };
    const actor = creatorForFolder(source, { memberId: source.id, name: "Folder" });
    assert.equal(actor.role, "CREATOR");
    assert.equal(source.role, role);
    assert.equal(actor.email, "folder@studio.invalid");
    assert.throws(() => creatorForFolder(source, { memberId: "another", name: "Other" }));
    assert.throws(() => creatorForFolder({ ...source, status: "SUSPENDED" }, { memberId: source.id, name: "Folder" }));
  }
});
test("self-check bindings survive PostgreSQL JSON key reordering but reject any changed evidence", () => {
  const binding = { digest: "d", resultHash: "h", md5: "m", generation: "g" };
  assert.equal(equalStudioBinding(binding, { generation: "g", md5: "m", digest: "d", resultHash: "h" }), true);
  for (const field of Object.keys(binding)) assert.equal(equalStudioBinding(binding, { ...binding, [field]: "changed" }), false);
  assert.equal(equalStudioBinding({}, {}), false);
  assert.equal(equalStudioBinding(null, binding), false);
});
test("manual deletion targets only unique video paths, not character or supporting assets", () => {
  const paths = videoResultPaths({ id: "fixture", resultPath: "/objects/videos/fixture-final.mp4", rawResultPath: "/objects/videos/fixture-raw.mp4" });
  assert.deepEqual(paths, ["/objects/videos/fixture-final.mp4", "/objects/videos/fixture-raw.mp4"]);
  assert.equal(paths.some(path => path.includes("/characters/") || path.includes("/materials/")), false);
  assert.deepEqual(videoResultPaths({ id: "fixture", resultPath: null, rawResultPath: null }), ["/objects/videos/fixture-final.mp4"]);
});
test("cleanup attempts every file even after one failure and succeeds on retry", async () => {
  const job = { id: "fixture", resultPath: "/objects/videos/fixture-final.mp4", rawResultPath: "/objects/videos/fixture-raw.mp4" };
  const attempted: string[] = [];
  assert.equal(await cleanVideoObjects(job, async path => { attempted.push(path); if (path.includes("-raw")) throw new Error("Synthetic transient failure"); }), false);
  assert.equal(attempted.length, 2);
  assert.equal(await cleanVideoObjects(job, async () => undefined), true);
});
test("cleanup retry preserves the original job error and does not accumulate markers", () => {
  assert.equal(previousVideoError(`Original error\n${CLEANUP_PENDING} temporary`), "Original error");
  assert.equal(previousVideoError(`${CLEANUP_PENDING} temporary`), null);
  assert.equal(previousVideoError(null), null);
});
