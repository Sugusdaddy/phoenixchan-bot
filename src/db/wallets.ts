import { db, now } from "./index.js";

const updateStmt = db.prepare<[string, Buffer, number, number]>(`
  UPDATE users SET trader_authority = ?, encrypted_secret = ?, linked_at = ?, updated_at = ? WHERE telegram_id = ?
`);

export function setEmbeddedWallet(
  telegramId: number,
  authority: string,
  encryptedSecret: Buffer
): void {
  const t = now();
  db.prepare(
    `UPDATE users SET trader_authority = ?, encrypted_secret = ?, linked_at = ?, updated_at = ? WHERE telegram_id = ?`
  ).run(authority, encryptedSecret, t, t, telegramId);
}

export function getEncryptedSecret(telegramId: number): Buffer | null {
  const row = db
    .prepare(`SELECT encrypted_secret FROM users WHERE telegram_id = ?`)
    .get(telegramId) as { encrypted_secret: Buffer | null } | undefined;
  return row?.encrypted_secret ?? null;
}

export function setWithdrawAddress(telegramId: number, addr: string): void {
  db.prepare(
    `UPDATE users SET withdraw_address = ?, updated_at = ? WHERE telegram_id = ?`
  ).run(addr, now(), telegramId);
}

export function acceptTos(telegramId: number): void {
  db.prepare(
    `UPDATE users SET tos_accepted_at = ?, updated_at = ? WHERE telegram_id = ?`
  ).run(now(), now(), telegramId);
}
