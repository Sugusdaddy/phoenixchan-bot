import { Bot } from "grammy";
import { config } from "./config.js";
import { logger } from "./logger.js";
import "./db/index.js";

import { ensureUser, requireLinked, requireTos, requireRegistered } from "./bot/middleware/auth.js";
import { rateLimit } from "./bot/middleware/ratelimit.js";

import { startCmd } from "./bot/commands/start.js";
import { statusCmd } from "./bot/commands/status.js";
import { tosCmd, onTosCallback } from "./bot/commands/tos.js";
import { unlinkCmd } from "./bot/commands/unlink.js";
import { helpCmd } from "./bot/commands/help.js";
import { setWithdrawCmd } from "./bot/commands/setwithdraw.js";
import { depositCmd } from "./bot/commands/deposit.js";
import { withdrawCmd } from "./bot/commands/withdraw.js";
import { registerCmd } from "./bot/commands/register.js";
import { priceCmd, marketsCmd } from "./bot/commands/price.js";
import { posCmd, balanceCmd } from "./bot/commands/pos.js";
import { ordersCmd } from "./bot/commands/orders.js";
import { pnlCmd, fundingCmd } from "./bot/commands/pnl.js";
import {
  longCmd,
  shortCmd,
  limitCmd,
  closeCmd,
  cancelCmd,
  cancelAllCmd,
  onConfirmCallback,
} from "./bot/commands/trade.js";
import { confirmCmd, maxNotionalCmd } from "./bot/commands/settings.js";
import { alertCmd, alertsCmd, delAlertCmd } from "./bot/commands/alerts.js";
import { startAlertEngine } from "./alerts/engine.js";
import { disposeAll } from "./phoenix/clients.js";
import { closeWs } from "./phoenix/ws.js";

const bot = new Bot(config.TELEGRAM_BOT_TOKEN);

bot.use(ensureUser);

// Setup
bot.command("start", startCmd);
bot.command("help", helpCmd);
bot.command("tos", tosCmd);
bot.command("status", statusCmd);
bot.command("setwithdraw", setWithdrawCmd);
bot.command("deposit", depositCmd);
bot.command("withdraw", requireLinked, requireRegistered, withdrawCmd);
bot.command("register", registerCmd);
bot.command("unlink", unlinkCmd);
bot.command("confirm", confirmCmd);
bot.command("maxnotional", maxNotionalCmd);

// Market data (public)
bot.command("price", priceCmd);
bot.command("markets", marketsCmd);

// Account (requires registered)
bot.command("pos", requireLinked, requireRegistered, posCmd);
bot.command("balance", requireLinked, requireRegistered, balanceCmd);
bot.command("orders", requireLinked, requireRegistered, ordersCmd);
bot.command("pnl", requireLinked, requireRegistered, pnlCmd);
bot.command("funding", requireLinked, fundingCmd);

// Trading (requires registered + tos + rate limit)
const tradeMw = [requireLinked, requireRegistered, requireTos, rateLimit("trades")] as const;
bot.command("long", ...tradeMw, longCmd);
bot.command("short", ...tradeMw, shortCmd);
bot.command("limit", ...tradeMw, limitCmd);
bot.command("close", ...tradeMw, closeCmd);
bot.command("cancel", requireLinked, requireRegistered, requireTos, cancelCmd);
bot.command("cancelall", requireLinked, requireRegistered, requireTos, cancelAllCmd);

// Alerts
bot.command("alert", requireLinked, alertCmd);
bot.command("alerts", requireLinked, alertsCmd);
bot.command("delalert", requireLinked, delAlertCmd);

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (data?.startsWith("tos:")) return onTosCallback(ctx);
  if (data?.startsWith("confirm:")) return onConfirmCallback(ctx);
});

bot.catch((err) => {
  logger.error({ err: err.error, update: err.ctx.update.update_id }, "bot handler error");
});

async function main() {
  await bot.api.setMyCommands([
    { command: "start", description: "Create your trading wallet" },
    { command: "help", description: "List all commands" },
    { command: "register", description: "Register with Phoenix (access code)" },
    { command: "tos", description: "Accept terms of use" },
    { command: "status", description: "Show account status" },
    { command: "deposit", description: "Deposit address or credit collateral" },
    { command: "withdraw", description: "Withdraw USDC to your address" },
    { command: "price", description: "Market price (mid/bid/ask)" },
    { command: "pos", description: "Open positions" },
    { command: "orders", description: "Open orders" },
    { command: "balance", description: "Collateral and margin" },
    { command: "pnl", description: "Realized PnL window" },
    { command: "long", description: "Market long" },
    { command: "short", description: "Market short" },
    { command: "limit", description: "Limit order" },
    { command: "close", description: "Close position" },
    { command: "cancel", description: "Cancel an order" },
    { command: "cancelall", description: "Cancel all orders for a symbol" },
    { command: "alert", description: "Create a price alert" },
    { command: "alerts", description: "List active alerts" },
  ]);

  startAlertEngine(bot);

  logger.info("bot starting");
  await bot.start({
    onStart: (me) => logger.info({ username: me.username }, "bot online"),
  });
}

async function shutdown() {
  logger.info("shutting down");
  await bot.stop();
  closeWs();
  disposeAll();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

main().catch((e) => {
  logger.fatal({ err: e }, "fatal");
  process.exit(1);
});
