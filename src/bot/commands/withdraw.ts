import type { CommandContext, Context } from "grammy";
import { getUser } from "../../db/users.js";
import { record } from "../../db/audit.js";
import { performWithdraw } from "../../phoenix/withdraw.js";
import { bold, code, fmtUsd, solscanLink } from "../format.js";
import { logger } from "../../logger.js";

export async function withdrawCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) return void ctx.reply("Run /start first.");
  if (!user.withdraw_address) {
    return void ctx.reply(
      "No withdrawal address set. Use /setwithdraw [your_solana_pubkey] first."
    );
  }

  const arg = (ctx.match?.toString() ?? "").trim();
  if (!arg) {
    return void ctx.reply(
      [
        `${bold("Withdraw USDC")}`,
        ``,
        `Usage: /withdraw [amount]`,
        `Example: /withdraw 100`,
        ``,
        `Destination: ${code(user.withdraw_address)}`,
        `(Change with /setwithdraw)`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  }

  const amount = parseFloat(arg);
  if (!Number.isFinite(amount) || amount <= 0) {
    return void ctx.reply("Amount must be a positive number (USDC).");
  }
  if (amount < 0.01) {
    return void ctx.reply("Minimum withdrawal is 0.01 USDC.");
  }

  await ctx.reply(`Withdrawing ${fmtUsd(amount)} to ${code(user.withdraw_address.slice(0, 8) + "…")}…`, {
    parse_mode: "HTML",
  });

  try {
    const r = await performWithdraw({
      telegramId: ctx.from.id,
      authority: user.trader_authority,
      amountUsdc: amount,
      destination: user.withdraw_address,
    });
    record({
      telegram_id: ctx.from.id,
      action: "close",
      size: amount.toString(),
      tx_sig: r.txSig,
      status: "ok",
    });
    await ctx.reply(
      [
        `${bold("Withdraw sent ✅")}`,
        `${fmtUsd(amount)} → ${code(user.withdraw_address)}`,
        solscanLink(r.txSig),
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  } catch (e) {
    logger.error({ err: e, amount }, "withdraw failed");
    await ctx.reply(`Withdraw failed: ${(e as Error).message}`);
  }
}
