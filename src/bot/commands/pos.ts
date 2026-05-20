import type { CommandContext, Context } from "grammy";
import { getUser } from "../../db/users.js";
import { getAccountSummary } from "../../phoenix/trader.js";
import { getClientForUser } from "../../phoenix/clients.js";
import { bold, fmtNum, fmtUsd } from "../format.js";

function pnlStr(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return "—";
  return n >= 0 ? `+${fmtUsd(n)}` : fmtUsd(n);
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
    const lines = [`${bold("Open positions")}`];
    for (const p of acct.positions) {
      lines.push(
        [
          `${bold(p.symbol)} ${p.side === "long" ? "🟢 LONG" : "🔴 SHORT"}`,
          `  size: ${fmtNum(p.baseQty, 6)}`,
          `  entry: ${fmtUsd(p.entryPrice)}   mark: ${fmtUsd(p.markPrice)}`,
          `  uPnL: ${pnlStr(p.unrealizedPnl)}`,
        ].join("\n")
      );
    }
    lines.push(
      ``,
      `${bold("Account")}`,
      `Collateral: ${fmtUsd(acct.collateralUsd)}`,
      `Total uPnL: ${pnlStr(acct.totalUnrealizedPnl)}`
    );
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
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
