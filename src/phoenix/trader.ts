import type { PhoenixClient } from "./clients.js";

export interface PositionSummary {
  symbol: string;
  side: "long" | "short" | null;
  baseQty: number;
  entryPrice: number | null;
  markPrice: number | null;
  unrealizedPnl: number | null;
  liquidationPrice: number | null;
  leverage: number | null;
}

export interface OrderSummary {
  orderId: string;
  symbol: string;
  side: "long" | "short";
  type: "limit" | "market" | "conditional";
  price: number | null;
  size: number;
  filledSize: number;
  status: string;
}

export interface AccountSummary {
  authority: string;
  collateralUsd: number | null;
  marginRatio: number | null;
  freeCollateralUsd: number | null;
  totalUnrealizedPnl: number | null;
  positions: PositionSummary[];
  openOrders: OrderSummary[];
}

export async function getAccountSummary(
  client: PhoenixClient,
  authority: string
): Promise<AccountSummary> {
  const snap = (await client.api.traders().getTraderStateSnapshot(authority, {
    traderPdaIndex: 0,
  })) as unknown as Record<string, unknown>;
  const sub = ((snap.snapshot as Record<string, unknown>)?.subaccounts as unknown[]) ?? [];
  const sub0 = (sub[0] as Record<string, unknown>) ?? {};
  const positions = mapPositions((sub0.positions as unknown[]) ?? []);
  const orders = mapOrders((sub0.openOrders as unknown[]) ?? []);
  return {
    authority,
    collateralUsd: toNum(sub0.collateralUsd ?? sub0.collateral),
    marginRatio: toNum(sub0.marginRatio),
    freeCollateralUsd: toNum(sub0.freeCollateralUsd ?? sub0.freeCollateral),
    totalUnrealizedPnl: toNum(sub0.unrealizedPnl),
    positions,
    openOrders: orders,
  };
}

function mapPositions(rows: unknown[]): PositionSummary[] {
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    const baseQty = toNum(row.baseQty ?? row.size) ?? 0;
    return {
      symbol: String(row.symbol ?? ""),
      side: baseQty > 0 ? "long" : baseQty < 0 ? "short" : null,
      baseQty: Math.abs(baseQty),
      entryPrice: toNum(row.entryPrice ?? row.avgEntryPrice),
      markPrice: toNum(row.markPrice),
      unrealizedPnl: toNum(row.unrealizedPnl),
      liquidationPrice: toNum(row.liquidationPrice ?? row.liqPrice),
      leverage: toNum(row.leverage),
    };
  });
}

function mapOrders(rows: unknown[]): OrderSummary[] {
  return rows.map((r) => {
    const row = r as Record<string, unknown>;
    const side = String(row.side ?? "").toLowerCase();
    return {
      orderId: String(row.orderId ?? row.id ?? ""),
      symbol: String(row.symbol ?? ""),
      side: side === "bid" || side === "buy" || side === "long" ? "long" : "short",
      type: (String(row.type ?? "limit").toLowerCase() as OrderSummary["type"]) ?? "limit",
      price: toNum(row.price ?? row.priceUsd),
      size: toNum(row.size ?? row.baseQty) ?? 0,
      filledSize: toNum(row.filledSize ?? 0) ?? 0,
      status: String(row.status ?? "open"),
    };
  });
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : null;
}
