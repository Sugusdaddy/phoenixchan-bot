import type { CommandContext, Context } from "grammy";
import { getStats } from "../../db/stats.js";
import { bold } from "../format.js";

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export async function statsCmd(ctx: CommandContext<Context>): Promise<void> {
  const s = getStats();
  await ctx.reply(
    [
      `${bold("📊 Phoenixchan Bot — Stats")}`,
      ``,
      `👥 ${s.walletsCreated} ${plural(s.walletsCreated, "wallet created", "wallets created")}`,
      `✅ ${s.registered} ${plural(s.registered, "trader registered", "traders registered")} on Phoenix`,
      `💸 ${s.withDeposits} active ${plural(s.withDeposits, "trader", "traders")}`,
      ``,
      `📈 ${s.totalTrades} total ${plural(s.totalTrades, "trade", "trades")}`,
      `⚡ ${s.trades24h} ${plural(s.trades24h, "trade", "trades")} in last 24h`,
      `🔥 ${s.uniqueTraders24h} active ${plural(s.uniqueTraders24h, "trader", "traders")} in last 24h`,
      ``,
      `Join: t.me/phoenixtradechanbot`,
    ].join("\n"),
    { parse_mode: "HTML" }
  );
}
