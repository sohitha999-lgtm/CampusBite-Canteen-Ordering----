import { Router, type IRouter } from "express";
import {
  GetMenuItemParams,
  GetMenuItemResponse,
  ListMenuQueryParams,
  ListMenuResponseItem,
  ListMenuResponse,
} from "@workspace/api-zod";
import { campusDb } from "../lib/campus-db";

const router: IRouter = Router();

interface FoodRow {
  id: number;
  name: string;
  description: string;
  price: number;
  category: string;
  image_url: string | null;
  is_vegetarian: number;
  available: number;
  popular: number;
}

function foodItem(row: FoodRow) {
  return ListMenuResponseItem.parse({
    id: row.id,
    name: row.name,
    description: row.description,
    price: row.price,
    category: row.category,
    imageUrl: row.image_url,
    isVegetarian: Boolean(row.is_vegetarian),
    available: Boolean(row.available),
    popular: Boolean(row.popular),
  });
}

router.get("/menu", (req, res): void => {
  const parsed = ListMenuQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { category, search, sort } = parsed.data;
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  if (category) {
    conditions.push("category = ?");
    values.push(category);
  }
  if (search?.trim()) {
    conditions.push("(name LIKE ? OR description LIKE ?)");
    const term = `%${search.trim().slice(0, 80)}%`;
    values.push(term, term);
  }
  const sortSql: Record<string, string> = {
    popular: "popular DESC, available DESC, name COLLATE NOCASE",
    "price-asc": "price ASC, name COLLATE NOCASE",
    "price-desc": "price DESC, name COLLATE NOCASE",
    name: "name COLLATE NOCASE ASC",
  };
  const orderBy = sortSql[sort ?? "popular"];
  const rows = campusDb.prepare(`
    SELECT id, name, description, price, category, image_url, is_vegetarian, available, popular
    FROM food_items
    ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
    ORDER BY ${orderBy}
  `).all(...values) as unknown as FoodRow[];
  res.json(ListMenuResponse.parse(rows.map(foodItem)));
});

router.get("/menu/:id", (req, res): void => {
  const parsed = GetMenuItemParams.safeParse(req.params);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const row = campusDb.prepare(`
    SELECT id, name, description, price, category, image_url, is_vegetarian, available, popular
    FROM food_items WHERE id = ?
  `).get(parsed.data.id) as FoodRow | undefined;
  if (!row) {
    res.status(404).json({ error: "Menu item not found." });
    return;
  }
  res.json(GetMenuItemResponse.parse(foodItem(row)));
});

export { foodItem };
export type { FoodRow };
export default router;
