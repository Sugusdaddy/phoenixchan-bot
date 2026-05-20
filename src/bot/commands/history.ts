import type { CommandContext, Context } from "grammy";
import { getUser } from "../../db/users.js";
import { getClientForUser } from "../../phoenix/clients.js";
import { bold, code, fmtUsd } from "../format.js";

function parseWindow(arg: string | undefined): { days: number; label: string } {
  const t = (arg ?? "7d").trim().toLowerCase();
  const m = /^(\d+)d$/.exec(t);
  if (!m) return { days: 7, label: "7d" };
  return { days: Math.max(1, Math.min(parseInt(m[1]!, 10), 365)), label: t };
}

function fmtRelative(ts: number): string {
  const diffMin = Math.floor((Date.now() / 1000 - ts) / 60);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  const diffD = Math.floor(diffH / 24);
  return `${diffD}d ago`;
}

export async function historyCmd(ctx: CommandContext<Context>): Promise<void> {
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
      .getTraderTradesHistory(user.trader_authority, { pdaIndex: 0, limit: 50 });
    const rows = (resp.data ?? []).filter((f) => f.timestamp >= since);

    if (rows.length === 0) {
      await ctx.reply(`${bold(`History (${label})`)}\nNo trades.`, { parse_mode: "HTML" });
      return;
    }

    const totalRealized = rows.reduce((s, r) => s + parseFloat(r.realizedPnl || "0"), 0);
    const totalFees = rows.reduce((s, r) => s + parseFloat(r.fees || "0"), 0);
    const wins = rows.filter((r) => parseFloat(r.realizedPnl || "0") > 0).length;
    const losses = rows.filter((r) => parseFloat(r.realizedPnl || "0") < 0).length;

    const lines: string[] = [`${bold(`History (${label})`)}`];
    lines.push(
      `Total PnL: ${totalRealized >= 0 ? "+" : ""}${fmtUsd(totalRealized)}   ` +
        `Fees: ${fmtUsd(totalFees)}`
    );
    lines.push(
      `Trades: ${rows.length}   Wins: ${wins}   Losses: ${losses}   ` +
        `Win rate: ${rows.length > 0 ? ((wins / (wins + losses || 1)) * 100).toFixed(0) : 0}%`
    );
    lines.push(``, `${bold("Recent fills:")}`);

    const recent = rows.slice(0, 15);
    for (const r of recent) {
      const realized = parseFloat(r.realizedPnl || "0");
      const realizedStr =
        Math.abs(realized) > 1e-9
          ? ` ${realized >= 0 ? "📈+" : "📉"}${fmtUsd(realized)}`
          : "";
      const delta = parseFloat(r.baseLotsDelta);
      const side =
        r.tradeType === "liquidation"
          ? "🔥LIQ"
          : delta > 0
            ? "🟢BUY"
            : "🔴SELL";
      const size = Math.abs(delta).toString();
      lines.push(
        `${code(fmtRelative(r.timestamp))} ${side} ${r.marketSymbol} ${size} lots @ ${fmtUsd(parseFloat(r.price))}${realizedStr}`
      );
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  } catch (e) {
    await ctx.reply(`Could not load history: ${(e as Error).message}`);
  }
}
