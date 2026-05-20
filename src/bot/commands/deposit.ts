import type { CommandContext, Context } from "grammy";
import { getUser } from "../../db/users.js";
import { performDeposit } from "../../phoenix/deposit.js";
import { record } from "../../db/audit.js";
import { bold, code, fmtUsd, solscanAccount, solscanLink } from "../format.js";
import { logger } from "../../logger.js";

export async function depositCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) {
    await ctx.reply("No wallet yet. Send /start.");
    return;
  }

  const arg = (ctx.match?.toString() ?? "").trim();

  if (!arg) {
    await ctx.reply(
      [
        `${bold("Two-step deposit:")}`,
        ``,
        `${bold("Step 1")} — Send USDC to your trading wallet:`,
        code(user.trader_authority),
        ``,
        `Also send ~0.05 SOL for gas. Solana mainnet only.`,
        `USDC mint: ${code("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")}`,
        ``,
        `${bold("Step 2")} — Once funds arrive (~30s), credit them as Phoenix collateral:`,
        `Run: /deposit [amount]   e.g. /deposit 100`,
        ``,
        `That second step is what makes /balance and /long work.`,
        ``,
        `Solscan: ${solscanAccount(user.trader_authority)}`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return;
  }

  if (!user.registered_at) {
    await ctx.reply("You need to register first. Send /register [access_code].");
    return;
  }

  const amount = parseFloat(arg);
  if (!Number.isFinite(amount) || amount <= 0) {
    return void ctx.reply("Amount must be a positive number (USDC). Example: /deposit 50");
  }

  await ctx.reply(`Crediting ${fmtUsd(amount)} as Phoenix collateral…`, { parse_mode: "HTML" });

  try {
    const r = await performDeposit({
      telegramId: ctx.from.id,
      authority: user.trader_authority,
      amountUsdc: amount,
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
        `${bold("Deposit confirmed ✅")}`,
        `${fmtUsd(amount)} now available as collateral.`,
        solscanLink(r.txSig),
        ``,
        `Check with /balance.`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  } catch (e) {
    logger.error({ err: e, amount }, "deposit failed");
    const msg = (e as Error).message;
    if (/insufficient|funds|balance/i.test(msg)) {
      await ctx.reply(
        "Insufficient USDC in your trading wallet. Send USDC to your address first (see /deposit with no args)."
      );
      return;
    }
    await ctx.reply(`Deposit failed: ${msg}`);
  }
}
