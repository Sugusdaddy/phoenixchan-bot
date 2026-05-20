import type { CommandContext, Context } from "grammy";
import { getUser, markRegistered } from "../../db/users.js";
import { getClient } from "../../phoenix/clients.js";
import { config } from "../../config.js";
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

  const codeToUse = config.DEFAULT_REGISTER_CODE;
  if (!codeToUse) {
    logger.error("DEFAULT_REGISTER_CODE not configured");
    await ctx.reply("Bot is not configured for self-registration. Contact the operator.");
    return;
  }

  try {
    await ctx.reply(`Registering with referral ${code(codeToUse)}…`, { parse_mode: "HTML" });

    const client = getClient();
    let traderPda: string | null = null;
    let usedFlow: "invite" | "referral" = "referral";
    let refErr: string | null = null;

    try {
      const resp = await client.api.invite().activateInviteWithReferral({
        authority: user.trader_authority,
        referral_code: codeToUse,
      });
      traderPda = resp.trader_pda;
    } catch (e) {
      refErr = (e as Error).message;
      logger.debug({ err: refErr }, "referral code path failed, trying invite");
    }

    if (!traderPda) {
      try {
        const resp = await client.api.invite().activateInvite({
          authority: user.trader_authority,
          code: codeToUse,
        });
        traderPda = resp.trader_pda;
        usedFlow = "invite";
      } catch (e) {
        const inviteErr = (e as Error).message;
        logger.error(
          { refErr, inviteErr, code: codeToUse },
          "register failed with default code"
        );
        await ctx.reply(
          "Registration is temporarily unavailable. The operator has been notified."
        );
        return;
      }
    }

    markRegistered(ctx.from.id, traderPda, codeToUse);
    logger.info(
      {
        telegramId: ctx.from.id,
        authority: user.trader_authority,
        traderPda,
        flow: usedFlow,
      },
      "trader registered"
    );

    await ctx.reply(
      [
        `${bold("Registered ✅")}  (referral ${codeToUse})`,
        `Trader PDA: ${code(traderPda)}`,
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
    logger.error({ err: e, code: codeToUse }, "register failed");

    if (/already.*registered|already.*activated|wallet already/i.test(msg)) {
      await ctx.reply(
        "Looks like this wallet is already registered with Phoenix. Try /balance to check."
      );
      return;
    }
    await ctx.reply(`Registration failed: ${msg}`);
  }
}
