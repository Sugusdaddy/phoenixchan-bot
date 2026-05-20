import {
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  type Rpc,
  type SolanaRpcApi,
  type RpcSubscriptions,
  type SolanaRpcSubscriptionsApi,
} from "@solana/kit";
import { config } from "../config.js";

let _rpc: Rpc<SolanaRpcApi> | null = null;
let _subs: RpcSubscriptions<SolanaRpcSubscriptionsApi> | null = null;

export function getRpc(): Rpc<SolanaRpcApi> {
  if (!_rpc) _rpc = createSolanaRpc(config.SOLANA_RPC_URL);
  return _rpc;
}

export function getRpcSubscriptions(): RpcSubscriptions<SolanaRpcSubscriptionsApi> {
  if (!_subs) {
    const wsUrl = config.SOLANA_RPC_URL.replace(/^http/, "ws");
    _subs = createSolanaRpcSubscriptions(wsUrl);
  }
  return _subs;
}
