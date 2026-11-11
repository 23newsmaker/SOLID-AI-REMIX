import { Router, type IRouter } from "express";
import healthRouter from "./health";
import { overviewRouter } from "./overview";
import { characterRouter } from "./character";
import { knowledgeRouter } from "./knowledge";
import { teamRouter } from "./team";
import { creativeRouter } from "./creative";

const router: IRouter = Router();

router.use(healthRouter);
router.use(overviewRouter);
router.use(characterRouter);
router.use(knowledgeRouter);
router.use(teamRouter);
router.use(creativeRouter);

export default router;
