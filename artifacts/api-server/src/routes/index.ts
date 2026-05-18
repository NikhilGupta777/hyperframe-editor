import { Router, type IRouter } from "express";
import healthRouter from "./health";
import projectsRouter from "./projects";
import renderRouter from "./render";
import agentRouter from "./agent";
import stockRouter from "./stock";
import previewRouter from "./preview";

const router: IRouter = Router();

router.use(healthRouter);
router.use(projectsRouter);
router.use(renderRouter);
router.use(agentRouter);
router.use(stockRouter);
router.use(previewRouter);

export default router;
