import { db, now } from "./index.js";

export interface PriceAlert {
  id: number;
  telegram_id: number;
  symbol: string;
  op: ">" | "<";
  target: number;
  active: number;
  triggered_at: number | null;
  created_at: number;
}

const insertStmt = db.prepare<[number, string, string, number, number]>(`
  INSERT INTO price_alerts (telegram_id, symbol, op, target, created_at) VALUES (?, ?, ?, ?, ?)
`);
export function createAlert(
  telegramId: number,
  symbol: string,
  op: ">" | "<",
  target: number
): number {
  const r = insertStmt.run(telegramId, symbol, op, target, now());
  return Number(r.lastInsertRowid);
}

const listStmt = db.prepare<number>(`
  SELECT * FROM price_alerts WHERE telegram_id = ? AND active = 1 ORDER BY id DESC
`);
export function listAlerts(telegramId: number): PriceAlert[] {
  return listStmt.all(telegramId) as PriceAlert[];
}

const deleteStmt = db.prepare<[number, number]>(`
  DELETE FROM price_alerts WHERE id = ? AND telegram_id = ?
`);
export function deleteAlert(id: number, telegramId: number): boolean {
  return deleteStmt.run(id, telegramId).changes > 0;
}

const activeAllStmt = db.prepare(`SELECT * FROM price_alerts WHERE active = 1`);
export function activeAlerts(): PriceAlert[] {
  return activeAllStmt.all() as PriceAlert[];
}

const markTriggeredStmt = db.prepare<[number, number]>(`
  UPDATE price_alerts SET active = 0, triggered_at = ? WHERE id = ?
`);
export function markTriggered(id: number): void {
  markTriggeredStmt.run(now(), id);
}
