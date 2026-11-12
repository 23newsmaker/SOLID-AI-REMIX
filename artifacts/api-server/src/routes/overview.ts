import { Router } from "express";
import { db, characters, members, knowledgeSources, auditLog } from "@workspace/db";
import { and, eq, desc, sql, or } from "drizzle-orm";
import { requireMember, requireActive, hasRestrictedAccess } from "../middlewares/member";
import { GetAppInfoResponse, GetMeResponse, GetOverviewResponse, GetActivityResponse } from "@workspace/api-zod";
import { videoConfig } from "../lib/video/service";

export const overviewRouter = Router();
overviewRouter.get("/app-info", (_req, res) => res.json(GetAppInfoResponse.parse({
  name: "SOLID AI REMIX", stage: "Tahap E terbatas — Optimasi Mode Hemat", generationEnabled: true, llmEnabled: false, dailyLimit: 3, maxMembers: null,
})));
overviewRouter.get("/me", requireMember, (req, res) => {
  res.json(GetMeResponse.parse({ ...req.member, createdAt: req.member!.createdAt.toISOString() }));
});
overviewRouter.get("/overview", requireMember, requireActive, async (req, res) => {
  const [character] = await db.select({ id: characters.id }).from(characters).where(eq(characters.userId, req.member!.id));
  const permitted = hasRestrictedAccess(req)
    ? eq(knowledgeSources.active, true)
    : and(eq(knowledgeSources.active, true), or(eq(knowledgeSources.access, "INTERNAL_GENERAL"), eq(knowledgeSources.access, "APPROVED_FOR_PUBLIC_CONTENT")));
  const [{ total: sourceCount }] = await db.select({ total: sql<number>`count(*)::int` }).from(knowledgeSources).where(permitted);
  const [{ total: approvedPublicCount }] = await db.select({ total: sql<number>`count(*)::int` }).from(knowledgeSources).where(and(eq(knowledgeSources.active, true), eq(knowledgeSources.access, "APPROVED_FOR_PUBLIC_CONTENT"), eq(knowledgeSources.validation, "APPROVED")));
  const [{ total: activeMembers }] = await db.select({ total: sql<number>`count(*)::int` }).from(members).where(eq(members.status, "ACTIVE"));
  const video = await videoConfig(req.member!);
  res.json(GetOverviewResponse.parse({
    characterReady: !!character, sourceCount, approvedPublicCount, activeMembers,
    maxMembers: null, dailyLimit: video.dailyLimit, dailyUsed: video.dailyUsed, generationEnabled: !video.paused, llmEnabled: false,
    phase: "E terbatas",
    nextStep: "Konsep yang disetujui dapat dirender melalui halaman Video dalam Mode Hemat. AI/TTS berbayar belum diaktifkan.",
  }));
});
overviewRouter.get("/activity", requireMember, requireActive, async (req, res) => {
  const rows = await db.select().from(auditLog)
    .where(req.member!.role === "SUPER_ADMIN" ? undefined : eq(auditLog.userId, req.member!.id))
    .orderBy(desc(auditLog.createdAt)).limit(30);
  res.json(GetActivityResponse.parse(rows.map(r => ({ ...r, createdAt: r.createdAt.toISOString() }))));
});

// Hard gate: no provider is configured or invoked, regardless of frontend state.
overviewRouter.post("/generate", requireMember, requireActive, (_req, res) => {
  res.status(423).json({ error: "Gunakan halaman Video untuk konfirmasi job Mode Hemat. Endpoint lama ini tidak mengirim job; AI berbayar tetap nonaktif." });
});
