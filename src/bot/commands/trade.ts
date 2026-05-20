import type { CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { z } from "zod";
import { getUser } from "../../db/users.js";
import { record } from "../../db/audit.js";
import { setPendingConfirm, takePendingConfirm } from "../../db/sessions.js";
import { placeMarket, placeLimit, cancelOrder, cancelAll } from "../../phoenix/trade.js";
import { getMarket } from "../../phoenix/markets.js";
import { getClientForUser } from "../../phoenix/clients.js";
import { config } from "../../config.js";
import { bold, code, fmtUsd, solscanLink } from "../format.js";
import { logger } from "../../logger.js";

const sideSchema = z.enum(["long", "short"]);
const symbolSchema = z.string().min(1).max(20);
const numStr = z.string().regex(/^\d+(\.\d+)?$/);

interface PendingTrade {
  kind: "market" | "limit";
  symbol: string;
  side: "long" | "short";
  notionalUsd: number;
  leverage: number;
  baseUnits: string;
  priceUsd?: string;
  tpUsd?: number;
  slUsd?: number;
}

function parseTradeArgs(parts: string[]): {
  positional: string[];
  tpUsd?: number;
  slUsd?: number;
} {
  const positional: string[] = [];
  let tpUsd: number | undefined;
  let slUsd: number | undefined;
  for (const p of parts) {
    const m = /^(tp|sl)=([\d.]+)$/i.exec(p);
    if (m) {
      const v = parseFloat(m[2]!);
      if (Number.isFinite(v) && v > 0) {
        if (m[1]!.toLowerCase() === "tp") tpUsd = v;
        else slUsd = v;
      }
    } else {
      positional.push(p);
    }
  }
  return { positional, tpUsd, slUsd };
}

async function notionalToBaseUnits(
  telegramId: number,
  symbol: string,
  notionalUsd: number,
  leverage: number,
  refPrice?: number
): Promise<{ baseUnits: string; markPrice: number }> {
  const client = await getClientForUser(telegramId);
  const m = await getMarket(client, symbol);
  const px = refPrice ?? m.mid;
  if (!px || px <= 0) throw new Error(`No mark price available for ${symbol}`);
  const notional = notionalUsd * leverage;
  const baseUnits = notional / px;
  return { baseUnits: baseUnits.toFixed(6), markPrice: px };
}

async function enforceLimits(telegramId: number, notionalUsd: number, leverage: number): Promise<void> {
  const user = getUser(telegramId);
  const cap = user?.max_notional ?? config.MAX_NOTIONAL_USDC;
  if (notionalUsd * leverage > cap) {
    throw new Error(`Notional ${fmtUsd(notionalUsd * leverage)} exceeds cap ${fmtUsd(cap)}`);
  }
  if (leverage < 1 || leverage > 50) throw new Error("Leverage must be 1–50");
}

function confirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text("Execute", "confirm:execute").text("Cancel", "confirm:cancel");
}

export async function longCmd(ctx: CommandContext<Context>): Promise<void> {
  await marketCmd(ctx, "long");
}
export async function shortCmd(ctx: CommandContext<Context>): Promise<void> {
  await marketCmd(ctx, "short");
}

async function marketCmd(ctx: CommandContext<Context>, side: "long" | "short"): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) return void ctx.reply("Run /start first.");
  if (!user.tos_accepted_at) return void ctx.reply("Accept terms with /tos first.");

  const rawParts = (ctx.match?.toString() ?? "").trim().split(/\s+/).filter(Boolean);
  const { positional: parts, tpUsd, slUsd } = parseTradeArgs(rawParts);
  if (parts.length < 2) {
    return void ctx.reply(
      `Usage: /${side} [symbol] [usdc] [leverage] [tp=price] [sl=price]\nExample: /${side} SOL 100 5 tp=160 sl=130`
    );
  }
  try {
    const symbol = symbolSchema.parse(parts[0]);
    const notional = parseFloat(numStr.parse(parts[1]!));
    const leverage = parts[2] ? parseFloat(numStr.parse(parts[2])) : 1;
    await enforceLimits(ctx.from.id, notional, leverage);

    const { baseUnits, markPrice } = await notionalToBaseUnits(ctx.from.id, symbol, notional, leverage);
    if (tpUsd !== undefined && slUsd !== undefined) {
      if (side === "long" && tpUsd <= slUsd) {
        return void ctx.reply("For a LONG: tp must be above sl.");
      }
      if (side === "short" && tpUsd >= slUsd) {
        return void ctx.reply("For a SHORT: tp must be below sl.");
      }
    }
    const pending: PendingTrade = {
      kind: "market",
      symbol,
      side,
      notionalUsd: notional,
      leverage,
      baseUnits,
      tpUsd,
      slUsd,
    };

    if (!user.confirm_trades) {
      await executeTrade(ctx, pending);
      return;
    }

    setPendingConfirm(ctx.from.id, pending, 30);
    const extras: string[] = [];
    if (tpUsd !== undefined) extras.push(`TP: ${fmtUsd(tpUsd)}`);
    if (slUsd !== undefined) extras.push(`SL: ${fmtUsd(slUsd)}`);
    await ctx.reply(
      [
        `${bold("Confirm trade")}`,
        `${side.toUpperCase()} ${symbol} ${baseUnits} (≈ ${fmtUsd(notional * leverage)} notional)`,
        `Ref mark: ${fmtUsd(markPrice)}   Leverage: ${leverage}x`,
        ...(extras.length ? [extras.join("   ")] : []),
        ``,
        `Expires in 30s.`,
      ].join("\n"),
      { parse_mode: "HTML", reply_markup: confirmKeyboard() }
    );
  } catch (e) {
    await ctx.reply((e as Error).message);
  }
}

