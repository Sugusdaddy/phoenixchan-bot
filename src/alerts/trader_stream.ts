import type { Bot } from "grammy";
import type {
  TraderStateSubaccountSnapshot,
  TraderStateSubaccountDelta,
  TraderStateTradeHistoryDelta,
  TraderStatePositionSnapshot,
} from "@ellipsis-labs/rise";
import { db } from "../db/index.js";
import { logger } from "../logger.js";
import { fmtUsd, bold, code } from "../bot/format.js";

interface RegisteredUser {
  telegram_id: number;
  trader_authority: string;
}

interface UserState {
  collateral: number | null;
  posBaseQty: Map<string, number>;
}

const USDC_DECIMALS = 6;

function listRegisteredUsers(): RegisteredUser[] {
  return db
    .prepare(
      `SELECT telegram_id, trader_authority FROM users
       WHERE trader_authority IS NOT NULL AND registered_at IS NOT NULL`
    )
    .all() as RegisteredUser[];
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

function applySnapshot(state: UserState, sub: TraderStateSubaccountSnapshot): void {
  const col = toNum(sub.collateral);
  state.collateral = col !== null ? col / 10 ** USDC_DECIMALS : null;
  state.posBaseQty.clear();
  for (const p of sub.positions as TraderStatePositionSnapshot[]) {
    const qty = toNum(p.basePositionUnits) ?? toNum(p.basePositionLots) ?? 0;
    if (Math.abs(qty) > 1e-12) state.posBaseQty.set(p.symbol, qty);
  }
}

function applyDelta(state: UserState, delta: TraderStateSubaccountDelta): void {
  const col = toNum(delta.collateral);
  if (col !== null) state.collateral = col / 10 ** USDC_DECIMALS;
  for (const pd of delta.positions) {
    if (pd.change === "closed" || !pd.position) {
      state.posBaseQty.delete(pd.symbol);
      continue;
    }
    const qty =
      toNum(pd.position.basePositionUnits) ?? toNum(pd.position.basePositionLots) ?? 0;
    if (Math.abs(qty) < 1e-12) state.posBaseQty.delete(pd.symbol);
    else state.posBaseQty.set(pd.symbol, qty);
  }
}

async function notifyFills(
  bot: Bot,
  telegramId: number,
  fills: TraderStateTradeHistoryDelta[]
): Promise<void> {
  for (const f of fills) {
    const liq = f.tradeType === "liquidation";
    const sideHuman = f.liquidity === "maker" ? "MAKER" : "TAKER";
    const realized = parseFloat(f.realizedPnl ?? "0");
    const realizedStr =
      Math.abs(realized) > 1e-9
        ? `   PnL: ${realized >= 0 ? "+" : ""}${fmtUsd(realized)}`
        : "";
    const head = liq ? "🔥 LIQUIDATED" : "✅ Fill";
    const msg = [
      `${bold(head)} ${f.market}`,
      `${sideHuman} ${f.tradeType.toUpperCase()}  size ${f.size} @ ${fmtUsd(parseFloat(f.price))}${realizedStr}`,
      ...(f.signature ? [`Tx: ${code(f.signature.slice(0, 16))}…`] : []),
    ].join("\n");
    try {
      await bot.api.sendMessage(telegramId, msg, { parse_mode: "HTML" });
    } catch (e) {
      logger.warn({ err: (e as Error).message, telegramId }, "fill notify failed");
    }
  }
}

function notifyCollateralDrop(
  bot: Bot,
  telegramId: number,
  before: number | null,
  after: number | null
): void {
  if (before === null || after === null) return;
  if (before <= 0) return;
  const dropPct = (before - after) / before;
  if (dropPct < 0.3) return;
  bot.api
    .sendMessage(
      telegramId,
      `⚠️ <b>Collateral dropped sharply</b>\n${fmtUsd(before)} → ${fmtUsd(after)} (${(dropPct * 100).toFixed(1)}% down)\nCheck /pos and /balance.`,
      { parse_mode: "HTML" }
    )
    .catch(() => {});
}

export function startTraderStreams(bot: Bot, getClient: () => unknown): () => void {
  const controllers = new Map<number, AbortController>();
  const states = new Map<number, UserState>();

  const subscribe = (u: RegisteredUser): void => {
    if (controllers.has(u.telegram_id)) return;
    const ac = new AbortController();
    controllers.set(u.telegram_id, ac);
    states.set(u.telegram_id, { collateral: null, posBaseQty: new Map() });

    (async () => {
      const client = getClient() as {
        streams?: {
          traderState?: (
            authority: string,
            traderPdaIndex: number,
            signal?: AbortSignal
          ) => AsyncIterable<{
            authority: string;
            traderPdaIndex: number;
            messageType: "snapshot" | "delta";
            subaccounts: TraderStateSubaccountSnapshot[];
            deltas: TraderStateSubaccountDelta[];
          }>;
        };
      };
      const port = client.streams?.traderState;
      if (!port) {
        logger.warn({ telegramId: u.telegram_id }, "traderState stream unavailable");
        return;
      }
      try {
        logger.info(
          { telegramId: u.telegram_id, authority: u.trader_authority },
          "subscribing trader state stream"
        );
        for await (const update of port(u.trader_authority, 0, ac.signal)) {
          const state = states.get(u.telegram_id);
          if (!state) break;

          if (update.messageType === "snapshot") {
            const sub0 = update.subaccounts[0];
            if (sub0) applySnapshot(state, sub0);
            continue;
          }

          const delta0 = update.deltas[0];
          if (!delta0) continue;

          const before = state.collateral;
          applyDelta(state, delta0);
          notifyCollateralDrop(bot, u.telegram_id, before, state.collateral);

          if (delta0.tradeHistory && delta0.tradeHistory.length > 0) {
            await notifyFills(bot, u.telegram_id, delta0.tradeHistory);
          }
        }
      } catch (e) {
        if (!ac.signal.aborted) {
          logger.warn(
            { telegramId: u.telegram_id, err: (e as Error).message },
            "trader state stream ended"
          );
        }
      }
    })();
  };

  const refresh = (): void => {
    const users = listRegisteredUsers();
    const active = new Set(users.map((u) => u.telegram_id));
    for (const [tid, ac] of controllers) {
      if (!active.has(tid)) {
        ac.abort();
        controllers.delete(tid);
        states.delete(tid);
      }
    }
    for (const u of users) subscribe(u);
  };

  refresh();
  const interval = setInterval(refresh, 30_000);

  return () => {
    clearInterval(interval);
    for (const ac of controllers.values()) ac.abort();
    controllers.clear();
    states.clear();
  };
}
