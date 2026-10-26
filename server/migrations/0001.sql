CREATE TABLE IF NOT EXISTS users (
  telegram_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS logins (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  poll_hash TEXT NOT NULL,
  device TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  telegram_id TEXT,
  approved INTEGER NOT NULL DEFAULT 0,
  consumed INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS logins_expiry ON logins(expires_at);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  telegram_id TEXT NOT NULL REFERENCES users(telegram_id),
  device TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS states (
  telegram_id TEXT PRIMARY KEY REFERENCES users(telegram_id),
  version INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
