import type { CommandContext, Context } from "grammy";
import { setWithdrawAddress } from "../../db/wallets.js";
import { code } from "../format.js";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function setWithdrawCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const arg = ctx.match?.toString().trim();
  if (!arg) {
    await ctx.reply("Usage: /setwithdraw <solana_pubkey>");
    return;
  }
  if (!BASE58.test(arg)) {
    await ctx.reply("That doesn't look like a Solana address.");
    return;
  }
  setWithdrawAddress(ctx.from.id, arg);
  await ctx.reply(`Withdrawal address set to ${code(arg)}.`, { parse_mode: "HTML" });
}
