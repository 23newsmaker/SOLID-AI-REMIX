import { Router } from "express";
import * as api from "@workspace/api-zod";
import { and, eq } from "drizzle-orm";
import { db, characters } from "@workspace/db";
import { requireMember, requireActive } from "../middlewares/member";
import { CreativeError, libraryAdmin } from "../lib/creative-policy";
import { getSettings, settingsView, saveSettings, providerInfo, saveProvider } from "../lib/operations/controls";
import { saveComfyProvider, testComfy } from "../lib/comfyui/provider";
import { sources, reviewSource, facts, saveFact, reviewFact } from "../lib/operations/facts";
import { retentionPreview, approveRetention } from "../lib/operations/retention";
import { report, reportCsv, auditRows } from "../lib/operations/reports";
import { versions } from "../lib/operations/versions";
import { finalEvidence, finalTransition, filePermission, finalStale } from "../lib/operations/final-review";
import { readJob } from "../lib/video/service";
import { videoStorage } from "../lib/video/storage";
const idOf = (value: unknown) => api.GetCreativeConceptParams.parse(value).id;

export const operationsRouter = Router();
operationsRouter.use(["/operations", "/facts"], requireMember, requireActive);
operationsRouter.get("/operations/report", async (req, res) => { res.json(api.GetOperationsReportResponse.parse(await report(req.query, req.member!))); });
operationsRouter.get("/operations/export", async (req, res) => {
  const csv = await reportCsv(req.query, req.member!);
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="solid-operations.csv"', "Cache-Control": "private, no-store" }).send(csv);
});
operationsRouter.get("/operations/settings", async (req, res) => {
  if (!libraryAdmin(req.member!)) throw new CreativeError(403, "Hanya admin.");
  res.json(api.GetOperationsSettingsResponse.parse(settingsView(await getSettings())));
});
operationsRouter.patch("/operations/settings", async (req, res) => { res.json(api.UpdateOperationsSettingsResponse.parse(await saveSettings(req.body, req.member!))); });
operationsRouter.get("/operations/providers", async (req, res) => {
  if (req.member!.role !== "SUPER_ADMIN") throw new CreativeError(403, "Konfigurasi hanya admin utama.");
  res.json(api.GetProviderControlsResponse.parse(await providerInfo()));
});
operationsRouter.patch("/operations/providers", async (req, res) => { res.json(api.UpdateProviderControlsResponse.parse(await saveProvider(req.body, req.member!))); });
operationsRouter.patch("/operations/providers/comfyui", async (req, res) => {
  await saveComfyProvider(req.body, req.member!);
  res.json(api.UpdateComfyProviderResponse.parse(await providerInfo()));
});
operationsRouter.post("/operations/providers/comfyui/test", async (req, res) => { res.json(api.TestComfyProviderResponse.parse(await testComfy(req.member!))); });
operationsRouter.get("/operations/retention", async (req, res) => { res.json(api.GetRetentionPreviewResponse.parse(await retentionPreview(req.member!))); });
operationsRouter.post("/operations/retention", async (req, res) => { res.json(api.ApproveRetentionPolicyResponse.parse(await approveRetention(req.body, req.member!))); });
operationsRouter.get("/operations/audit", async (req, res) => { res.json(api.GetOperationsAuditResponse.parse(await auditRows(req.member!))); });
operationsRouter.get("/operations/sources", async (req, res) => { res.json(api.ListComplianceSourcesResponse.parse(await sources(req.member!))); });
operationsRouter.patch("/operations/sources/:id", async (req, res) => { res.json(api.ReviewComplianceSourceResponse.parse(await reviewSource(idOf(req.params), req.body, req.member!))); });
operationsRouter.get("/facts", async (req, res) => { res.json(api.ListPublicFactsResponse.parse(await facts(req.member!))); });
operationsRouter.post("/facts", async (req, res) => { res.json(api.CreatePublicFactResponse.parse(await saveFact(null, req.body, req.member!))); });
operationsRouter.put("/facts/:id", async (req, res) => { res.json(api.RevisePublicFactResponse.parse(await saveFact(idOf(req.params), req.body, req.member!))); });
operationsRouter.post("/facts/:id/review", async (req, res) => { res.json(api.ReviewPublicFactResponse.parse(await reviewFact(idOf(req.params), req.body, req.member!))); });
operationsRouter.get("/creative/concepts/:id/versions", requireMember, requireActive, async (req, res) => {
  res.json(api.GetConceptVersionsResponse.parse(await versions(idOf(req.params), req.member!)));
});
operationsRouter.get("/video/jobs/:id/review", requireMember, requireActive, async (req, res) => {
  res.json(api.GetFinalVideoReviewResponse.parse(await finalEvidence(idOf(req.params), req.member!)));
});
operationsRouter.post("/video/jobs/:id/review", requireMember, requireActive, async (req, res) => {
  if (req.studioFolderId) throw new CreativeError(409, "Studio bersama memakai pemeriksaan pembuat, bukan antrean review.");
  res.json(api.TransitionFinalVideoReviewResponse.parse(await finalTransition(idOf(req.params), req.body, req.member!)));
});
operationsRouter.get("/video/jobs/:id/reference", requireMember, requireActive, async (req, res, next) => {
  const job = await readJob(idOf(req.params), req.member!);
  if (!filePermission(job, req.member!) || (await finalStale(job)).stale) throw new CreativeError(404, "Referensi review tidak tersedia.");
  const [character] = await db.select().from(characters).where(and(eq(characters.id, job.characterId), eq(characters.userId, job.ownerId)));
  if (!character) throw new CreativeError(404, "Karakter tidak tersedia.");
  const file = await videoStorage.getObjectEntityFile(character.objectPath);
  res.set({ "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "Cross-Origin-Resource-Policy": "same-origin" });
  file.createReadStream().on("error", next).pipe(res);
});
