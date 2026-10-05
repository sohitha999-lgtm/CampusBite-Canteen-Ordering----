import { Router, type IRouter } from "express";
import healthRouter from "./health";
import campusbiteAdminRouter from "./campusbite-admin";
import campusbiteAuthRouter from "./campusbite-auth";
import campusbiteDisplayRouter from "./campusbite-display";
import campusbiteMenuRouter from "./campusbite-menu";
import campusbiteOrdersRouter from "./campusbite-orders";

const router: IRouter = Router();

router.use(healthRouter);
router.use(campusbiteAuthRouter);
router.use(campusbiteMenuRouter);
router.use(campusbiteOrdersRouter);
router.use(campusbiteAdminRouter);
router.use(campusbiteDisplayRouter);

export default router;
