import { Side, type Authority, type Symbol as PhoenixSymbol } from "@ellipsis-labs/rise";
import type { Instruction, KeyPairSigner } from "@solana/kit";
import { getClientForUser } from "./clients.js";
import { resolveSymbol } from "./markets.js";
import { sendInstructions } from "./tx.js";
import { signerFromBytes } from "../crypto/solana.js";
import { decrypt } from "../crypto/keys.js";
import { getEncryptedSecret } from "../db/wallets.js";
import { logger } from "../logger.js";

export interface TradeParams {
  telegramId: number;
  authority: string;
  symbol: string;
  side: "long" | "short";
  baseUnits: string;
  priceLimitUsd?: string;
}

export interface LimitParams extends TradeParams {
  priceUsd: string;
}

export interface TradeResult {
  txSig: string;
  symbol: string;
  side: "long" | "short";
  baseUnits: string;
  priceUsd?: string;
}

async function loadSigner(telegramId: number): Promise<KeyPairSigner> {
  const enc = getEncryptedSecret(telegramId);
  if (!enc) throw new Error("Wallet not initialized. Run /start first.");
  const bytes = await decrypt(enc);
  return signerFromBytes(bytes);
}

function toSide(side: "long" | "short"): Side {
  return side === "long" ? Side.Bid : Side.Ask;
}

export async function placeMarket(p: TradeParams): Promise<TradeResult> {
  const client = await getClientForUser(p.telegramId);
  const symbol = (await resolveSymbol(client, p.symbol)) as PhoenixSymbol;
  const signer = await loadSigner(p.telegramId);
  if (signer.address !== p.authority) {
    throw new Error("Signer address does not match stored authority");
  }

  const orderPacket = await client.orderPackets.buildMarketOrderPacket({
    symbol,
    side: toSide(p.side),
    baseUnits: p.baseUnits,
    ...(p.priceLimitUsd ? { priceLimitUsd: p.priceLimitUsd } : {}),
  });

  const ix = (await client.ixs.placeMarketOrder({
    authority: p.authority as Authority,
    symbol,
    orderPacket,
  })) as unknown as Instruction;

  const txSig = await sendInstructions(signer, [ix]);
  logger.info({ telegramId: p.telegramId, symbol, side: p.side, txSig }, "market order sent");
  return { txSig, symbol, side: p.side, baseUnits: p.baseUnits };
}

export async function placeLimit(p: LimitParams): Promise<TradeResult> {
  const client = await getClientForUser(p.telegramId);
  const symbol = (await resolveSymbol(client, p.symbol)) as PhoenixSymbol;
  const signer = await loadSigner(p.telegramId);
  if (signer.address !== p.authority) {
    throw new Error("Signer address does not match stored authority");
  }

  const orderPacket = await client.orderPackets.buildLimitOrderPacket({
    symbol,
    side: toSide(p.side),
    priceUsd: p.priceUsd,
    baseUnits: p.baseUnits,
  });

  const ix = (await client.ixs.buildPlaceLimitOrder({
    authority: p.authority as Authority,
    symbol,
    orderPacket,
    traderPdaIndex: 0,
  })) as unknown as Instruction;

  const txSig = await sendInstructions(signer, [ix]);
  logger.info(
    { telegramId: p.telegramId, symbol, side: p.side, priceUsd: p.priceUsd, txSig },
    "limit order sent"
  );
  return { txSig, symbol, side: p.side, baseUnits: p.baseUnits, priceUsd: p.priceUsd };
}

export interface CancelParams {
  telegramId: number;
  authority: string;
  symbol: string;
  orderSeq: string;
  price: number;
}

export async function cancelOrder(p: CancelParams): Promise<{ txSig: string }> {
  const client = await getClientForUser(p.telegramId);
  const symbol = (await resolveSymbol(client, p.symbol)) as PhoenixSymbol;
  const signer = await loadSigner(p.telegramId);

  const ix = (await client.ixs.buildCancelOrdersById({
    authority: p.authority as Authority,
    symbol,
    orders: [{ price: p.price, orderSequenceNumber: p.orderSeq }],
    traderPdaIndex: 0,
  })) as unknown as Instruction;
  const txSig = await sendInstructions(signer, [ix]);
  return { txSig };
}

export async function cancelAll(
  telegramId: number,
  authority: string,
  symbol: string
): Promise<{ txSig: string }> {
  const client = await getClientForUser(telegramId);
  const signer = await loadSigner(telegramId);
  const resolved = (await resolveSymbol(client, symbol)) as PhoenixSymbol;
  const ix = (await client.ixs.buildCancelAll({
    authority: authority as Authority,
    symbol: resolved,
    traderPdaIndex: 0,
  })) as unknown as Instruction;
  const txSig = await sendInstructions(signer, [ix]);
  return { txSig };
}
