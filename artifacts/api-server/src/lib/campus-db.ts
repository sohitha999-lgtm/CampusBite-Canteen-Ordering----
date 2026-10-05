import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const dbPath = resolve(
  process.env.CAMPUSBITE_DB_PATH ?? ".data/campusbite.sqlite",
);
mkdirSync(dirname(dbPath), { recursive: true });

export const campusDb = new DatabaseSync(dbPath);
campusDb.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    phone TEXT,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('CUSTOMER', 'ADMIN')),
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS food_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    price REAL NOT NULL CHECK (price >= 0),
    category TEXT NOT NULL,
    image_url TEXT,
    is_vegetarian INTEGER NOT NULL DEFAULT 1,
    available INTEGER NOT NULL DEFAULT 1,
    popular INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS daily_token_counters (
    token_date TEXT PRIMARY KEY,
    last_token_number INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_number TEXT NOT NULL UNIQUE,
    token_number INTEGER NOT NULL,
    token_date TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    total_amount REAL NOT NULL,
    status TEXT NOT NULL CHECK (
      status IN ('PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED', 'REJECTED')
    ),
    pickup_time TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(token_date, token_number)
  );
  CREATE INDEX IF NOT EXISTS orders_date_idx ON orders(token_date, created_at);
  CREATE INDEX IF NOT EXISTS orders_user_idx ON orders(user_id, created_at);
  CREATE INDEX IF NOT EXISTS orders_status_idx ON orders(status, token_date);

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    food_item_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price REAL NOT NULL CHECK (unit_price >= 0),
    category TEXT NOT NULL
  );
`);

const menuCount = campusDb
  .prepare("SELECT COUNT(*) AS count FROM food_items")
  .get() as { count: number };

if (menuCount.count === 0) {
  const now = new Date().toISOString();
  const seedItems = [
    ["Veg Burger", "Crispy veggie patty, lettuce, and house sauce.", 60, "Fast Food", "photo-1568901346375-23c9450c58cd", 1, 1],
    ["Cheese Burger", "Beef patty, melted cheese, and house sauce, made fresh to order.", 80, "Fast Food", "photo-1550547660-d9450f859349", 0, 1],
    ["Veg Pizza", "Stone-baked pizza with garden vegetables.", 100, "Fast Food", "photo-1579751626657-72bc17010498", 1, 0],
    ["Grilled Sandwich", "Toasted sandwich layered with fresh vegetables.", 50, "Snacks", "photo-1528735602780-2552fd46c7af", 1, 0],
    ["French Fries", "Golden, salted fries served hot.", 50, "Snacks", "photo-1573080496219-bb080dd4f877", 1, 0],
    ["Samosa", "Flaky pastry filled with spiced potato.", 20, "Snacks", "photo-1601050690597-df0568f70950", 1, 0],
    ["Masala Dosa", "Crisp dosa with spiced potato and chutneys.", 60, "Breakfast", "photo-1668236543090-82eba5ee5976", 1, 1],
    ["Veg Fried Rice", "Wok-tossed rice with vegetables and herbs.", 90, "Meals", "photo-1603133872878-684f208fb84b", 1, 0],
    ["Coffee", "Freshly brewed coffee, hot and comforting.", 30, "Drinks", "photo-1509042239860-f550ce710b93", 1, 0],
    ["Fresh Juice", "Chilled seasonal fruit juice.", 40, "Drinks", "photo-1622597467836-f3285f2131b8", 1, 0],
    ["Chocolate Brownie", "A soft, rich chocolate brownie baked for a sweet break.", 45, "Desserts", "photo-1606313564200-e75d5e30476c", 1, 0],
  ] as const;

  const insert = campusDb.prepare(`
    INSERT INTO food_items
      (name, description, price, category, image_url, is_vegetarian, available, popular, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  campusDb.exec("BEGIN IMMEDIATE");
  try {
    for (const [name, description, price, category, imageId, vegetarian, popular] of seedItems) {
      insert.run(
        name,
        description,
        price,
        category,
        `https://images.unsplash.com/${imageId}?auto=format&fit=crop&w=900&q=85`,
        vegetarian,
        1,
        popular,
        now,
        now,
      );
    }
    campusDb.exec("COMMIT");
  } catch (error) {
    campusDb.exec("ROLLBACK");
    throw error;
  }
}
