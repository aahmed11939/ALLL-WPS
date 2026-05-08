import { Router, type IRouter } from "express";
import healthRouter from "./health";
import billingRouter from "../billing";
import adminRouter from "../adminRoutes";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/billing", billingRouter);
router.use("/admin", adminRouter);

export default router;
