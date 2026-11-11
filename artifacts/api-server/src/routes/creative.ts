import { Router } from "express";
import { requireActive, requireMember } from "../middlewares/member";
import { creativeLibraryRouter } from "./creative-library";
import { creativeConceptRouter } from "./creative-concepts";
import { creativeUploadRouter } from "./creative-uploads";

export const creativeRouter = Router();
creativeRouter.use("/creative", requireMember, requireActive);
creativeRouter.post("/creative/generate", (_req, res) => {
  res.status(403).json({ error: "Tahap B hanya menyusun konsep/prompt. Generasi video dinonaktifkan di server." });
});
creativeRouter.use("/creative", creativeLibraryRouter, creativeConceptRouter, creativeUploadRouter);
