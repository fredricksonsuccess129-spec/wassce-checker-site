CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER NOT NULL,
  currency TEXT DEFAULT 'GHS',
  sku TEXT
);

CREATE TABLE IF NOT EXISTS codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL,
  code TEXT NOT NULL UNIQUE,
  sold INTEGER DEFAULT 0,
  sold_at DATETIME,
  order_id TEXT,
  buyer_email TEXT,
  FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT UNIQUE,
  stripe_session_id TEXT,
  product_id INTEGER,
  amount_cents INTEGER,
  currency TEXT,
  buyer_email TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  fulfilled INTEGER DEFAULT 0
);
