import type { CommandContext, Context } from "grammy";
import { getUser } from "../../db/users.js";
import { bold, code, solscanAccount } from "../format.js";

export async function depositCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) {
    await ctx.reply("No wallet yet. Send /start.");
    return;
  }
  await ctx.reply(
    [
      `${bold("Deposit to your trading wallet")}`,
      ``,
      `Send to this address on Solana mainnet:`,
      code(user.trader_authority),
      ``,
      `${bold("What to send:")}`,
      `• USDC — your trading collateral`,
      `• A small amount of SOL (~0.05) — for transaction fees`,
      ``,
      `${bold("Important:")}`,
      `• Solana network only (not Ethereum, not Polygon, etc.)`,
      `• USDC token mint: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`,
      `• Deposits show up after ~30s. Use /balance to check.`,
      ``,
      `Solscan: ${solscanAccount(user.trader_authority)}`,
    ].join("\n"),
    { parse_mode: "HTML" }
  );
}
