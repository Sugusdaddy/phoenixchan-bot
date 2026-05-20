import type {
  TraderStateSnapshotResponse,
  TraderStatePositionSnapshot,
  TraderStateMarketLimitOrderRow,
} from "@ellipsis-labs/rise";

interface MarketParams {
  symbol: string;
  baseLotsDecimals: number;
  tickSize: number;
}
import type { PhoenixClient } from "./clients.js";
import { getMarket } from "./markets.js";
import { logger } from "../logger.js";

interface LimitOrderEvent {
  symbol: string;
  orders: TraderStateMarketLimitOrderRow[];
}

const USDC_DECIMALS = 6;

export interface PositionSummary {
  symbol: string;
  side: "long" | "short" | null;
  baseQty: number;
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnl: number | null;
}

export interface OrderSummary {
  orderId: string;
  symbol: string;
  side: "long" | "short";
  type: string;
  price: number | null;
  sizeRemaining: number;
  status: string;
}

export interface AccountSummary {
  authority: string;
  collateralUsd: number | null;
  totalUnrealizedPnl: number | null;
  positions: PositionSummary[];
  openOrders: OrderSummary[];
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function getMarketCfgMap(client: PhoenixClient): Promise<Map<string, MarketParams>> {
  const snapshot = await client.exchange.ready();
  const map = new Map<string, MarketParams>();
  for (const m of snapshot.markets) {
    map.set(m.symbol, {
      symbol: m.symbol,
      baseLotsDecimals: m.baseLotsDecimals,
      tickSize: m.tickSize,
    });
  }
  return map;
}

export async function getAccountSummary(
  client: PhoenixClient,
  authority: string
): Promise<AccountSummary> {
  let snap: TraderStateSnapshotResponse | null = null;
  try {
    snap = await client.api.traders().getTraderStateSnapshot(authority, { traderPdaIndex: 0 });
  } catch (e) {
    logger.warn({ err: (e as Error).message, authority }, "trader state snapshot failed");
  }
  if (!snap) {
    return {
      authority,
      collateralUsd: null,
      totalUnrealizedPnl: null,
      positions: [],
      openOrders: [],
    };
  }

  const sub0 = snap.snapshot.subaccounts[0];
  if (!sub0) {
    return { authority, collateralUsd: 0, totalUnrealizedPnl: 0, positions: [], openOrders: [] };
  }

  const collateralRaw = toNum(sub0.collateral);
  const collateralUsd = collateralRaw !== null ? collateralRaw / 10 ** USDC_DECIMALS : null;

  const marketCfg = await getMarketCfgMap(client);

  const positions: PositionSummary[] = [];
  for (const p of sub0.positions) {
    const cfg = marketCfg.get(p.symbol);
    const baseQtyRaw = readBaseQty(p, cfg);
    if (Math.abs(baseQtyRaw) < 1e-12) continue;

    const entryPrice = readEntryPrice(p, cfg);
    let markPrice: number | null = null;
    try {
      const m = await getMarket(client, p.symbol);
      markPrice = m.mid;
    } catch {
      // ignore
    }

    const side: "long" | "short" = baseQtyRaw > 0 ? "long" : "short";
    const baseQty = Math.abs(baseQtyRaw);
    const upnl =
      entryPrice !== null && markPrice !== null
        ? side === "long"
          ? baseQty * (markPrice - entryPrice)
          : baseQty * (entryPrice - markPrice)
        : null;

    positions.push({ symbol: p.symbol, side, baseQty, entryPrice, markPrice, unrealizedPnl: upnl });
  }

  const openOrders: OrderSummary[] = [];
  for (const ev of sub0.orders as LimitOrderEvent[]) {
    for (const o of ev.orders) {
      openOrders.push(mapOrder(ev.symbol, o));
    }
  }

  const totalUnrealizedPnl = positions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);

  return { authority, collateralUsd, totalUnrealizedPnl, positions, openOrders };
}

function readBaseQty(p: TraderStatePositionSnapshot, cfg: MarketParams | undefined): number {
  const units = toNum(p.basePositionUnits);
  if (units !== null) return units;
  const lots = toNum(p.basePositionLots);
  if (lots !== null && cfg) return lots / 10 ** cfg.baseLotsDecimals;
  return 0;
}

function readEntryPrice(p: TraderStatePositionSnapshot, cfg: MarketParams | undefined): number | null {
  const usd = toNum(p.entryPriceUsd);
  if (usd !== null) return usd;
  const ticks = toNum(p.entryPriceTicks);
  if (ticks !== null && cfg) return ticks * cfg.tickSize;
  return null;
}

function mapOrder(symbol: string, o: TraderStateMarketLimitOrderRow): OrderSummary {
  return {
    orderId: o.orderSequenceNumber,
    symbol,
    side: o.side === "bid" ? "long" : "short",
    type: o.orderType,
    price: toNum(o.priceUsd),
    sizeRemaining: toNum(o.sizeRemainingUnits ?? o.sizeRemainingLots) ?? 0,
    status: o.status,
  };
}
