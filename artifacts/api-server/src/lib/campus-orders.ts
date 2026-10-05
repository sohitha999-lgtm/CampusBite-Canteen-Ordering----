import {
  GetActiveOrdersResponse,
  GetAdminDashboardResponse,
  GetAnalyticsResponse,
  GetOrderResponse,
  GetReadyTokensResponse,
  OrderInput,
} from "@workspace/api-zod";
import { campusDb } from "./campus-db";

interface OrderRow {
  id: number;
  order_number: string;
  token_number: number;
  token_date: string;
  status: string;
  total_amount: number;
  pickup_time: string;
  payment_method: string;
  customer_name: string | null;
  created_at: string;
  updated_at: string;
}

interface OrderItemRow {
  food_item_id: number;
  name: string;
  quantity: number;
  unit_price: number;
  category: string;
}

const orderSelect = `
  SELECT orders.id, orders.order_number, orders.token_number, orders.token_date,
    orders.status, orders.total_amount, orders.pickup_time, orders.payment_method,
    users.name AS customer_name, orders.created_at, orders.updated_at
  FROM orders JOIN users ON users.id = orders.user_id
`;

export function businessDate(date = new Date()): string {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function orderItems(orderId: number): OrderItemRow[] {
  return campusDb.prepare(`
    SELECT food_item_id, name, quantity, unit_price, category
    FROM order_items WHERE order_id = ? ORDER BY id
  `).all(orderId) as unknown as OrderItemRow[];
}

export function presentOrder(row: OrderRow) {
  return GetOrderResponse.parse({
    id: row.id,
    orderNumber: row.order_number,
    tokenNumber: row.token_number,
    tokenDate: row.token_date,
    status: row.status,
    totalAmount: row.total_amount,
    pickupTime: row.pickup_time,
    paymentMethod: row.payment_method,
    customerName: row.customer_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: orderItems(row.id).map((item) => ({
      foodItemId: item.food_item_id,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
    })),
  });
}

export function getOrderById(id: number) {
  const row = campusDb.prepare(`${orderSelect} WHERE orders.id = ?`).get(id) as
    | OrderRow
    | undefined;
  return row ? presentOrder(row) : null;
}

export function listOrdersForCustomer(userId: number) {
  const rows = campusDb.prepare(`
    ${orderSelect}
    WHERE orders.user_id = ?
    ORDER BY orders.created_at DESC
    LIMIT 100
  `).all(userId) as unknown as OrderRow[];
  return rows.map(presentOrder);
}

export function listOrdersForAdmin() {
  const rows = campusDb.prepare(`
    ${orderSelect}
    ORDER BY orders.created_at DESC
    LIMIT 100
  `).all() as unknown as OrderRow[];
  return rows.map(presentOrder);
}

export function placeOrder(userId: number, input: OrderInput) {
  const combined = new Map<number, number>();
  for (const line of input.items) {
    combined.set(line.foodItemId, (combined.get(line.foodItemId) ?? 0) + line.quantity);
  }
  if ([...combined.values()].some((quantity) => quantity > 50)) {
    throw new Error("Each menu item is limited to 50 per order.");
  }

  campusDb.exec("BEGIN IMMEDIATE");
  try {
    const requested = [...combined.entries()];
    const placeholders = requested.map(() => "?").join(", ");
    const foods = campusDb.prepare(`
      SELECT id, name, price, category, available
      FROM food_items WHERE id IN (${placeholders})
    `).all(...requested.map(([id]) => id)) as Array<{
      id: number;
      name: string;
      price: number;
      category: string;
      available: number;
    }>;
    if (foods.length !== requested.length) {
      throw new Error("One or more menu items are no longer available.");
    }
    const quantities = new Map(requested);
    const unavailable = foods.find((food) => !food.available);
    if (unavailable) throw new Error(`${unavailable.name} is sold out.`);

    const tokenDate = businessDate();
    const counter = campusDb.prepare(`
      INSERT INTO daily_token_counters (token_date, last_token_number)
      VALUES (?, 1)
      ON CONFLICT(token_date) DO UPDATE
        SET last_token_number = last_token_number + 1
      RETURNING last_token_number
    `).get(tokenDate) as { last_token_number: number };
    const tokenNumber = counter.last_token_number;
    const orderNumber = `ORD-${tokenDate.replaceAll("-", "")}-${String(tokenNumber).padStart(5, "0")}`;
    const createdAt = new Date().toISOString();
    const totalAmount = foods.reduce(
      (total, food) => total + food.price * quantities.get(food.id)!,
      0,
    );
    const orderResult = campusDb.prepare(`
      INSERT INTO orders
        (order_number, token_number, token_date, user_id, total_amount, status, pickup_time, payment_method, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'PLACED', ?, ?, ?, ?)
    `).run(
      orderNumber,
      tokenNumber,
      tokenDate,
      userId,
      totalAmount,
      input.pickupTime,
      input.paymentMethod,
      createdAt,
      createdAt,
    );
    const orderId = Number(orderResult.lastInsertRowid);
    const insertItem = campusDb.prepare(`
      INSERT INTO order_items (order_id, food_item_id, name, quantity, unit_price, category)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const food of foods) {
      insertItem.run(
        orderId,
        food.id,
        food.name,
        quantities.get(food.id) ?? 0,
        food.price,
        food.category,
      );
    }
    campusDb.exec("COMMIT");
    const order = getOrderById(orderId);
    if (!order) throw new Error("The order could not be loaded after checkout.");
    return order;
  } catch (error) {
    campusDb.exec("ROLLBACK");
    throw error;
  }
}

export function activeDisplayOrders() {
  const rows = campusDb.prepare(`
    ${orderSelect}
    WHERE orders.token_date = ?
      AND orders.status IN ('ACCEPTED', 'PREPARING', 'READY')
    ORDER BY orders.token_number ASC
  `).all(businessDate()) as unknown as OrderRow[];
  return GetActiveOrdersResponse.parse(rows.map((row) => ({
    id: row.id,
    tokenNumber: row.token_number,
    status: row.status,
    items: orderItems(row.id).map((item) => ({
      foodItemId: item.food_item_id,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
    })),
  })));
}

export function readyDisplayOrders() {
  const rows = campusDb.prepare(`
    ${orderSelect}
    WHERE orders.token_date = ?
      AND orders.status = 'READY'
    ORDER BY orders.updated_at DESC
    LIMIT 10
  `).all(businessDate()) as unknown as OrderRow[];
  return GetReadyTokensResponse.parse(rows.map((row) => ({
    id: row.id,
    tokenNumber: row.token_number,
    status: row.status,
    items: orderItems(row.id).map((item) => ({
      foodItemId: item.food_item_id,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.unit_price,
    })),
  })));
}

export function updateOrderStatus(id: number, nextStatus: string) {
  const current = campusDb.prepare("SELECT status FROM orders WHERE id = ?").get(id) as
    | { status: string }
    | undefined;
  if (!current) return { kind: "missing" as const };
  const allowed: Record<string, string[]> = {
    PLACED: ["ACCEPTED", "REJECTED", "CANCELLED"],
    ACCEPTED: ["PREPARING", "REJECTED", "CANCELLED"],
    PREPARING: ["READY"],
    READY: ["COMPLETED"],
  };
  if (!allowed[current.status]?.includes(nextStatus)) {
    return { kind: "invalid" as const, currentStatus: current.status };
  }
  campusDb.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?")
    .run(nextStatus, new Date().toISOString(), id);
  const order = getOrderById(id);
  return order ? { kind: "updated" as const, order } : { kind: "missing" as const };
}

export function dashboardData() {
  const today = businessDate();
  const row = campusDb.prepare(`
    SELECT
      COUNT(*) AS today_orders,
      SUM(CASE WHEN status = 'PLACED' THEN 1 ELSE 0 END) AS pending_orders,
      SUM(CASE WHEN status = 'PREPARING' THEN 1 ELSE 0 END) AS preparing_orders,
      SUM(CASE WHEN status = 'READY' THEN 1 ELSE 0 END) AS ready_orders,
      SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) AS completed_orders,
      COALESCE(SUM(CASE WHEN status NOT IN ('CANCELLED', 'REJECTED') THEN total_amount ELSE 0 END), 0) AS revenue_today
    FROM orders WHERE token_date = ?
  `).get(today) as Record<string, number | null>;
  return GetAdminDashboardResponse.parse({
    todayOrders: row.today_orders ?? 0,
    pendingOrders: row.pending_orders ?? 0,
    preparingOrders: row.preparing_orders ?? 0,
    readyOrders: row.ready_orders ?? 0,
    completedOrders: row.completed_orders ?? 0,
    revenueToday: row.revenue_today ?? 0,
    activeTokens: activeDisplayOrders(),
  });
}

export function analyticsData() {
  const today = businessDate();
  const weekStart = businessDate(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000));
  const totals = campusDb.prepare(`
    SELECT
      COUNT(CASE WHEN token_date = ? THEN 1 END) AS total_today,
      COALESCE(SUM(CASE WHEN token_date = ? AND status NOT IN ('CANCELLED', 'REJECTED') THEN total_amount ELSE 0 END), 0) AS revenue_today,
      COUNT(CASE WHEN token_date >= ? THEN 1 END) AS week_orders,
      COALESCE(AVG(CASE WHEN token_date = ? AND status NOT IN ('CANCELLED', 'REJECTED') THEN total_amount END), 0) AS average_order_value
    FROM orders
  `).get(today, today, weekStart, today) as Record<string, number | null>;
  const bestSellers = campusDb.prepare(`
    SELECT order_items.name, SUM(order_items.quantity) AS quantity
    FROM order_items JOIN orders ON orders.id = order_items.order_id
    WHERE orders.token_date = ? AND orders.status NOT IN ('CANCELLED', 'REJECTED')
    GROUP BY order_items.name
    ORDER BY quantity DESC, order_items.name COLLATE NOCASE
    LIMIT 5
  `).all(today) as Array<{ name: string; quantity: number }>;
  const categories = campusDb.prepare(`
    SELECT order_items.category AS category, COUNT(DISTINCT orders.id) AS orders
    FROM order_items JOIN orders ON orders.id = order_items.order_id
    WHERE orders.token_date = ? AND orders.status NOT IN ('CANCELLED', 'REJECTED')
    GROUP BY order_items.category ORDER BY orders DESC
  `).all(today) as Array<{ category: string; orders: number }>;
  return GetAnalyticsResponse.parse({
    totalOrdersToday: totals.total_today ?? 0,
    revenueToday: totals.revenue_today ?? 0,
    ordersThisWeek: totals.week_orders ?? 0,
    averageOrderValue: totals.average_order_value ?? 0,
    bestSellingItems: bestSellers,
    ordersByCategory: categories.map((item) => ({
      category: item.category,
      orders: item.orders,
    })),
  });
}
