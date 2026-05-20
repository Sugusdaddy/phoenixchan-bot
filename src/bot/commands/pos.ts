import type { CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { getUser } from "../../db/users.js";
import { getAccountSummary } from "../../phoenix/trader.js";
import { getClientForUser } from "../../phoenix/clients.js";
import { placeMarket } from "../../phoenix/trade.js";
import { record } from "../../db/audit.js";
import { bold, fmtNum, fmtPct, fmtUsd, solscanLink, code } from "../format.js";
import { logger } from "../../logger.js";

function pnlStr(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n >= 0 ? `+${fmtUsd(n)}` : fmtUsd(n);
}

function posKeyboard(symbol: string): InlineKeyboard {
  const safe = encodeURIComponent(symbol);
  return new InlineKeyboard()
    .text("Close 25%", `pos:close:${safe}:25`)
    .text("50%", `pos:close:${safe}:50`)
    .text("100%", `pos:close:${safe}:100`)
    .row()
    .text("🎯 +TP", `pos:tp:${safe}`)
    .text("🛑 +SL", `pos:sl:${safe}`)
    .text("🔄 Refresh", `pos:refresh`);
}

export async function posCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) return void ctx.reply("No wallet linked. Run /start.");
  try {
    const client = await getClientForUser(ctx.from.id);
    const acct = await getAccountSummary(client, user.trader_authority);
    if (acct.positions.length === 0) {
      await ctx.reply(
        `No open positions.\nCollateral: ${fmtUsd(acct.collateralUsd)}`,
        { parse_mode: "HTML" }
      );
      return;
    }
    for (const p of acct.positions) {
      const lines = [
        `${bold(p.symbol)} ${p.side === "long" ? "🟢 LONG" : "🔴 SHORT"}`,
        `Size: ${fmtNum(p.baseQty, 6)}`,
        `Entry: ${fmtUsd(p.entryPrice)}   Mark: ${fmtUsd(p.markPrice)}`,
        `uPnL: ${pnlStr(p.unrealizedPnl)}`,
      ];
      await ctx.reply(lines.join("\n"), {
        parse_mode: "HTML",
        reply_markup: posKeyboard(p.symbol),
      });
    }
    await ctx.reply(
      [
        `${bold("Account")}`,
        `Collateral: ${fmtUsd(acct.collateralUsd)}   Total uPnL: ${pnlStr(acct.totalUnrealizedPnl)}`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  } catch (e) {
    await ctx.reply((e as Error).message);
  }
}

export async function balanceCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) return void ctx.reply("No wallet linked. Run /start.");
  try {
    const client = await getClientForUser(ctx.from.id);
    const acct = await getAccountSummary(client, user.trader_authority);
    const equity =
      acct.collateralUsd !== null
        ? acct.collateralUsd + (acct.totalUnrealizedPnl ?? 0)
        : null;
    await ctx.reply(
      [
        `${bold("Balance")}`,
        `Collateral: ${fmtUsd(acct.collateralUsd)}`,
        `Unrealized PnL: ${pnlStr(acct.totalUnrealizedPnl)}`,
        `Equity: ${fmtUsd(equity)}`,
        `Open positions: ${acct.positions.length}`,
        `Open orders: ${acct.openOrders.length}`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  } catch (e) {
    await ctx.reply((e as Error).message);
  }
}

export async function onPosCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!ctx.from || !data?.startsWith("pos:")) return;
  await ctx.answerCallbackQuery();
  const [, action, symbolEnc, pctRaw] = data.split(":");

  if (action === "refresh") {
    await ctx.reply("Refreshing…");
    const fakeCtx = ctx as unknown as CommandContext<Context>;
    await posCmd(fakeCtx);
    return;
  }

  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) {
    await ctx.editMessageText("Wallet not linked.");
    return;
  }

  const symbol = symbolEnc ? decodeURIComponent(symbolEnc) : null;
  if (!symbol) return;

  if (action === "close") {
    const pct = Math.min(100, Math.max(1, parseInt(pctRaw ?? "100", 10)));
    try {
      const client = await getClientForUser(ctx.from.id);
      const acct = await getAccountSummary(client, user.trader_authority);
      const pos = acct.positions.find((p) => p.symbol === symbol);
      if (!pos) {
        await ctx.editMessageText(`No open position on ${symbol}.`);
        return;
      }
      const closeQty = (pos.baseQty * pct) / 100;
      const closeSide: "long" | "short" = pos.side === "long" ? "short" : "long";

      await ctx.editMessageText(`Closing ${pct}% of ${symbol}…`);
      const res = await placeMarket({
        telegramId: ctx.from.id,
        authority: user.trader_authority,
        symbol: pos.symbol,
        side: closeSide,
        baseUnits: closeQty.toFixed(6),
      });
      record({
        telegram_id: ctx.from.id,
        action: "close",
        symbol: pos.symbol,
        side: pos.side ?? undefined,
        size: closeQty.toFixed(6),
        tx_sig: res.txSig,
        status: "ok",
      });
      await ctx.editMessageText(
        [
          `${bold("Closed")} ${pos.symbol} ${pct}%`,
          `${closeSide.toUpperCase()} ${closeQty.toFixed(6)}`,
          `Tx: ${code(res.txSig.slice(0, 16))}…`,
          solscanLink(res.txSig),
        ].join("\n"),
        { parse_mode: "HTML" }
      );
    } catch (e) {
      logger.error({ err: e, symbol, pct }, "inline close failed");
      const msg = (e as Error).message.replace(/[<>&]/g, "");
      await ctx.editMessageText(`Close failed: ${msg}`);
    }
    return;
  }

  if (action === "tp") {
    await ctx.reply(
      `To set TP on ${symbol}, send:\n${code(`/tp ${symbol} [price]`)}\nExample: ${code(`/tp ${symbol} 160`)}`,
      { parse_mode: "HTML" }
    );
    return;
  }

  if (action === "sl") {
    await ctx.reply(
      `To set SL on ${symbol}, send:\n${code(`/sl ${symbol} [price]`)}\nExample: ${code(`/sl ${symbol} 130`)}`,
      { parse_mode: "HTML" }
    );
    return;
  }
}
