import { db, now } from "./index.js";

export type AuditAction =
  | "long"
  | "short"
  | "limit"
  | "close"
  | "cancel"
  | "cancel_all"
  | "link"
  | "unlink";

export type AuditStatus = "ok" | "error" | "rejected" | "pending_confirm";

export interface AuditEntry {
  telegram_id: number;
  action: AuditAction;
  symbol?: string;
  side?: "long" | "short";
  size?: string;
  price?: string;
  order_id?: string;
  tx_sig?: string;
  status: AuditStatus;
  error?: string;
  raw?: unknown;
}

const insertStmt = db.prepare<
  [
    number,
    string,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string,
    string | null,
    string | null,
    number,
  ]
>(`
  INSERT INTO audit_log (telegram_id, action, symbol, side, size, price, order_id, tx_sig, status, error, raw, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

export function record(entry: AuditEntry): void {
  insertStmt.run(
    entry.telegram_id,
    entry.action,
    entry.symbol ?? null,
    entry.side ?? null,
    entry.size ?? null,
    entry.price ?? null,
    entry.order_id ?? null,
    entry.tx_sig ?? null,
    entry.status,
    entry.error ?? null,
    entry.raw ? JSON.stringify(entry.raw) : null,
    now()
  );
}

const recentStmt = db.prepare<[number, number]>(`
  SELECT * FROM audit_log WHERE telegram_id = ? ORDER BY created_at DESC LIMIT ?
`);
export function recent(telegramId: number, limit = 20): unknown[] {
  return recentStmt.all(telegramId, limit) as unknown[];
}
