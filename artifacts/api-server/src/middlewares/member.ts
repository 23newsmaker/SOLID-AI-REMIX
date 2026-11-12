import { clerkClient, getAuth } from "@clerk/express";
import { db, members, adminGrants, auditLog, sessionAudits, type MemberRecord } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { randomUUID, createHash } from "node:crypto";
import { audit } from "../lib/operations/audit";
import { activatePendingOwner } from "../lib/bootstrapAdmin";
import type { Request, RequestHandler } from "express";

declare global {
  namespace Express {
    interface Request { member?: MemberRecord }
  }
}

export const requireMember: RequestHandler = async (req, res, next) => {
  try {
    const userId = getAuth(req).userId;
    if (!userId) { res.status(401).json({ error: "Silakan masuk terlebih dahulu." }); return; }
    const existing = await db.select().from(members).where(eq(members.id, userId)).limit(1);
    if (existing[0]) {
      req.member = await activatePendingOwner(existing[0]);
      const sessionId = getAuth(req).sessionId;
      if (sessionId) {
        const key = createHash("sha256").update(`${userId}:${sessionId}`).digest("hex");
        await db.transaction(async tx => {
          const inserted = await tx.insert(sessionAudits).values({ key, userId }).onConflictDoNothing().returning();
          if (inserted.length) await audit(userId, "AUTHENTICATED_APP_SESSION", userId, null, { status: req.member!.status }, tx);
        });
      }
      next(); return;
    }

    const user = await clerkClient.users.getUser(userId);
    const primary = user.emailAddresses.find(e => e.id === user.primaryEmailAddressId);
    if (!primary || primary.verification?.status !== "verified") {
      res.status(403).json({ error: "Verifikasi email login terlebih dahulu." }); return;
    }
    const email = primary.emailAddress.toLowerCase();
    req.member = await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(71014001)`);
      const [known] = await tx.select().from(members).where(eq(members.id, userId)).limit(1);
      if (known) return known;
      const [grant] = await tx.select().from(adminGrants).where(eq(adminGrants.email, email)).for("update");
      const isOwner = !!grant && grant.consumedBy === null;
      const activate = isOwner;
      const [created] = await tx.insert(members).values({
        id: userId,
        email,
        name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || "Anggota SOLID",
        role: activate ? "SUPER_ADMIN" : "VIEWER",
        status: activate ? "ACTIVE" : "PENDING",
      }).returning();
      if (activate) {
        await tx.update(adminGrants).set({ consumedBy: userId, consumedAt: new Date() }).where(eq(adminGrants.email, email));
      }
      await tx.insert(auditLog).values({
        id: randomUUID(), userId,
        action: activate ? "ADMIN_ACTIVATED" : "MEMBERSHIP_REQUESTED",
        description: activate ? "Admin utama diaktifkan melalui email terverifikasi yang ditentukan pemilik." : "Permintaan bergabung diterima; akses internal menunggu persetujuan.",
      });
      return created!;
    });
    next();
  } catch (error) {
    // A recently deleted Clerk identity can still have a short-lived JWT in an open tab.
    // Deny that session instead of reporting a server failure or recreating membership.
    if (typeof error === "object" && error && "status" in error && error.status === 404) {
      res.status(401).json({ error: "Sesi akun tidak lagi berlaku. Silakan masuk kembali." }); return;
    }
    next(error);
  }
};

export const requireActive: RequestHandler = (req, res, next) => {
  if (req.member?.status !== "ACTIVE") {
    res.status(403).json({ error: "Akses internal belum disetujui atau telah ditangguhkan." }); return;
  }
  next();
};

export function hasRestrictedAccess(req: Request) {
  return ["SUPER_ADMIN", "ADMIN", "REVIEWER_COMPLIANCE"].includes(req.member?.role ?? "");
}

export const requireSuperAdmin: RequestHandler = (req, res, next) => {
  if (req.member?.role !== "SUPER_ADMIN") {
    res.status(403).json({ error: "Hanya admin utama yang dapat mengelola anggota." }); return;
  }
  next();
};
export const requireTeamManager: RequestHandler = (req, res, next) => {
  if (!["SUPER_ADMIN", "ADMIN"].includes(req.member?.role ?? "")) { res.status(403).json({ error: "Pengelolaan anggota hanya admin." }); return; }
  next();
};

export const requireCharacterEditor: RequestHandler = (req, res, next) => {
  if (req.member?.role === "VIEWER") {
    res.status(403).json({ error: "Akun dengan akses baca tidak dapat mengubah karakter." }); return;
  }
  next();
};
