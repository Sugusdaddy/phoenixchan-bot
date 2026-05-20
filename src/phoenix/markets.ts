import type { Symbol as PhoenixSymbol } from "@ellipsis-labs/rise";
import type { PhoenixClient } from "./clients.js";

export interface MarketSummary {
  symbol: string;
  mid: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  marketStatus: string;
  marketPubkey: string;
  tickSize: number;
  takerFeeBps: number;
  makerFeeBps: number;
  maxFundingRatePct: number | null;
}

export function normalizeSymbol(s: string): string {
  return s.trim().toUpperCase();
}

export async function resolveSymbol(client: PhoenixClient, input: string): Promise<string> {
  const snapshot = await client.exchange.ready();
  const requested = normalizeSymbol(input);
  const symbols = snapshot.markets.map((m: { symbol: string }) => m.symbol);
  const exact = symbols.find((s: string) => normalizeSymbol(s) === requested);
  if (exact) return exact;
  const perp = symbols.find((s: string) => normalizeSymbol(s) === `${requested}-PERP`);
  if (perp) return perp;
  throw new Error(`Unknown market: ${input}. Available: ${symbols.join(", ")}`);
}

export async function listSymbols(client: PhoenixClient): Promise<string[]> {
  const snapshot = await client.exchange.ready();
  return snapshot.markets.map((m: { symbol: string }) => m.symbol);
}

export async function getMarket(client: PhoenixClient, symbol: string): Promise<MarketSummary> {
  const resolved = (await resolveSymbol(client, symbol)) as PhoenixSymbol;
  const [cfg, ob] = await Promise.all([
    client.api.markets().getMarket(resolved),
    client.api.orderbook().getOrderbook(resolved).catch(() => null),
  ]);
  const bestBid = ob?.bids?.[0]?.[0] ?? null;
  const bestAsk = ob?.asks?.[0]?.[0] ?? null;
  return {
    symbol: cfg.symbol,
    mid: ob?.mid ?? null,
    bestBid,
    bestAsk,
    marketStatus: cfg.marketStatus,
    marketPubkey: cfg.marketPubkey,
    tickSize: cfg.tickSize,
    takerFeeBps: cfg.takerFee * 10000,
    makerFeeBps: cfg.makerFee * 10000,
    maxFundingRatePct: cfg.maxFundingRatePerIntervalPercentage ?? null,
  };
}
