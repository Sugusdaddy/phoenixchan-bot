PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  telegram_id        INTEGER PRIMARY KEY,
  username           TEXT,
  trader_authority   TEXT UNIQUE,
  encrypted_secret   BLOB,
  withdraw_address   TEXT,
  linked_at          INTEGER,
  registered_at      INTEGER,
  trader_pda         TEXT,
  invite_code        TEXT,
  confirm_trades     INTEGER NOT NULL DEFAULT 1,
  max_notional       REAL,
  tos_accepted_at    INTEGER,
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_trader ON users(trader_authority);

CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL,
  action      TEXT NOT NULL,
  symbol      TEXT,
  side        TEXT,
  size        TEXT,
  price       TEXT,
  order_id    TEXT,
  tx_sig      TEXT,
  status      TEXT NOT NULL,
  error       TEXT,
  raw         TEXT,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_log(telegram_id, created_at DESC);

CREATE TABLE IF NOT EXISTS price_alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER NOT NULL,
  symbol      TEXT NOT NULL,
  op          TEXT NOT NULL CHECK (op IN ('>', '<')),
  target      REAL NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  triggered_at INTEGER,
  created_at  INTEGER NOT NULL,
  FOREIGN KEY (telegram_id) REFERENCES users(telegram_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_alerts_active ON price_alerts(active, symbol);

CREATE TABLE IF NOT EXISTS rate_limits (
  telegram_id INTEGER NOT NULL,
  bucket      TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count       INTEGER NOT NULL,
  PRIMARY KEY (telegram_id, bucket)
);

CREATE TABLE IF NOT EXISTS sessions (
  telegram_id INTEGER PRIMARY KEY,
  state       TEXT NOT NULL,
  payload     TEXT,
  expires_at  INTEGER NOT NULL
);
