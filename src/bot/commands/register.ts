import type { CommandContext, Context } from "grammy";
import { getUser, markRegistered } from "../../db/users.js";
import { getClient } from "../../phoenix/clients.js";
import { bold, code } from "../format.js";
import { logger } from "../../logger.js";

export async function registerCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) {
    await ctx.reply("No wallet yet. Send /start first.");
    return;
  }
  if (user.registered_at) {
    await ctx.reply(
      `Already registered. Trader PDA: ${code(user.trader_pda ?? "—")}`,
      { parse_mode: "HTML" }
    );
    return;
  }

  const arg = ctx.match?.toString().trim();
  if (!arg) {
    await ctx.reply(
      [
        `${bold("Register your trader account")}`,
        ``,
        `Usage: /register [access_code]`,
        ``,
        `Phoenix is in private beta — you need an access, invite, or referral code.`,
        `Get one from a friend or Phoenix Discord.`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return;
  }

  try {
    if (ctx.chat && ctx.message) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
      } catch {
        // ok if we can't delete
      }
    }

    await ctx.reply("Registering with Phoenix…");

    const client = getClient();
    const resp = await client.api.invite().activateInvite({
      authority: user.trader_authority,
      code: arg,
    });

    markRegistered(ctx.from.id, resp.trader_pda, arg);
    logger.info(
      { telegramId: ctx.from.id, authority: user.trader_authority, traderPda: resp.trader_pda },
      "trader registered"
    );

    await ctx.reply(
      [
        `${bold("Registered ✅")}`,
        `Trader PDA: ${code(resp.trader_pda)}`,
        ``,
        `Next steps:`,
        `1. Fund your wallet with USDC + a bit of SOL`,
        `2. /tos accept`,
        `3. Start trading: /long /short /limit`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
  } catch (e) {
    const msg = (e as Error).message;
    logger.error({ err: e, code: arg }, "register failed");

    if (/already.*registered|already.*activated|wallet already/i.test(msg)) {
      await ctx.reply(
        "Looks like this wallet is already registered with Phoenix. Try /balance to check."
      );
      return;
    }
    await ctx.reply(`Registration failed: ${msg}`);
  }
}
