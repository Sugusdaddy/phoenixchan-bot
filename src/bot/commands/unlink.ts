import type { CommandContext, Context } from "grammy";
import { getUser, unlinkTrader } from "../../db/users.js";
import { db } from "../../db/index.js";
import { bold } from "../format.js";

export async function unlinkCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const arg = ctx.match?.toString().trim().toLowerCase();
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) {
    await ctx.reply("No wallet linked.");
    return;
  }
  if (arg !== "confirm") {
    await ctx.reply(
      [
        `${bold("Are you sure?")}`,
        `This will remove your trading wallet from the bot.`,
        `Make sure you have withdrawn funds first with /withdraw.`,
        ``,
        `Reply with /unlink confirm to proceed.`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return;
  }
  db.prepare(`UPDATE users SET encrypted_secret = NULL WHERE telegram_id = ?`).run(ctx.from.id);
  unlinkTrader(ctx.from.id);
  await ctx.reply("Wallet unlinked. The encrypted key has been removed.");
}
