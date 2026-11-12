import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { db, pool, members, adminGrants } from "@workspace/db";

// Read-only diagnostic. Does not change credentials, create accounts or grant roles.
assert.notEqual(process.env.NODE_ENV, "production", "Workspace diagnostic only");
try {
  const owners = await db.select({ member: members, grant: adminGrants }).from(adminGrants)
    .innerJoin(members, eq(members.id, adminGrants.consumedBy));
  const rows = [];
  for (const { member, grant } of owners) {
    const user = await clerkClient.users.getUser(member.id);
    const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId);
    rows.push({
      role: member.role, status: member.status,
      primaryEmailVerified: primary?.verification?.status === "verified",
      verifiedEmailMatchesOwnerGrant: primary?.emailAddress.toLowerCase() === grant.email.toLowerCase(),
      passwordEnabled: user.passwordEnabled,
    });
  }
  const report = { environment: "development", accountsCreated: 0, passwordsChanged: 0, owners: rows };
  await mkdir("../../generated-artifacts/owner-access", { recursive: true });
  await writeFile("../../generated-artifacts/owner-access/workspace-owner.json", JSON.stringify(report, null, 2));
  console.info(JSON.stringify(report));
} finally { await pool.end(); }
