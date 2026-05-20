import Database from "better-sqlite3";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { logger } from "../logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

mkdirSync(dirname(resolve(config.DATABASE_PATH)), { recursive: true });

export const db = new Database(config.DATABASE_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schemaPath = resolve(__dirname, "schema.sql");
const schema = readFileSync(schemaPath, "utf8");
db.exec(schema);

const cols = db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
const has = (name: string) => cols.some((c) => c.name === name);
if (!has("encrypted_api_key")) db.exec(`ALTER TABLE users ADD COLUMN encrypted_api_key BLOB`);
if (!has("registered_at")) db.exec(`ALTER TABLE users ADD COLUMN registered_at INTEGER`);
if (!has("trader_pda")) db.exec(`ALTER TABLE users ADD COLUMN trader_pda TEXT`);
if (!has("invite_code")) db.exec(`ALTER TABLE users ADD COLUMN invite_code TEXT`);

logger.info({ path: config.DATABASE_PATH }, "database ready");

export function now(): number {
  return Math.floor(Date.now() / 1000);
}
