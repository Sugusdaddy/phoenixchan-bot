import type { Bot } from "grammy";
import { logger } from "../logger.js";
import { getWs } from "../phoenix/ws.js";
import { getMarket, listSymbols } from "../phoenix/markets.js";
import { getBootstrapClient } from "../phoenix/clients.js";
import { activeAlerts, markTriggered, type PriceAlert } from "../db/alerts.js";
import { db } from "../db/index.js";
import { fmtUsd } from "../bot/format.js";
import { startTraderStreams } from "./trader_stream.js";

interface UserHandle {
  telegram_id: number;
}

const lastPrice = new Map<string, number>();

export function startAlertEngine(bot: Bot): void {
  startPricePoller(bot);
  startFillsSubscription(bot).catch((e) => logger.error({ err: e }, "fills subscription crashed"));
  startTraderStreams(bot, () => getBootstrapClient());
}

function startPricePoller(bot: Bot): void {
  const tick = async () => {
    try {
      const alerts = activeAlerts();
      if (alerts.length === 0) return;
      const symbols = [...new Set(alerts.map((a) => a.symbol))];
      const prices = new Map<string, number>();
      const client = getBootstrapClient();
      for (const s of symbols) {
        try {
          const m = await getMarket(client, s);
          if (m.mid !== null) prices.set(m.symbol, m.mid);
        } catch (e) {
          logger.warn({ symbol: s, err: (e as Error).message }, "price fetch failed");
        }
      }
      for (const a of alerts) {
        const px = prices.get(a.symbol);
        if (px === undefined) continue;
        if (hit(a, px)) {
          markTriggered(a.id);
          await bot.api
            .sendMessage(
              a.telegram_id,
              `Alert: ${a.symbol} ${a.op} ${fmtUsd(a.target)} — now ${fmtUsd(px)}`
            )
            .catch((e) => logger.warn({ err: e }, "alert send failed"));
        }
      }
    } catch (e) {
      logger.error({ err: e }, "price poller error");
    }
  };
  setInterval(() => void tick(), 10_000);
  void tick();
}

function hit(a: PriceAlert, px: number): boolean {
  return a.op === ">" ? px >= a.target : px <= a.target;
}

async function startFillsSubscription(bot: Bot): Promise<void> {
  const ws = getWs();
  let symbols: string[] = [];
  try {
    symbols = await listSymbols(getBootstrapClient());
  } catch (e) {
    logger.warn({ err: e }, "could not list symbols for fills subscription");
    return;
  }

  for (const sym of symbols) {
    (async () => {
      try {
        for await (const update of ws.fills(sym)) {
          await notifyFill(bot, update);
        }
      } catch (e) {
        logger.warn({ symbol: sym, err: (e as Error).message }, "fills stream ended");
      }
    })();
  }
}

async function notifyFill(bot: Bot, update: unknown): Promise<void> {
  const u = update as {
    fill?: {
      authority?: string;
      marketSymbol?: string;
      price?: string;
      baseQty?: string;
      side?: string;
      timestampMs?: number;
    };
  };
  const f = u.fill;
  if (!f?.authority) return;
  const userRow = db
    .prepare(`SELECT telegram_id FROM users WHERE trader_authority = ?`)
    .get(f.authority) as UserHandle | undefined;
  if (!userRow) return;
  const msg = `Fill ${f.marketSymbol} ${f.side ?? ""} ${f.baseQty ?? ""} @ ${f.price ?? "—"}`;
  await bot.api
    .sendMessage(userRow.telegram_id, msg)
    .catch((e) => logger.warn({ err: e }, "fill notify failed"));
}

export { lastPrice };
