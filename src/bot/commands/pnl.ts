import type { CommandContext, Context } from "grammy";
import { getUser } from "../../db/users.js";
import { getClientForUser } from "../../phoenix/clients.js";
import { bold, fmtUsd } from "../format.js";

function parseWindow(arg: string | undefined): { days: number; label: string } {
  const t = (arg ?? "7d").trim().toLowerCase();
  const m = /^(\d+)d$/.exec(t);
  if (!m) return { days: 7, label: "7d" };
  return { days: Math.max(1, Math.min(parseInt(m[1]!, 10), 365)), label: t };
}

export async function pnlCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) {
    await ctx.reply("No wallet linked. Run /start.");
    return;
  }
  const { days, label } = parseWindow(ctx.match?.toString());
  try {
    const client = await getClientForUser(ctx.from.id);
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const resp = await client.api
      .trades()
      .getTraderTradesHistory(user.trader_authority, { pdaIndex: 0, limit: 500 });
    const rows = (resp.data ?? []).filter((f) => f.timestamp >= since);
    const total = rows.reduce((s, r) => s + parseFloat(r.realizedPnl || "0"), 0);
    await ctx.reply(
      [
        `${bold(`Realized PnL (${label})`)}`,
        `Total: ${total >= 0 ? "+" : ""}${fmtUsd(total)}`,
        `Fills: ${rows.length}`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  } catch (e) {
    await ctx.reply(`Could not load PnL: ${(e as Error).message}`);
  }
}

export async function fundingCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  try {
    const client = await getClientForUser(ctx.from.id);
    const overview = (await client.api.funding().getFundingOverview()) as unknown as {
      rates?: Array<{ symbol?: string; fundingRateBps?: number }>;
    };
    const rows = overview.rates ?? [];
    if (rows.length === 0) {
      await ctx.reply("No funding data.");
      return;
    }
    const lines = [`${bold("Current funding rates")}`];
    for (const r of rows.slice(0, 20)) {
      const bps = r.fundingRateBps ?? 0;
      lines.push(`${r.symbol ?? "?"}  ${bps >= 0 ? "+" : ""}${bps.toFixed(2)} bps`);
    }
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  } catch (e) {
    await ctx.reply(`Could not load funding: ${(e as Error).message}`);
  }
}
