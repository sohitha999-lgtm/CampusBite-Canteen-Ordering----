import { Router, type IRouter } from "express";
import {
  GetOrderParams,
  GetOrderResponse,
  GetOrderStatusParams,
  GetOrderStatusResponse,
  ListMyOrdersResponse,
  PlaceOrderBody,
  PlaceOrderResponse,
} from "@workspace/api-zod";
import { requireCampusUser } from "../lib/campus-auth";
import { getOrderById, listOrdersForCustomer, placeOrder } from "../lib/campus-orders";
import { campusDb } from "../lib/campus-db";

const router: IRouter = Router();

router.get("/orders", (req, res): void => {
  const user = requireCampusUser(req, res, "CUSTOMER");
  if (!user) return;
  res.json(ListMyOrdersResponse.parse(listOrdersForCustomer(user.id)));
});

router.post("/orders", (req, res): void => {
  const user = requireCampusUser(req, res, "CUSTOMER");
  if (!user) return;
  const parsed = PlaceOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const pickupTimestamp = Date.parse(parsed.data.pickupTime);
  if (!Number.isFinite(pickupTimestamp) || pickupTimestamp <= Date.now()) {
    res.status(400).json({ error: "Choose a valid pickup time in the future." });
    return;
  }
  try {
    const order = placeOrder(user.id, parsed.data);
    res.status(201).json(PlaceOrderResponse.parse(order));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to place the order.";
    if (message.includes("sold out") || message.includes("no longer available") || message.includes("limited to")) {
      res.status(409).json({ error: message });
      return;
    }
    throw error;
  }
});

router.get("/orders/:id", (req, res): void => {
  const user = requireCampusUser(req, res, "CUSTOMER");
  if (!user) return;
  const parsed = GetOrderParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const order = getOrderById(parsed.data.id);
  if (!order || !campusDb.prepare("SELECT 1 FROM orders WHERE id = ? AND user_id = ?").get(parsed.data.id, user.id)) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  res.json(GetOrderResponse.parse(order));
});

router.get("/orders/:id/status", (req, res): void => {
  const user = requireCampusUser(req, res, "CUSTOMER");
  if (!user) return;
  const parsed = GetOrderStatusParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const row = campusDb.prepare(`
    SELECT id, status, token_number, updated_at
    FROM orders WHERE id = ? AND user_id = ?
  `).get(parsed.data.id, user.id) as
    | { id: number; status: string; token_number: number; updated_at: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  res.json(GetOrderStatusResponse.parse({
    id: row.id,
    status: row.status,
    tokenNumber: row.token_number,
    updatedAt: row.updated_at,
  }));
});

export default router;
