import type { CommandContext, Context } from "grammy";
import { getUser } from "../../db/users.js";
import { getAccountSummary } from "../../phoenix/trader.js";
import { getClientForUser } from "../../phoenix/clients.js";
import { bold, code, fmtNum, fmtUsd } from "../format.js";

export async function ordersCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) return void ctx.reply("No wallet linked. Run /start.");
  try {
    const client = await getClientForUser(ctx.from.id);
    const acct = await getAccountSummary(client, user.trader_authority);
    if (acct.openOrders.length === 0) {
      await ctx.reply("No open orders.");
      return;
    }
    const lines = [`${bold("Open orders")}`];
    for (const o of acct.openOrders) {
      const sideEmoji = o.side === "long" ? "🟢" : "🔴";
      lines.push(
        `${code(o.orderId.slice(0, 10) + "…")} ${sideEmoji} ${o.symbol} ${o.type}\n  size: ${fmtNum(o.sizeRemaining, 6)} @ ${fmtUsd(o.price)}  [${o.status}]`
      );
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  } catch (e) {
    await ctx.reply((e as Error).message);
  }
}