export async function limitCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) return void ctx.reply("Run /start first.");
  if (!user.tos_accepted_at) return void ctx.reply("Accept terms with /tos first.");

  const parts = (ctx.match?.toString() ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 4) {
    return void ctx.reply("Usage: /limit <symbol> <long|short> <usdc> <price> [leverage]");
  }
  try {
    const symbol = symbolSchema.parse(parts[0]);
    const side = sideSchema.parse(parts[1]);
    const notional = parseFloat(numStr.parse(parts[2]!));
    const priceUsd = numStr.parse(parts[3]!);
    const leverage = parts[4] ? parseFloat(numStr.parse(parts[4])) : 1;
    await enforceLimits(ctx.from.id, notional, leverage);

    const { baseUnits } = await notionalToBaseUnits(ctx.from.id, symbol, notional, leverage, parseFloat(priceUsd));
    const pending: PendingTrade = {
      kind: "limit",
      symbol,
      side,
      notionalUsd: notional,
      leverage,
      baseUnits,
      priceUsd,
    };

    if (!user.confirm_trades) {
      await executeTrade(ctx, pending);
      return;
    }

    setPendingConfirm(ctx.from.id, pending, 30);
    await ctx.reply(
      [
        `${bold("Confirm limit order")}`,
        `${side.toUpperCase()} ${symbol} ${baseUnits} @ ${fmtUsd(parseFloat(priceUsd))}`,
        `Notional: ${fmtUsd(notional * leverage)}   Leverage: ${leverage}x`,
        ``,
        `Expires in 30s.`,
      ].join("\n"),
      { parse_mode: "HTML", reply_markup: confirmKeyboard() }
    );
  } catch (e) {
    await ctx.reply((e as Error).message);
  }
}

export async function onConfirmCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!ctx.from || !data?.startsWith("confirm:")) return;
  const action = data.split(":")[1];
  await ctx.answerCallbackQuery();
  if (action === "cancel") {
    await ctx.editMessageText("Cancelled.");
    takePendingConfirm(ctx.from.id);
    return;
  }
  const pending = takePendingConfirm<PendingTrade>(ctx.from.id);
  if (!pending) {
    await ctx.editMessageText("Confirmation expired or missing.");
    return;
  }
  await ctx.editMessageText("Executing…");
  await executeTrade(ctx, pending, true);
}

async function executeTrade(
  ctx: Context,
  p: PendingTrade,
  fromCallback = false
): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) return;
  const reply = async (text: string) => {
    if (fromCallback) await ctx.editMessageText(text, { parse_mode: "HTML" });
    else await ctx.reply(text, { parse_mode: "HTML" });
  };

  try {
    const res =
      p.kind === "market"
        ? await placeMarket({
            telegramId: ctx.from.id,
            authority: user.trader_authority,
            symbol: p.symbol,
            side: p.side,
            baseUnits: p.baseUnits,
          })
        : await placeLimit({
            telegramId: ctx.from.id,
            authority: user.trader_authority,
            symbol: p.symbol,
            side: p.side,
            baseUnits: p.baseUnits,
            priceUsd: p.priceUsd!,
          });
    record({
      telegram_id: ctx.from.id,
      action: p.kind === "market" ? p.side : "limit",
      symbol: res.symbol,
      side: res.side,
      size: res.baseUnits,
      price: res.priceUsd,
      tx_sig: res.txSig,
      status: "ok",
    });
    await reply(
      [
        `${bold("Order sent")} ✅`,
        `${res.side.toUpperCase()} ${res.symbol} ${res.baseUnits}` +
          (res.priceUsd ? ` @ ${fmtUsd(parseFloat(res.priceUsd))}` : ""),
        `Tx: ${code(res.txSig.slice(0, 16))}…`,
        solscanLink(res.txSig),
      ].join("\n")
    );

    if (p.kind === "market" && (p.tpUsd || p.slUsd)) {
      try {
        const { setPositionTpSl } = await import("../../phoenix/conditional.js");
        const tpsl = await setPositionTpSl({
          telegramId: ctx.from.id,
          authority: user.trader_authority,
          symbol: res.symbol,
          positionSide: p.side,
          tpUsd: p.tpUsd ?? null,
          slUsd: p.slUsd ?? null,
        });
        const parts: string[] = [];
        if (p.tpUsd) parts.push(`🎯 TP ${fmtUsd(p.tpUsd)}`);
        if (p.slUsd) parts.push(`🛑 SL ${fmtUsd(p.slUsd)}`);
        await ctx.reply(
          `${parts.join("   ")}\n${solscanLink(tpsl.txSig)}`,
          { parse_mode: "HTML" }
        );
      } catch (tpslErr) {
        logger.error({ err: tpslErr }, "attaching tp/sl failed");
        await ctx.reply(
          `Order placed, but attaching TP/SL failed: ${(tpslErr as Error).message}\nTry /tp or /sl manually.`
        );
      }
    }
  } catch (e) {
    logger.error({ err: e, p }, "trade failed");
    record({
      telegram_id: ctx.from.id,
      action: p.kind === "market" ? p.side : "limit",
      symbol: p.symbol,
      side: p.side,
      size: p.baseUnits,
      price: p.priceUsd,
      status: "error",
      error: (e as Error).message,
    });
    const errAny = e as { name?: string; message?: string; programError?: string | null; logs?: string[] };
    if (errAny.name === "SimulationError") {
      const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const tail = (errAny.logs ?? []).slice(-10).map(esc).join("\n").slice(0, 2000);
      await reply(
        `Order failed (simulation): ${esc(errAny.programError ?? errAny.message ?? "")}\n\n<pre>${tail}</pre>`
      );
    } else {
      await reply(`Order failed: ${(errAny.message ?? "unknown").replace(/[<>&]/g, "")}`);
    }
  }
}

