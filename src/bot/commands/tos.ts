import type { CommandContext, Context } from "grammy";
import { InlineKeyboard } from "grammy";
import { acceptTos } from "../../db/wallets.js";
import { getUser } from "../../db/users.js";
import { bold } from "../format.js";

const TOS_TEXT = `${bold("Terms of Use — read carefully")}

1. This bot operates a <b>custodial trading wallet</b> on your behalf. The bot
   holds the private key to your trading wallet (encrypted at rest).
2. Trading perpetual futures involves risk of <b>total loss</b>. Liquidation
   can occur faster than you can react. Use at your own risk.
3. The bot is provided <b>as-is, with no warranty</b>. Operators are not liable
   for losses caused by bugs, downtime, RPC issues, market conditions, or
   liquidation events.
4. You can withdraw funds at any time via /withdraw. Set your withdrawal
   address with /setwithdraw before depositing any significant amount.
5. Do not use this bot if you are in a jurisdiction where perpetual futures
   are restricted.

Tap the button below to accept, or send /tos accept.`;

const ACCEPTED_TEXT = `${bold("Terms accepted ✅")}\nTrading is now enabled.`;

export async function tosCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const arg = ctx.match?.toString().trim().toLowerCase();
  if (arg === "accept") {
    acceptTos(ctx.from.id);
    await ctx.reply(ACCEPTED_TEXT, { parse_mode: "HTML" });
    return;
  }
  const user = getUser(ctx.from.id);
  if (user?.tos_accepted_at) {
    await ctx.reply("You have already accepted the terms.", { parse_mode: "HTML" });
    return;
  }
  await ctx.reply(TOS_TEXT, {
    parse_mode: "HTML",
    reply_markup: new InlineKeyboard().text("✅ I accept", "tos:accept").text("Decline", "tos:decline"),
  });
}

export async function onTosCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!ctx.from || !data?.startsWith("tos:")) return;
  await ctx.answerCallbackQuery();
  const action = data.split(":")[1];
  if (action === "accept") {
    acceptTos(ctx.from.id);
    await ctx.editMessageText(ACCEPTED_TEXT, { parse_mode: "HTML" });
  } else {
    await ctx.editMessageText("Terms not accepted. You can run /tos again any time.");
  }
}
