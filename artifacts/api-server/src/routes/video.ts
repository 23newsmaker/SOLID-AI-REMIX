import { Router } from "express";
import {
  GetVideoConfigResponse, ListVideoJobsResponse, GetVideoJobParams, GetVideoJobResponse,
  CreateVideoJobResponse, CancelVideoJobParams, CancelVideoJobResponse,
  DeleteVideoResultParams, UpdateVideoSettingsBody, GetVideoUsageResponse, UpdateVideoSettingsResponse,
  GetVideoFileParams,
} from "@workspace/api-zod";
import { requireMember, requireActive } from "../middlewares/member";
import { CreativeError } from "../lib/creative-policy";
import { createJob, videoConfig, listJobs, readJob, serializeJob, cancelJob, deleteResult, monthlyUsage, updateSettings, videoAdmin } from "../lib/video/service";
import { videoFile } from "../lib/video/storage";

export const videoRouter = Router();
videoRouter.use("/video", requireMember, requireActive);
videoRouter.get("/video/config", async (req, res) => { res.json(GetVideoConfigResponse.parse(await videoConfig(req.member!))); });
videoRouter.get("/video/jobs", async (req, res) => { res.json(ListVideoJobsResponse.parse((await listJobs(req.member!)).map(serializeJob))); });
videoRouter.post("/video/jobs", async (req, res) => { res.json(CreateVideoJobResponse.parse(serializeJob(await createJob(req.body, req.member!)))); });
videoRouter.get("/video/jobs/:id", async (req, res) => {
  const { id } = GetVideoJobParams.parse(req.params);
  res.json(GetVideoJobResponse.parse(serializeJob(await readJob(id, req.member!))));
});
videoRouter.post("/video/jobs/:id/cancel", async (req, res) => {
  const { id } = CancelVideoJobParams.parse(req.params);
  res.json(CancelVideoJobResponse.parse(serializeJob(await cancelJob(id, req.member!))));
});
videoRouter.delete("/video/jobs/:id", async (req, res) => {
  const { id } = DeleteVideoResultParams.parse(req.params);
  await deleteResult(id, req.member!);
  res.json({ ok: true });
});
videoRouter.get("/video/jobs/:id/file", async (req, res, next) => {
  const { id } = GetVideoFileParams.parse(req.params);
  const job = await readJob(id, req.member!);
  if (job.status !== "COMPLETED" || !job.resultPath || job.deleted || job.simulation) throw new CreativeError(404, "Hasil belum tersedia atau sudah dihapus.");
  const file = videoFile(job.resultPath);
  const [meta] = await file.getMetadata();
  const size = Number(meta.size);
  if (!size) throw new CreativeError(404, "File hasil tidak tersedia.");
  let start = 0, end = size - 1;
  const range = req.get("range");
  if (range) {
    const parts = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!parts || (!parts[1] && !parts[2])) { res.set("Content-Range", `bytes */${size}`).sendStatus(416); return; }
    if (!parts[1]) { start = Math.max(0, size - Number(parts[2])); }
    else { start = Number(parts[1]); if (parts[2]) end = Math.min(end, Number(parts[2])); }
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
      res.set("Content-Range", `bytes */${size}`).sendStatus(416); return;
    }
    res.status(206).set("Content-Range", `bytes ${start}-${end}/${size}`);
  }
  res.set({
    "Content-Type": "video/mp4", "Content-Length": String(end - start + 1), "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store", "Cross-Origin-Resource-Policy": "same-origin",
    "Content-Disposition": `${req.query.download === "1" ? "attachment" : "inline"}; filename="solid-${id}.mp4"`,
  });
  file.createReadStream({ start, end }).on("error", next).pipe(res);
});
videoRouter.get("/video/admin", async (req, res) => {
  if (!videoAdmin(req.member!)) throw new CreativeError(403, "Ringkasan biaya hanya untuk admin.");
  res.json(GetVideoUsageResponse.parse(await monthlyUsage()));
});
videoRouter.patch("/video/admin", async (req, res) => {
  res.json(UpdateVideoSettingsResponse.parse(await updateSettings(UpdateVideoSettingsBody.parse(req.body), req.member!)));
});
