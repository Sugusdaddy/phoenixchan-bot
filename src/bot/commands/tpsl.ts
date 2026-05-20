import type { CommandContext, Context } from "grammy";
import { getUser } from "../../db/users.js";
import { setPositionTpSl, detectPositionSide } from "../../phoenix/conditional.js";
import { record } from "../../db/audit.js";
import { bold, code, fmtUsd, solscanLink } from "../format.js";
import { logger } from "../../logger.js";

async function applyTpSl(
  ctx: CommandContext<Context>,
  kind: "tp" | "sl"
): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) return void ctx.reply("Run /start first.");

  const parts = (ctx.match?.toString() ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) {
    return void ctx.reply(`Usage: /${kind} [symbol] [price]\nExample: /${kind} SOL 160`);
  }
  const symbol = parts[0]!;
  const price = parseFloat(parts[1]!);
  if (!Number.isFinite(price) || price <= 0) {
    return void ctx.reply("Invalid price.");
  }

  try {
    const side = await detectPositionSide(ctx.from.id, user.trader_authority, symbol);
    const r = await setPositionTpSl({
      telegramId: ctx.from.id,
      authority: user.trader_authority,
      symbol,
      positionSide: side,
      tpUsd: kind === "tp" ? price : null,
      slUsd: kind === "sl" ? price : null,
    });
    record({
      telegram_id: ctx.from.id,
      action: "limit",
      symbol,
      side,
      price: price.toString(),
      tx_sig: r.txSig,
      status: "ok",
      raw: { kind, price },
    });
    const labelEmoji = kind === "tp" ? "🎯" : "🛑";
    await ctx.reply(
      [
        `${bold(`${labelEmoji} ${kind.toUpperCase()} set`)}`,
        `Symbol: ${symbol}   Side: ${side.toUpperCase()}`,
        `Trigger: ${fmtUsd(price)}`,
        solscanLink(r.txSig),
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  } catch (e) {
    const msg = (e as Error).message;
    logger.error({ err: msg, kind }, `${kind} failed`);
    await ctx.reply(`${kind.toUpperCase()} failed: ${msg}`);
  }
}

export async function tpCmd(ctx: CommandContext<Context>): Promise<void> {
  await applyTpSl(ctx, "tp");
}

export async function slCmd(ctx: CommandContext<Context>): Promise<void> {
  await applyTpSl(ctx, "sl");
}

export async function tpslCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) return void ctx.reply("Run /start first.");

  const parts = (ctx.match?.toString() ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) {
    return void ctx.reply("Usage: /tpsl [symbol] [tp_price] [sl_price]\nExample: /tpsl SOL 160 130");
  }
  const symbol = parts[0]!;
  const tp = parseFloat(parts[1]!);
  const sl = parseFloat(parts[2]!);
  if (!Number.isFinite(tp) || !Number.isFinite(sl)) return void ctx.reply("Invalid prices.");
  if (tp <= 0 || sl <= 0) return void ctx.reply("Prices must be positive.");

  try {
    const side = await detectPositionSide(ctx.from.id, user.trader_authority, symbol);
    if (side === "long" && tp <= sl) {
      return void ctx.reply("For a LONG: tp must be above sl.");
    }
    if (side === "short" && tp >= sl) {
      return void ctx.reply("For a SHORT: tp must be below sl.");
    }
    const r = await setPositionTpSl({
      telegramId: ctx.from.id,
      authority: user.trader_authority,
      symbol,
      positionSide: side,
      tpUsd: tp,
      slUsd: sl,
    });
    record({
      telegram_id: ctx.from.id,
      action: "limit",
      symbol,
      side,
      tx_sig: r.txSig,
      status: "ok",
      raw: { kind: "tpsl", tp, sl },
    });
    await ctx.reply(
      [
        `${bold("🎯🛑 TP+SL set")}`,
        `${symbol} ${side.toUpperCase()}`,
        `TP: ${fmtUsd(tp)}   SL: ${fmtUsd(sl)}`,
        solscanLink(r.txSig),
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  } catch (e) {
    await ctx.reply(`TP/SL failed: ${(e as Error).message}`);
  }
}
