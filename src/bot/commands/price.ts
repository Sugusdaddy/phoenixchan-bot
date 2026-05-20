import type { CommandContext, Context } from "grammy";
import { getMarket, listSymbols } from "../../phoenix/markets.js";
import { getClientForUser } from "../../phoenix/clients.js";
import { bold, fmtUsd } from "../format.js";

export async function priceCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const arg = ctx.match?.toString().trim();
  if (!arg) {
    await ctx.reply("Usage: /price [symbol] — e.g. /price SOL");
    return;
  }
  try {
    const client = await getClientForUser(ctx.from.id);
    const m = await getMarket(client, arg);
    const spread =
      m.bestBid !== null && m.bestAsk !== null && m.mid !== null && m.mid > 0
        ? `${(((m.bestAsk - m.bestBid) / m.mid) * 10000).toFixed(1)} bps`
        : "—";
    await ctx.reply(
      [
        `${bold(m.symbol)}  (${m.marketStatus})`,
        `Mid:  ${fmtUsd(m.mid)}`,
        `Bid:  ${fmtUsd(m.bestBid)}`,
        `Ask:  ${fmtUsd(m.bestAsk)}`,
        `Spread: ${spread}`,
        `Fees: taker ${m.takerFeeBps.toFixed(1)} bps, maker ${m.makerFeeBps.toFixed(1)} bps`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  } catch (e) {
    await ctx.reply((e as Error).message);
  }
}

export async function marketsCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  try {
    const client = await getClientForUser(ctx.from.id);
    const symbols = await listSymbols(client);
    await ctx.reply(`Available markets:\n${symbols.join(", ")}`);
  } catch (e) {
    await ctx.reply((e as Error).message);
  }
}
