import { Router } from "express";
import { randomUUID } from "node:crypto";
import { db, members, auditLog } from "@workspace/db";
import { eq, sql, desc } from "drizzle-orm";
import { ListTeamResponse, UpdateTeamMemberBody, UpdateTeamMemberParams, UpdateTeamMemberResponse } from "@workspace/api-zod";
import { requireMember, requireActive, requireSuperAdmin } from "../middlewares/member";

export const teamRouter = Router();
teamRouter.use("/team", requireMember, requireActive, requireSuperAdmin);
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
    if (target.status !== "ACTIVE" && input.status === "ACTIVE") {
      const [{ total }] = await tx.select({ total: sql<number>`count(*)::int` }).from(members).where(eq(members.status, "ACTIVE"));
      if (total >= 10) return { status: 409, error: "Batas sepuluh anggota aktif telah tercapai." } as const;
    }
    const [updated] = await tx.update(members).set(input).where(eq(members.id, id)).returning();
    await tx.insert(auditLog).values({ id: randomUUID(), userId: req.member!.id, action: "MEMBERSHIP_UPDATED", description: `Hak anggota diperbarui menjadi ${input.role} / ${input.status}.` });
    return { status: 200, member: updated! } as const;
  });
  if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }
  res.json(UpdateTeamMemberResponse.parse(serialize(result.member)));
});
