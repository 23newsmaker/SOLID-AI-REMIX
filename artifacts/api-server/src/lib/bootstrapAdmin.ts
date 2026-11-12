import { clerkClient } from "@clerk/express";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, adminGrants, members, auditLog, type MemberRecord } from "@workspace/db";

/**
 * Runs in each environment, resolving its own Clerk identity on first verified login.
 * Consumption is permanent: restarting never restores a revoked admin role.
 * No DDL, no shared passwords, no hard-coded identity and no "first user wins".
 */
export async function prepareAdminGrant() {
  const email = process.env.SOLID_BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  if (!email) return;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid configured admin email");
  await db.insert(adminGrants).values({ email }).onConflictDoNothing();
}

type OwnerIdentity = { email: string; verified: boolean };
async function loadOwnerIdentity(id: string): Promise<OwnerIdentity> {
  const user = await clerkClient.users.getUser(id);
  const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId);
  return { email: primary?.emailAddress.trim().toLowerCase() ?? "", verified: primary?.verification?.status === "verified" };
}

/**
 * Claim an unused owner grant for an already-registered pending member.
 * The optional loader is a server-side test seam, never supplied by an HTTP caller.
 * Consumed grants, suspended accounts and explicit membership decisions are not reset.
 */
export async function activatePendingOwner(
  member: MemberRecord,
  identify: (id: string) => Promise<OwnerIdentity> = loadOwnerIdentity,
): Promise<MemberRecord> {
  if (member.status !== "PENDING" || member.role !== "VIEWER") return member;
  const email = member.email.trim().toLowerCase();
  const [candidate] = await db.select({ email: adminGrants.email }).from(adminGrants)
    .where(and(eq(adminGrants.email, email), isNull(adminGrants.consumedBy))).limit(1);
  if (!candidate) return member;
  // Never trust session custom claims, browser-supplied email/role or a stale app email.
  const identity = await identify(member.id);
  if (!identity.verified || identity.email.trim().toLowerCase() !== email) return member;
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(71014001)`);
    const [current] = await tx.select().from(members).where(eq(members.id, member.id)).for("update");
    if (!current) throw new Error("Membership disappeared during owner activation");
    if (current.status !== "PENDING" || current.role !== "VIEWER" || current.email.trim().toLowerCase() !== email) return current;
    const [grant] = await tx.select().from(adminGrants).where(eq(adminGrants.email, email)).for("update");
    if (!grant || grant.consumedBy !== null) return current;
    const [decision] = await tx.select({ id: auditLog.id }).from(auditLog).where(and(
      or(eq(auditLog.userId, current.id), eq(auditLog.objectId, current.id)),
      inArray(auditLog.action, ["MEMBERSHIP_UPDATED", "MEMBER_ACCESS_CHANGED", "ADMIN_ACTIVATED"]),
    )).limit(1);
    if (decision) return current;
    const [activated] = await tx.update(members).set({ role: "SUPER_ADMIN", status: "ACTIVE" })
      .where(eq(members.id, current.id)).returning();
    await tx.update(adminGrants).set({ consumedBy: current.id, consumedAt: new Date() }).where(eq(adminGrants.email, email));
    await tx.insert(auditLog).values({
      id: randomUUID(), userId: current.id, action: "ADMIN_ACTIVATED",
      description: "Admin utama diaktifkan dari keanggotaan menunggu melalui email utama terverifikasi dan izin pemilik yang belum digunakan.",
    });
    return activated!;
  });
}
