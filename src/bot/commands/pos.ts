import type { CommandContext, Context } from "grammy";
import { getUser } from "../../db/users.js";
import { getAccountSummary } from "../../phoenix/trader.js";
import { getClientForUser } from "../../phoenix/clients.js";
import { bold, fmtNum, fmtPct, fmtUsd } from "../format.js";

export async function posCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) {
    await ctx.reply("No wallet linked. Run /start.");
    return;
  }
  try {
    const client = await getClientForUser(ctx.from.id);
    const acct = await getAccountSummary(client, user.trader_authority);
    if (acct.positions.length === 0) {
      await ctx.reply("No open positions.");
      return;
    }
    const lines = [`${bold("Open positions")}`];
    for (const p of acct.positions) {
      const pnl = p.unrealizedPnl;
      const pnlStr = pnl !== null ? (pnl >= 0 ? `+${fmtUsd(pnl)}` : fmtUsd(pnl)) : "—";
      lines.push(
        [
          `${bold(p.symbol)} ${p.side?.toUpperCase() ?? ""}`,
          `  size: ${fmtNum(p.baseQty)} @ ${fmtUsd(p.entryPrice)}`,
          `  mark: ${fmtUsd(p.markPrice)}   uPnL: ${pnlStr}`,
          `  liq: ${fmtUsd(p.liquidationPrice)}   lev: ${p.leverage ? `${p.leverage.toFixed(1)}x` : "—"}`,
        ].join("\n")
      );
    }
    lines.push(``, `Free margin: ${fmtUsd(acct.freeCollateralUsd)}   Margin ratio: ${fmtPct(acct.marginRatio)}`);
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  } catch (e) {
    await ctx.reply((e as Error).message);
  }
}

export async function balanceCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) {
    await ctx.reply("No wallet linked. Run /start.");
    return;
  }
  try {
    const client = await getClientForUser(ctx.from.id);
    const acct = await getAccountSummary(client, user.trader_authority);
    await ctx.reply(
      [
        `${bold("Balance")}`,
        `Collateral: ${fmtUsd(acct.collateralUsd)}`,
        `Free margin: ${fmtUsd(acct.freeCollateralUsd)}`,
        `Margin ratio: ${fmtPct(acct.marginRatio)}`,
        `uPnL: ${fmtUsd(acct.totalUnrealizedPnl)}`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  } catch (e) {
    await ctx.reply((e as Error).message);
  }
}
