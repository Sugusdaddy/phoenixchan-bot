import type {
  TraderStateSnapshotResponse,
  TraderStatePositionSnapshot,
  TraderStateMarketLimitOrderRow,
} from "@ellipsis-labs/rise";

interface LimitOrderEvent {
  symbol: string;
  orders: TraderStateMarketLimitOrderRow[];
}
import type { PhoenixClient } from "./clients.js";
import { getMarket } from "./markets.js";
import { logger } from "../logger.js";

export interface PositionSummary {
  symbol: string;
  side: "long" | "short" | null;
  baseQty: number;
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnl: number | null;
  fundingPaid: number | null;
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
    return {
      authority,
      collateralUsd: 0,
      totalUnrealizedPnl: 0,
      positions: [],
      openOrders: [],
    };
  }

  const collateralUsd = toNum(sub0.collateral);

  const positions: PositionSummary[] = [];
  for (const p of sub0.positions) {
    const baseQtyRaw = toNum(p.basePositionUnits) ?? 0;
    if (Math.abs(baseQtyRaw) < 1e-9) continue;
    const entryPrice = toNum(p.entryPriceUsd);
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

    const fundingPaid = computeFundingPaid(p);
    positions.push({
      symbol: p.symbol,
      side,
      baseQty,
      entryPrice,
      markPrice,
      unrealizedPnl: upnl,
      fundingPaid,
    });
  }

  const openOrders: OrderSummary[] = [];
  for (const ev of sub0.orders as LimitOrderEvent[]) {
    for (const o of ev.orders) {
      openOrders.push(mapOrder(ev.symbol, o));
    }
  }

  const totalUnrealizedPnl = positions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);

  return {
    authority,
    collateralUsd,
    totalUnrealizedPnl,
    positions,
    openOrders,
  };
}

function computeFundingPaid(p: TraderStatePositionSnapshot): number | null {
  const a = toNum(p.accumulatedFundingQuoteLots);
  const u = toNum(p.unsettledFundingQuoteLots);
  if (a === null && u === null) return null;
  // these are quote-lot units; just sum and return raw — UX formatting elsewhere
  return (a ?? 0) + (u ?? 0);
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
