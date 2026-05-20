import type { CommandContext, Context } from "grammy";
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

To accept and enable trading, reply with /tos accept.
To decline, ignore this message or use /unlink to remove your wallet.`;

export async function tosCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const arg = ctx.match?.toString().trim().toLowerCase();
  if (arg === "accept") {
    acceptTos(ctx.from.id);
    await ctx.reply("Terms accepted. Trading is now enabled.", { parse_mode: "HTML" });
    return;
  }
  const user = getUser(ctx.from.id);
  if (user?.tos_accepted_at) {
    await ctx.reply("You have already accepted the terms.", { parse_mode: "HTML" });
    return;
  }
  await ctx.reply(TOS_TEXT, { parse_mode: "HTML" });
}
