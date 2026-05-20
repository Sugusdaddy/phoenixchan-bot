import {
  Direction,
  Side,
  StopLossOrderKind,
  ticks,
  type Authority,
  type Symbol as PhoenixSymbol,
  type Ticks,
} from "@ellipsis-labs/rise";
import type { Instruction, KeyPairSigner } from "@solana/kit";
import { getClient, getClientForUser } from "./clients.js";
import { resolveSymbol } from "./markets.js";
import { sendInstructions } from "./tx.js";
import { signerFromBytes } from "../crypto/solana.js";
import { decrypt } from "../crypto/keys.js";
import { getEncryptedSecret } from "../db/wallets.js";
import { getAccountSummary } from "./trader.js";
import { logger } from "../logger.js";

async function loadSigner(telegramId: number): Promise<KeyPairSigner> {
  const enc = getEncryptedSecret(telegramId);
  if (!enc) throw new Error("Wallet not initialized.");
  const bytes = await decrypt(enc);
  return signerFromBytes(bytes);
}

async function getTickSize(symbol: string): Promise<number> {
  const snapshot = await getClient().exchange.ready();
  const m = snapshot.markets.find((m: { symbol: string }) => m.symbol === symbol);
  if (!m) throw new Error(`Unknown market ${symbol}`);
  return (m as { tickSize: number }).tickSize;
}

function usdToTicks(usd: number, tickSize: number): Ticks {
  if (tickSize <= 0) throw new Error("Invalid tick size");
  const t = Math.round(usd / tickSize);
  return ticks(BigInt(Math.max(t, 1)));
}

interface TriggerOrderParams {
  triggerDirection: Direction;
  tradeSide: Side;
  orderKind: StopLossOrderKind;
  triggerPrice: Ticks;
  executionPrice: Ticks;
}

function makeTrigger(
  triggerTicks: Ticks,
  tradeSide: Side,
  direction: Direction
): TriggerOrderParams {
  return {
    triggerDirection: direction,
    tradeSide,
    orderKind: StopLossOrderKind.IOC,
    triggerPrice: triggerTicks,
    executionPrice: triggerTicks,
  };
}

export interface SetTpSlParams {
  telegramId: number;
  authority: string;
  symbol: string;
  positionSide: "long" | "short";
  tpUsd?: number | null;
  slUsd?: number | null;
}

export async function setPositionTpSl(p: SetTpSlParams): Promise<{ txSig: string }> {
  if (!p.tpUsd && !p.slUsd) throw new Error("Provide at least one of tp or sl");
  const client = await getClientForUser(p.telegramId);
  const signer = await loadSigner(p.telegramId);
  const symbol = (await resolveSymbol(client, p.symbol)) as PhoenixSymbol;
  const tickSize = await getTickSize(symbol);

  const tradeSide: Side = p.positionSide === "long" ? Side.Ask : Side.Bid;

  let greaterTriggerOrder: TriggerOrderParams | null = null;
  let lessTriggerOrder: TriggerOrderParams | null = null;

  if (p.positionSide === "long") {
    if (p.tpUsd) {
      greaterTriggerOrder = makeTrigger(
        usdToTicks(p.tpUsd, tickSize),
        tradeSide,
        Direction.GreaterThan
      );
    }
    if (p.slUsd) {
      lessTriggerOrder = makeTrigger(
        usdToTicks(p.slUsd, tickSize),
        tradeSide,
        Direction.LessThan
      );
    }
  } else {
    if (p.tpUsd) {
      lessTriggerOrder = makeTrigger(
        usdToTicks(p.tpUsd, tickSize),
        tradeSide,
        Direction.LessThan
      );
    }
    if (p.slUsd) {
      greaterTriggerOrder = makeTrigger(
        usdToTicks(p.slUsd, tickSize),
        tradeSide,
        Direction.GreaterThan
      );
    }
  }

  const ix = (await client.ixs.placePositionConditionalOrder({
    authority: p.authority as Authority,
    symbol,
    greaterTriggerOrder,
    lessTriggerOrder,
    sizePercent: 100,
    traderPdaIndex: 0,
  })) as unknown as Instruction;

  const txSig = await sendInstructions(signer, [ix]);
  logger.info(
    { telegramId: p.telegramId, symbol, tp: p.tpUsd, sl: p.slUsd, side: p.positionSide, txSig },
    "tp/sl set"
  );
  return { txSig };
}

export async function detectPositionSide(
  telegramId: number,
  authority: string,
  symbol: string
): Promise<"long" | "short"> {
  const client = await getClientForUser(telegramId);
  const resolved = await resolveSymbol(client, symbol);
  const acct = await getAccountSummary(client, authority);
  const pos = acct.positions.find((p) => p.symbol === resolved);
  if (!pos) throw new Error(`No open position on ${resolved}.`);
  if (!pos.side) throw new Error(`Position on ${resolved} has zero size.`);
  return pos.side;
}
