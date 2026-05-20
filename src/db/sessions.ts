import { db, now } from "./index.js";

const setStmt = db.prepare<[number, string, string | null, number]>(`
  INSERT INTO sessions (telegram_id, state, payload, expires_at) VALUES (?, ?, ?, ?)
  ON CONFLICT(telegram_id) DO UPDATE SET state = excluded.state, payload = excluded.payload, expires_at = excluded.expires_at
`);

const getStmt = db.prepare<number>(`SELECT * FROM sessions WHERE telegram_id = ?`);
const clearStmt = db.prepare<number>(`DELETE FROM sessions WHERE telegram_id = ?`);

export function setPendingConfirm(telegramId: number, payload: unknown, ttlSec = 60): void {
  setStmt.run(telegramId, "confirm_trade", JSON.stringify(payload), now() + ttlSec);
}

export function takePendingConfirm<T = unknown>(telegramId: number): T | null {
  const row = getStmt.get(telegramId) as
    | { state: string; payload: string | null; expires_at: number }
    | undefined;
  if (!row) return null;
  clearStmt.run(telegramId);
  if (row.state !== "confirm_trade") return null;
  if (row.expires_at < now()) return null;
  return row.payload ? (JSON.parse(row.payload) as T) : null;
}

export function clear(telegramId: number): void {
  clearStmt.run(telegramId);
}