export async function cancelCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) return void ctx.reply("Run /start first.");
  const parts = (ctx.match?.toString() ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 1) return void ctx.reply("Usage: /cancel <order_id>");
  try {
    const orderSeq = parts[0]!;
    const { getAccountSummary } = await import("../../phoenix/trader.js");
    const client = await getClientForUser(ctx.from.id);
    const acct = await getAccountSummary(client, user.trader_authority);
    const o = acct.openOrders.find((x) => x.orderId === orderSeq);
    if (!o) return void ctx.reply(`Order ${orderSeq} not found.`);
    if (o.price === null) return void ctx.reply("Cannot cancel: missing price on order.");
    const r = await cancelOrder({
      telegramId: ctx.from.id,
      authority: user.trader_authority,
      symbol: o.symbol,
      orderSeq,
      price: o.price,
    });
    record({
      telegram_id: ctx.from.id,
      action: "cancel",
      symbol: o.symbol,
      order_id: orderSeq,
      tx_sig: r.txSig,
      status: "ok",
    });
    await ctx.reply(`Cancelled ${code(orderSeq)}\n${solscanLink(r.txSig)}`, {
      parse_mode: "HTML",
    });
  } catch (e) {
    await ctx.reply(`Cancel failed: ${(e as Error).message}`);
  }
}

export async function cancelAllCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) return void ctx.reply("Run /start first.");
  const parts = (ctx.match?.toString() ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 1) return void ctx.reply("Usage: /cancelall <symbol>");
  try {
    const symbol = parts[0]!;
    const r = await cancelAll(ctx.from.id, user.trader_authority, symbol);
    record({
      telegram_id: ctx.from.id,
      action: "cancel_all",
      symbol,
      tx_sig: r.txSig,
      status: "ok",
    });
    await ctx.reply(`All ${symbol} orders cancelled.\n${solscanLink(r.txSig)}`);
  } catch (e) {
    await ctx.reply(`Cancel-all failed: ${(e as Error).message}`);
  }
}

export async function closeCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) return void ctx.reply("Run /start first.");
  const parts = (ctx.match?.toString() ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 1) return void ctx.reply("Usage: /close <symbol> [pct, default 100]");
  try {
    const symbol = parts[0]!;
    const pct = parts[1] ? Math.min(100, Math.max(1, parseFloat(parts[1]))) : 100;
    const { getAccountSummary } = await import("../../phoenix/trader.js");
    const client = await getClientForUser(ctx.from.id);
    const acct = await getAccountSummary(client, user.trader_authority);
    const pos = acct.positions.find((p) => p.symbol === symbol || p.symbol === `${symbol}-PERP`);
    if (!pos) return void ctx.reply(`No open position on ${symbol}.`);
    const closeQty = (pos.baseQty * pct) / 100;
    const closeSide: "long" | "short" = pos.side === "long" ? "short" : "long";
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
    await ctx.reply(
      [
        `${bold("Closing")} ${pos.symbol} ${pct}%`,
        `${closeSide.toUpperCase()} ${closeQty.toFixed(6)}`,
        solscanLink(res.txSig),
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  } catch (e) {
    await ctx.reply(`Close failed: ${(e as Error).message}`);
  }
}
