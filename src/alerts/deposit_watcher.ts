import type { Bot } from "grammy";
import { InlineKeyboard } from "grammy";
import { address, getAddressEncoder, getProgramDerivedAddress, type Address } from "@solana/kit";
import { db } from "../db/index.js";
import { logger } from "../logger.js";
import { getRpc } from "../phoenix/rpc.js";
import { USDC_MINT } from "../phoenix/withdraw.js";
import { fmtUsd, bold, code } from "../bot/format.js";

const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

interface RegisteredUser {
  telegram_id: number;
  trader_authority: string;
}

const lastSeenBalance = new Map<number, bigint>();
const ataCache = new Map<string, Address>();

async function getUsdcAta(owner: Address): Promise<Address> {
  const cached = ataCache.get(String(owner));
  if (cached) return cached;
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM,
    seeds: [enc.encode(owner), enc.encode(TOKEN_PROGRAM), enc.encode(USDC_MINT)],
  });
  ataCache.set(String(owner), pda);
  return pda;
}

function listRegistered(): RegisteredUser[] {
  return db
    .prepare(
      `SELECT telegram_id, trader_authority FROM users
       WHERE trader_authority IS NOT NULL AND registered_at IS NOT NULL`
    )
    .all() as RegisteredUser[];
}

async function fetchUsdcBalance(owner: Address): Promise<bigint | null> {
  const rpc = getRpc();
  const ata = await getUsdcAta(owner);
  try {
    const info = await rpc.getTokenAccountBalance(ata).send();
    if (!info?.value?.amount) return 0n;
    return BigInt(info.value.amount);
  } catch (e) {
    const msg = (e as Error).message;
    if (/could not find account|AccountNotFound|TokenAccountNotFoundError/i.test(msg)) {
      return 0n;
    }
    throw e;
  }
}

export function startDepositWatcher(bot: Bot): () => void {
  let cancelled = false;

  const tick = async (): Promise<void> => {
    const users = listRegistered();
    for (const u of users) {
      if (cancelled) return;
      try {
        const bal = await fetchUsdcBalance(u.trader_authority as Address);
        if (bal === null) continue;
        const prev = lastSeenBalance.get(u.telegram_id);
        if (prev === undefined) {
          lastSeenBalance.set(u.telegram_id, bal);
          continue;
        }
        if (bal > prev) {
          const delta = bal - prev;
          const usd = Number(delta) / 1_000_000;
          if (usd >= 0.1) {
            const usdRounded = Math.floor(usd * 100) / 100;
            const kb = new InlineKeyboard()
              .text(`💰 Credit ${fmtUsd(usdRounded)} as collateral`, `dep:${usdRounded}`)
              .row()
              .text("Dismiss", "dep:dismiss");
            await bot.api
              .sendMessage(
                u.telegram_id,
                [
                  `${bold("💵 New deposit detected")}`,
                  `+${fmtUsd(usdRounded)} USDC arrived at your trading wallet.`,
                  `Send: ${code(`/deposit ${usdRounded}`)} to credit as collateral.`,
                ].join("\n"),
                { parse_mode: "HTML", reply_markup: kb }
              )
              .catch((e) => logger.warn({ err: e }, "deposit notify failed"));
          }
        }
        lastSeenBalance.set(u.telegram_id, bal);
      } catch (e) {
        logger.warn(
          { err: (e as Error).message, telegramId: u.telegram_id },
          "deposit watcher tick failed"
        );
      }
    }
  };

  void tick();
  const interval = setInterval(() => void tick(), 30_000);

  return () => {
    cancelled = true;
    clearInterval(interval);
  };
}

export async function onDepositCallback(ctx: import("grammy").Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("dep:")) return;
  await ctx.answerCallbackQuery();
  const arg = data.split(":")[1];
  if (arg === "dismiss") {
    await ctx.editMessageText("Dismissed.");
    return;
  }
  const amount = parseFloat(arg ?? "0");
  if (!Number.isFinite(amount) || amount <= 0) return;
  await ctx.reply(`To credit, send: /deposit ${amount}`);
}
