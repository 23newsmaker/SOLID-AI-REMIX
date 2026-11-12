import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, studioSelfChecks, videoJobs } from "@workspace/db";
import {
  GetStudioSelfCheckParams, GetStudioSelfCheckResponse,
  SaveStudioSelfCheckBody, SaveStudioSelfCheckParams, SaveStudioSelfCheckResponse,
} from "@workspace/api-zod";
import { requireMember, requireActive } from "../middlewares/member";
import { CreativeError } from "../lib/creative-policy";
import { readJob } from "../lib/video/service";
import { studioCheckBinding } from "../lib/operations/final-review";
import { ownerLock } from "../lib/creative-service";
import { audit } from "../lib/operations/audit";
import { equalStudioBinding } from "../lib/studio-policy";

export const studioCheckRouter = Router();
studioCheckRouter.use("/studio/folders/:folderId/checks/:id", (req, _res, next) => {
  // Bind this resource's explicit folder to the ordinary shared member guard.
  const folderId = String(req.params.folderId);
  const header = req.get("X-Solid-Folder");
  if (header && header !== folderId) throw new CreativeError(400, "Folder pemeriksaan tidak cocok.");
  req.headers["x-solid-folder"] = folderId;
  next();
}, requireMember, requireActive);
studioCheckRouter.get("/studio/folders/:folderId/checks/:id", async (req, res) => {
  const { id, folderId } = GetStudioSelfCheckParams.parse(req.params);
  const job = await readJob(id, req.member!);
  const [saved] = await db.select().from(studioSelfChecks).where(eq(studioSelfChecks.jobId, id));
  let valid = false;
  if (saved?.folderId === folderId) {
    try { valid = equalStudioBinding(saved.binding, await studioCheckBinding(job)); }
    catch { valid = false; }
  }
  res.json(GetStudioSelfCheckResponse.parse({
    checked: valid, stale: !!saved && !valid, checkedAt: saved?.checkedAt.toISOString() ?? null,
  }));
});
studioCheckRouter.post("/studio/folders/:folderId/checks/:id", async (req, res) => {
  const { id, folderId } = SaveStudioSelfCheckParams.parse(req.params);
  const input = SaveStudioSelfCheckBody.parse(req.body);
  if (!input.confirmed) throw new CreativeError(400, "Periksa video, suara, teks, logo, dan klaim sebelum menandai.");
  const me = req.member!;
  const job = await readJob(id, me);
  if (job.conceptVersion !== input.conceptVersion) throw new CreativeError(409, "Versi hasil berubah. Periksa hasil yang terbaru.");
  const binding = await studioCheckBinding(job, true);
  const now = new Date();
  await db.transaction(async tx => {
    await ownerLock(tx, me.id);
    const [current] = await tx.select().from(videoJobs).where(eq(videoJobs.id, id)).for("update");
    if (!current || current.deleted || current.status !== "COMPLETED" ||
      current.conceptVersion !== input.conceptVersion || current.resultPath !== job.resultPath) {
      throw new CreativeError(409, "Hasil berubah atau dihapus. Muat ulang sebelum memeriksa.");
    }
    // A concurrent concept/character/material edit makes this evidence stale.
    const fresh = await studioCheckBinding({ ...current, resultHash: binding.resultHash }, false, tx);
    if (!equalStudioBinding(fresh, binding)) throw new CreativeError(409, "Bahan atau konsep berubah. Periksa ulang hasil.");
    await tx.update(videoJobs).set({ resultHash: binding.resultHash }).where(eq(videoJobs.id, id));
    await tx.insert(studioSelfChecks).values({
      jobId: id, folderId, sessionHash: req.studioSessionHash!, binding, checkedAt: now,
    }).onConflictDoUpdate({ target: studioSelfChecks.jobId, set: {
      folderId, sessionHash: req.studioSessionHash!, binding, checkedAt: now,
    } });
    await audit(me.id, "STUDIO_CREATOR_SELF_CHECK", id, null,
      { folderId, sessionHash: req.studioSessionHash, identityVerified: false, companyApproval: false }, tx);
  });
  res.json(SaveStudioSelfCheckResponse.parse({ checked: true, stale: false, checkedAt: now.toISOString() }));
});
