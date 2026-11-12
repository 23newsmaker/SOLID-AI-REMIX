import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, members, auditLog } from "@workspace/db";
import { eq, sql, desc, and } from "drizzle-orm";
import { ListTeamResponse, UpdateTeamMemberBody, UpdateTeamMemberParams, UpdateTeamMemberResponse } from "@workspace/api-zod";
import { requireMember, requireActive, requireTeamManager } from "../middlewares/member";
import { audit } from "../lib/operations/audit";

export const teamRouter = Router();
teamRouter.use("/team", requireMember, requireActive, requireTeamManager);
const serialize = (m: typeof members.$inferSelect) => ({ ...m, createdAt: m.createdAt.toISOString() });
teamRouter.get("/team", async (_req, res) => {
  res.json(ListTeamResponse.parse((await db.select().from(members).orderBy(desc(members.createdAt))).map(serialize)));
});
teamRouter.patch("/team/:id", async (req, res) => {
  const { id } = UpdateTeamMemberParams.parse(req.params);
  const input = UpdateTeamMemberBody.parse(req.body);
  if (id === req.member!.id) {
    res.status(400).json({ error: "Admin tidak dapat mengubah aksesnya sendiri." }); return;
  }
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(71014001)`);
    const [target] = await tx.select().from(members).where(eq(members.id, id)).for("update");
    if (!target) return { status: 404, error: "Anggota tidak ditemukan." } as const;
    if (req.member!.role !== "SUPER_ADMIN" && [target.role, input.role].some(r => ["ADMIN", "SUPER_ADMIN"].includes(r))) {
      return { status: 403, error: "Hanya admin utama dapat mengubah akun/role istimewa." } as const;
    }
    if (target.role === "SUPER_ADMIN" && target.status === "ACTIVE" && (input.role !== "SUPER_ADMIN" || input.status !== "ACTIVE")) {
      const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(members).where(and(eq(members.role, "SUPER_ADMIN"), eq(members.status, "ACTIVE")));
      if (total <= 1) return { status: 409, error: "Admin utama aktif terakhir tidak boleh dinonaktifkan." } as const;
    }
    const [updated] = await tx.update(members).set(input).where(eq(members.id, id)).returning();
    await audit(req.member!.id, "MEMBER_ACCESS_CHANGED", id, { role: target.role, status: target.status }, { role: input.role, status: input.status }, tx);
    await tx.insert(auditLog).values({ id: randomUUID(), userId: req.member!.id, action: "MEMBERSHIP_UPDATED", description: `Hak anggota diperbarui menjadi ${input.role} / ${input.status}.` });
    return { status: 200, member: updated! } as const;
  });
  if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }
  res.json(UpdateTeamMemberResponse.parse(serialize(result.member)));
});
