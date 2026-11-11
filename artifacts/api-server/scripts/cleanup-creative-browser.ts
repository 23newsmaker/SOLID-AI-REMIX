// Remove only the two disposable identities recorded by the browser test.
// Never force an unexpired signed-PUT tombstone out of the cleanup queue.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { clerkClient } from "@clerk/express";
import { eq, inArray } from "drizzle-orm";
import { db, pool, members, auditLog, characterUploads, characters, conceptAttachments, creativeConcepts } from "@workspace/db";
import { cleanupCreativeObjects } from "../src/lib/creative-storage";

const directory = fileURLToPath(new URL("../../../generated-artifacts/phase-b-validation/", import.meta.url));
const report = JSON.parse(await readFile(`${directory}report.json`, "utf8"));
const accounts = [report.creator, report.reviewer] as { id: string; email: string }[];
const cleanup: { memberRemoved: boolean; clerkRemoved: boolean; pendingPrivateObjects: number }[] = [];
try {
  await cleanupCreativeObjects();
  for (const account of accounts) {
    if (!/^user_[a-zA-Z0-9]+$/.test(account.id) || !/^phaseb-[a-zA-Z0-9_-]+@example\.com$/.test(account.email)) {
      throw new Error("Refusing cleanup: identity does not match disposable browser fixtures.");
    }
    const [member] = await db.select().from(members).where(eq(members.id, account.id));
    if (member && member.email.toLowerCase() !== account.email.toLowerCase()) throw new Error("Refusing mismatched test membership.");
    const [concept] = await db.select({ id: creativeConcepts.id }).from(creativeConcepts).where(eq(creativeConcepts.ownerId, account.id)).limit(1);
    const [character] = await db.select({ id: characters.id }).from(characters).where(eq(characters.userId, account.id)).limit(1);
    if (concept || character) throw new Error("Delete test concept/character through owner APIs first.");
    const pending = await db.select({ id: conceptAttachments.id }).from(conceptAttachments).where(eq(conceptAttachments.ownerId, account.id));
    let clerkRemoved = false;
    try {
      const user = await clerkClient.users.getUser(account.id);
      if (!user.emailAddresses.some(e => e.emailAddress.toLowerCase() === account.email.toLowerCase())) throw new Error("Refusing mismatched Clerk fixture.");
      await clerkClient.users.deleteUser(account.id);
      clerkRemoved = true;
    } catch (error) {
      if (typeof error === "object" && error && "status" in error && error.status === 404) clerkRemoved = true;
      else throw error;
    }
    await db.delete(auditLog).where(eq(auditLog.userId, account.id));
    await db.delete(characterUploads).where(eq(characterUploads.userId, account.id));
    if (!pending.length) await db.delete(members).where(eq(members.id, account.id));
    else if (member) await db.update(members).set({ status: "SUSPENDED" }).where(eq(members.id, account.id));
    cleanup.push({ memberRemoved: pending.length === 0, clerkRemoved, pendingPrivateObjects: pending.length });
  }
  const remaining = await db.select({ id: members.id }).from(members).where(inArray(members.id, accounts.map(a => a.id)));
  const result = { at: new Date().toISOString(), accounts: cleanup, remainingTestMembers: remaining.length };
  await writeFile(`${directory}browser-cleanup.json`, JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result) + "\n");
  if (remaining.length) process.exitCode = 1;
} finally { await pool.end(); }
