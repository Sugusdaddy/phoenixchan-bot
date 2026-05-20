import type { CommandContext, Context } from "grammy";
import { getUser } from "../../db/users.js";
import { setEmbeddedWallet } from "../../db/wallets.js";
import { encrypt } from "../../crypto/keys.js";
import { generateEmbeddedWallet } from "../../crypto/solana.js";
import { getStats } from "../../db/stats.js";
import { bold, code, solscanAccount } from "../format.js";

function socialProof(): string {
  const s = getStats();
  if (s.walletsCreated < 5) return "";
  return `👥 ${s.walletsCreated} users have joined the bot so far.`;
}

export async function startCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const existing = getUser(ctx.from.id);
  if (existing?.trader_authority) {
    const lines = [
      `${bold("Welcome back.")} Your Phoenix trading wallet:`,
      code(existing.trader_authority),
      ``,
      `Solscan: ${solscanAccount(existing.trader_authority)}`,
      ``,
      existing.registered_at
        ? `✅ Registered with Phoenix (trader PDA: ${code((existing.trader_pda ?? "").slice(0, 8) + "…")})`
        : `⚠️ Not registered — run /register [access_code]`,
      existing.tos_accepted_at
        ? `✅ Terms accepted`
        : `⚠️ Terms NOT accepted — run /tos accept`,
      ``,
      `Commands: /help`,
    ];
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
    return;
  }

  const { signer, privateKeyBytes } = await generateEmbeddedWallet();
  const enc = await encrypt(privateKeyBytes);
  setEmbeddedWallet(ctx.from.id, signer.address, enc);
  privateKeyBytes.fill(0);

  const proof = socialProof();
  await ctx.reply(
    [
      `${bold("Welcome to the Phoenix trading bot.")}`,
      ...(proof ? [proof, ``] : []),
      `Your trading wallet has been created:`,
      code(signer.address),
      ``,
      `${bold("Setup (do in order):")}`,
      ``,
      `${bold("1️⃣ Register with Phoenix")}`,
      `   Phoenix is in private beta — you need an access/invite/referral code.`,
      `   Send: /register [your_code]`,
      ``,
      `${bold("2️⃣ Accept the terms")}`,
      `   /tos to read, then /tos accept`,
      ``,
      `${bold("3️⃣ Fund the wallet (TWO sub-steps)")}`,
      `   3a. Send USDC + ~0.05 SOL to the address above (Solana mainnet)`,
      `   3b. Credit it as Phoenix collateral: /deposit [amount]`,
      `       e.g. /deposit 100`,
      `       This is what makes /balance show numbers.`,
      ``,
      `${bold("4️⃣ Set a withdrawal address")}`,
      `   /setwithdraw [your_personal_pubkey]`,
      ``,
      `${bold("Then trade:")} /long /short /limit /close — full list in /help.`,
      ``,
      `${bold("Note")}: this is a custodial trading wallet operated by this bot.`,
      `Only fund what you can afford. Withdraw any time.`,
    ].join("\n"),
    { parse_mode: "HTML" }
  );
}
