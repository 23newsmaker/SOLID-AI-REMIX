import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { overviewRouter } from "./overview";
import { characterRouter } from "./character";
import { knowledgeRouter } from "./knowledge";
import { teamRouter } from "./team";
import { creativeRouter } from "./creative";
import { videoRouter } from "./video";
import { operationsRouter } from "./operations";
import { audit } from "../lib/operations/audit";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) res.once("finish", () => {
    if (req.member) void audit(req.member.id, "API_MUTATION_RESULT", req.path.slice(0, 240), null,
      { method: req.method, status: res.statusCode }).catch(() => logger.warn("Request audit deferred"));
  });
  next();
});

router.use(healthRouter);
router.use(overviewRouter);
router.use(characterRouter);
router.use(knowledgeRouter);
router.use(teamRouter);
router.use(operationsRouter);
router.use(creativeRouter);
router.use(videoRouter);

export default router;
