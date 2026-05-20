import type { CommandContext, Context } from "grammy";
import { base58 } from "@scure/base";
import { getAddressEncoder } from "@solana/kit";
import { getUser } from "../../db/users.js";
import { getEncryptedSecret } from "../../db/wallets.js";
import { decrypt } from "../../crypto/keys.js";
import { signerFromBytes } from "../../crypto/solana.js";
import { setPendingConfirm, takePendingConfirm } from "../../db/sessions.js";
import { bold, code } from "../format.js";
import { logger } from "../../logger.js";

const AUTO_DELETE_SECONDS = 90;

export async function exportKeyCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;

  if (ctx.chat?.type !== "private") {
    await ctx.reply("For security, /exportkey only works in private chat.");
    return;
  }

  const user = getUser(ctx.from.id);
  if (!user?.trader_authority) {
    await ctx.reply("No wallet to export. Run /start first.");
    return;
  }

  const arg = ctx.match?.toString().trim().toUpperCase();

  if (arg !== "CONFIRM") {
    setPendingConfirm(ctx.from.id, { action: "export_key" }, 120);
    await ctx.reply(
      [
        `${bold("⚠️ WARNING — Exporting your private key")}`,
        ``,
        `If you export this key:`,
        `• Anyone with the key can drain your trading wallet`,
        `• You become responsible for it — no recovery if lost`,
        `• Save it somewhere safe (password manager, offline backup)`,
        `• The message with the key will auto-delete in ${AUTO_DELETE_SECONDS}s — copy it quickly`,
        ``,
        `Wallet: ${code(user.trader_authority)}`,
        ``,
        `To proceed type:  ${code("/exportkey CONFIRM")}`,
        `(within 2 minutes)`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );
    return;
  }

  const pending = takePendingConfirm<{ action: string }>(ctx.from.id);
  if (!pending || pending.action !== "export_key") {
    await ctx.reply("Confirmation expired. Run /exportkey again.");
    return;
  }

  const enc = getEncryptedSecret(ctx.from.id);
  if (!enc) {
    await ctx.reply("No encrypted key found.");
    return;
  }

  try {
    const seed = await decrypt(enc);
    const signer = await signerFromBytes(seed);

    const pubkeyBytes = getAddressEncoder().encode(signer.address);
    const fullSecret = new Uint8Array(64);
    fullSecret.set(seed, 0);
    fullSecret.set(pubkeyBytes, 32);

    const base58Secret = base58.encode(fullSecret);
    const seedBase58 = base58.encode(seed);
    const jsonArray = `[${Array.from(fullSecret).join(",")}]`;

    if (ctx.message) {
      try {
        await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id);
      } catch {
        // ignore
      }
    }

    const msg = await ctx.reply(
      [
        `${bold(`🔑 Private key — auto-deletes in ${AUTO_DELETE_SECONDS}s`)}`,
        ``,
        `${bold("Phantom / Solflare (paste this):")}`,
        code(base58Secret),
        ``,
        `${bold("Solana CLI (solana-keygen, JSON array):")}`,
        code(jsonArray),
        ``,
        `${bold("32-byte seed (base58):")}`,
        code(seedBase58),
        ``,
        `${bold("Address:")} ${code(signer.address)}`,
        ``,
        `${bold("Copy NOW. Treat like a password.")}`,
      ].join("\n"),
      { parse_mode: "HTML" }
    );

    logger.warn(
      { telegramId: ctx.from.id, authority: user.trader_authority },
      "private key exported"
    );

    // Wipe in-memory copies
    seed.fill(0);
    fullSecret.fill(0);

    setTimeout(() => {
      ctx.api.deleteMessage(ctx.chat.id, msg.message_id).catch(() => {
        // ignore — user may have already saved + deleted, or bot lacks perms
      });
    }, AUTO_DELETE_SECONDS * 1000);
  } catch (e) {
    logger.error({ err: e }, "export key failed");
    await ctx.reply(`Export failed: ${(e as Error).message}`);
  }
}
