import { db, now } from "./index.js";

const getStmt = db.prepare<[number, string]>(`
  SELECT window_start, count FROM rate_limits WHERE telegram_id = ? AND bucket = ?
`);

const upsertStmt = db.prepare<[number, string, number]>(`
  INSERT INTO rate_limits (telegram_id, bucket, window_start, count) VALUES (?, ?, ?, 1)
  ON CONFLICT(telegram_id, bucket) DO UPDATE SET window_start = excluded.window_start, count = 1
`);

const incStmt = db.prepare<[number, string]>(`
  UPDATE rate_limits SET count = count + 1 WHERE telegram_id = ? AND bucket = ?
`);

export function tryConsume(telegramId: number, bucket: string, limit: number, windowSec: number): boolean {
  const t = now();
  const row = getStmt.get(telegramId, bucket) as { window_start: number; count: number } | undefined;
  if (!row || t - row.window_start >= windowSec) {
    upsertStmt.run(telegramId, bucket, t);
    return true;
  }
  if (row.count >= limit) return false;
  incStmt.run(telegramId, bucket);
  return true;
}
