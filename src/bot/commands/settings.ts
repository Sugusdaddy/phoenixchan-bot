import type { CommandContext, Context } from "grammy";
import { setConfirm, setMaxNotional } from "../../db/users.js";

export async function confirmCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const arg = (ctx.match?.toString() ?? "").trim().toLowerCase();
  if (arg !== "on" && arg !== "off") {
    return void ctx.reply("Usage: /confirm on|off");
  }
  setConfirm(ctx.from.id, arg === "on");
  await ctx.reply(`Trade confirmations: ${arg}`);
}

export async function maxNotionalCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const arg = (ctx.match?.toString() ?? "").trim();
  if (!arg) return void ctx.reply("Usage: /maxnotional <usdc> (or 'default')");
  if (arg.toLowerCase() === "default") {
    setMaxNotional(ctx.from.id, null);
    return void ctx.reply("Max notional reset to default.");
  }
  const n = parseFloat(arg);
  if (!Number.isFinite(n) || n <= 0) return void ctx.reply("Invalid amount.");
  setMaxNotional(ctx.from.id, n);
  await ctx.reply(`Max notional per trade: $${n}`);
}
