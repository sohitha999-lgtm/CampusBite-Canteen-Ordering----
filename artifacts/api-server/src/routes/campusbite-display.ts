import { Router, type IRouter } from "express";
import { GetActiveOrdersResponse, GetReadyTokensResponse } from "@workspace/api-zod";
import { activeDisplayOrders, readyDisplayOrders } from "../lib/campus-orders";

const router: IRouter = Router();

router.get("/display/active", (_req, res): void => {
  res.json(GetActiveOrdersResponse.parse(activeDisplayOrders()));
});

router.get("/display/ready", (_req, res): void => {
  res.json(GetReadyTokensResponse.parse(readyDisplayOrders()));
});

export default router;
