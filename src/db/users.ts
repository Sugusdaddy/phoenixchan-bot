import { db, now } from "./index.js";

export interface User {
  telegram_id: number;
  username: string | null;
  trader_authority: string | null;
  encrypted_secret: Buffer | null;
  encrypted_api_key: Buffer | null;
  withdraw_address: string | null;
  linked_at: number | null;
  registered_at: number | null;
  trader_pda: string | null;
  invite_code: string | null;
  confirm_trades: number;
  max_notional: number | null;
  tos_accepted_at: number | null;
  created_at: number;
  updated_at: number;
}

export function markRegistered(telegramId: number, traderPda: string, code: string): void {
  const t = Math.floor(Date.now() / 1000);
  db.prepare(
    `UPDATE users SET registered_at = ?, trader_pda = ?, invite_code = ?, updated_at = ? WHERE telegram_id = ?`
  ).run(t, traderPda, code, t, telegramId);
}

const upsertStmt = db.prepare<
  [number, string | null, number, number]
>(`
  INSERT INTO users (telegram_id, username, confirm_trades, created_at, updated_at)
  VALUES (?, ?, 1, ?, ?)
  ON CONFLICT(telegram_id) DO UPDATE SET
    username = excluded.username,
    updated_at = excluded.updated_at
`);

export function upsertUser(telegramId: number, username: string | null): void {
  const t = now();
  upsertStmt.run(telegramId, username, t, t);
}

const getStmt = db.prepare<number>(`SELECT * FROM users WHERE telegram_id = ?`);
export function getUser(telegramId: number): User | undefined {
  return getStmt.get(telegramId) as User | undefined;
}

const linkStmt = db.prepare<[string, number, number, number]>(`
  UPDATE users SET trader_authority = ?, linked_at = ?, updated_at = ? WHERE telegram_id = ?
`);
export function linkTrader(telegramId: number, traderAuthority: string): void {
  const t = now();
  linkStmt.run(traderAuthority, t, t, telegramId);
}

const unlinkStmt = db.prepare<[number, number]>(`
  UPDATE users SET trader_authority = NULL, linked_at = NULL, updated_at = ? WHERE telegram_id = ?
`);
export function unlinkTrader(telegramId: number): void {
  unlinkStmt.run(now(), telegramId);
}

const setConfirmStmt = db.prepare<[number, number, number]>(`
  UPDATE users SET confirm_trades = ?, updated_at = ? WHERE telegram_id = ?
`);
export function setConfirm(telegramId: number, confirm: boolean): void {
  setConfirmStmt.run(confirm ? 1 : 0, now(), telegramId);
}

const setMaxNotionalStmt = db.prepare<[number | null, number, number]>(`
  UPDATE users SET max_notional = ?, updated_at = ? WHERE telegram_id = ?
`);
export function setMaxNotional(telegramId: number, max: number | null): void {
  setMaxNotionalStmt.run(max, now(), telegramId);
}

const findByTraderStmt = db.prepare<string>(`SELECT * FROM users WHERE trader_authority = ?`);
export function findByTrader(traderAuthority: string): User | undefined {
  return findByTraderStmt.get(traderAuthority) as User | undefined;
}
