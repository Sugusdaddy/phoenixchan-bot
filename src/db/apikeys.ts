import { db, now } from "./index.js";

export function setEncryptedApiKey(telegramId: number, encrypted: Buffer): void {
  db.prepare(
    `UPDATE users SET encrypted_api_key = ?, updated_at = ? WHERE telegram_id = ?`
  ).run(encrypted, now(), telegramId);
}

export function getEncryptedApiKey(telegramId: number): Buffer | null {
  const row = db
    .prepare(`SELECT encrypted_api_key FROM users WHERE telegram_id = ?`)
    .get(telegramId) as { encrypted_api_key: Buffer | null } | undefined;
  return row?.encrypted_api_key ?? null;
}

export function clearApiKey(telegramId: number): void {
  db.prepare(
    `UPDATE users SET encrypted_api_key = NULL, updated_at = ? WHERE telegram_id = ?`
  ).run(now(), telegramId);
}

export function hasApiKey(telegramId: number): boolean {
  return getEncryptedApiKey(telegramId) !== null;
}
