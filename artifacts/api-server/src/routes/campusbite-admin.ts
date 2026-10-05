import { Router, type IRouter } from "express";
import {
  CreateMenuItemBody,
  CreateMenuItemResponse,
  DeleteMenuItemParams,
  GetAdminDashboardResponse,
  GetAnalyticsResponse,
  ListAdminOrdersResponse,
  UpdateMenuItemBody,
  UpdateMenuItemParams,
  UpdateMenuItemResponse,
  UpdateOrderStatusBody,
  UpdateOrderStatusParams,
  UpdateOrderStatusResponse,
} from "@workspace/api-zod";
import { requireCampusUser } from "../lib/campus-auth";
import { analyticsData, dashboardData, listOrdersForAdmin, updateOrderStatus } from "../lib/campus-orders";
import { campusDb } from "../lib/campus-db";
import { foodItem, type FoodRow } from "./campusbite-menu";

const router: IRouter = Router();

router.get("/admin/dashboard", (req, res): void => {
  if (!requireCampusUser(req, res, "ADMIN")) return;
  res.json(GetAdminDashboardResponse.parse(dashboardData()));
});

router.get("/admin/orders", (req, res): void => {
  if (!requireCampusUser(req, res, "ADMIN")) return;
  res.json(ListAdminOrdersResponse.parse(listOrdersForAdmin()));
});

router.patch("/admin/orders/:id/status", (req, res): void => {
  if (!requireCampusUser(req, res, "ADMIN")) return;
  const params = UpdateOrderStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateOrderStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const result = updateOrderStatus(params.data.id, body.data.status);
  if (result.kind === "missing") {
    res.status(404).json({ error: "Order not found." });
    return;
  }
  if (result.kind === "invalid") {
    res.status(409).json({ error: `Order cannot move from ${result.currentStatus} to ${body.data.status}.` });
    return;
  }
  res.json(UpdateOrderStatusResponse.parse(result.order));
});

router.post("/admin/menu", (req, res): void => {
  if (!requireCampusUser(req, res, "ADMIN")) return;
  const parsed = CreateMenuItemBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const now = new Date().toISOString();
  const input = parsed.data;
  const result = campusDb.prepare(`
    INSERT INTO food_items
      (name, description, price, category, image_url, is_vegetarian, available, popular, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.name.trim(),
    input.description.trim(),
    input.price,
    input.category,
    input.imageUrl ?? null,
    input.isVegetarian ? 1 : 0,
    input.available ? 1 : 0,
    input.popular ? 1 : 0,
    now,
    now,
  );
  const row = campusDb.prepare(`
    SELECT id, name, description, price, category, image_url, is_vegetarian, available, popular
    FROM food_items WHERE id = ?
  `).get(Number(result.lastInsertRowid)) as unknown as FoodRow;
  res.status(201).json(CreateMenuItemResponse.parse(foodItem(row)));
});

router.patch("/admin/menu/:id", (req, res): void => {
  if (!requireCampusUser(req, res, "ADMIN")) return;
  const params = UpdateMenuItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateMenuItemBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const current = campusDb.prepare("SELECT id FROM food_items WHERE id = ?").get(params.data.id);
  if (!current) {
    res.status(404).json({ error: "Menu item not found." });
    return;
  }
  const input = body.data;
  const updateFieldMap: Record<string, string> = {
    name: "name",
    description: "description",
    price: "price",
    category: "category",
    imageUrl: "image_url",
    isVegetarian: "is_vegetarian",
    available: "available",
    popular: "popular",
  };
  const updates: string[] = [];
  const values: (string | number | null)[] = [];
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    let normalized: string | number | null;
    if (typeof value === "boolean") normalized = value ? 1 : 0;
    else if (typeof value === "string" && key !== "imageUrl") normalized = value.trim();
    else if (typeof value === "string" || typeof value === "number" || value === null) normalized = value;
    else continue;
    updates.push(`${updateFieldMap[key]} = ?`);
    values.push(normalized);
  }
  updates.push("updated_at = ?");
  values.push(new Date().toISOString(), params.data.id);
  campusDb.prepare(`UPDATE food_items SET ${updates.join(", ")} WHERE id = ?`).run(...values);
  const row = campusDb.prepare(`
    SELECT id, name, description, price, category, image_url, is_vegetarian, available, popular
    FROM food_items WHERE id = ?
  `).get(params.data.id) as unknown as FoodRow;
  res.json(UpdateMenuItemResponse.parse(foodItem(row)));
});

router.delete("/admin/menu/:id", (req, res): void => {
  if (!requireCampusUser(req, res, "ADMIN")) return;
  const params = DeleteMenuItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const result = campusDb.prepare("DELETE FROM food_items WHERE id = ?").run(params.data.id);
  if (result.changes === 0) {
    res.status(404).json({ error: "Menu item not found." });
    return;
  }
  res.status(204).end();
});

router.get("/admin/analytics", (req, res): void => {
  if (!requireCampusUser(req, res, "ADMIN")) return;
  res.json(GetAnalyticsResponse.parse(analyticsData()));
});

export default router;
