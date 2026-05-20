import { db } from "./index.js";

export interface BotStats {
  walletsCreated: number;
  registered: number;
  withDeposits: number;
  totalTrades: number;
  trades24h: number;
  uniqueTraders24h: number;
}

export function getStats(): BotStats {
  const oneDayAgo = Math.floor(Date.now() / 1000) - 86400;

  const wallets = db
    .prepare(`SELECT COUNT(*) as n FROM users WHERE trader_authority IS NOT NULL`)
    .get() as { n: number };
  const registered = db
    .prepare(`SELECT COUNT(*) as n FROM users WHERE registered_at IS NOT NULL`)
    .get() as { n: number };
  const withDeposits = db
    .prepare(
      `SELECT COUNT(DISTINCT telegram_id) as n FROM audit_log
       WHERE status = 'ok' AND action IN ('long','short','limit')`
    )
    .get() as { n: number };
  const totalTrades = db
    .prepare(
      `SELECT COUNT(*) as n FROM audit_log
       WHERE status = 'ok' AND action IN ('long','short','limit','close')`
    )
    .get() as { n: number };
  const trades24h = db
    .prepare(
      `SELECT COUNT(*) as n FROM audit_log
       WHERE status = 'ok' AND action IN ('long','short','limit','close')
         AND created_at >= ?`
    )
    .get(oneDayAgo) as { n: number };
  const unique24h = db
    .prepare(
      `SELECT COUNT(DISTINCT telegram_id) as n FROM audit_log
       WHERE status = 'ok' AND created_at >= ?`
    )
    .get(oneDayAgo) as { n: number };

  return {
    walletsCreated: wallets.n,
    registered: registered.n,
    withDeposits: withDeposits.n,
    totalTrades: totalTrades.n,
    trades24h: trades24h.n,
    uniqueTraders24h: unique24h.n,
  };
}
