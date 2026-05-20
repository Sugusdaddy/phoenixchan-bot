import type { CommandContext, Context } from "grammy";
import { getUser } from "../../db/users.js";
import { bold, code, solscanAccount } from "../format.js";

export async function statusCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) {
    await ctx.reply("No wallet yet. Send /start to create one.");
    return;
  }
  await ctx.reply(
    [
      `${bold("Account status")}`,
      `Wallet: ${code(user.trader_authority)}`,
      `Solscan: ${solscanAccount(user.trader_authority)}`,
      `Withdraw to: ${user.withdraw_address ? code(user.withdraw_address) : "not set (use /setwithdraw)"}`,
      `Registered: ${user.registered_at ? `✅ ${code((user.trader_pda ?? "").slice(0, 8) + "…")}` : "❌ run /register"}`,
      `Terms: ${user.tos_accepted_at ? "accepted ✅" : "not accepted ⚠️ (run /tos)"}`,
      `Trade confirmations: ${user.confirm_trades ? "on" : "off"}`,
      `Max notional: ${user.max_notional ? `$${user.max_notional}` : "default"}`,
    ].join("\n"),
    { parse_mode: "HTML" }
  );
}
