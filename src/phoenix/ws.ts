import { createPhoenixWsClient } from "@ellipsis-labs/rise";
import { config } from "../config.js";
import { logger } from "../logger.js";

export type WsClient = ReturnType<typeof createPhoenixWsClient>;

let _ws: WsClient | null = null;

export function getWs(): WsClient {
  if (_ws) return _ws;
  const url = config.PHOENIX_API_URL.replace(/^http/, "ws") + "/v1/ws";
  _ws = createPhoenixWsClient({
    url,
    authMode: "anonymous",
  });
  logger.info({ url }, "phoenix ws client ready");
  return _ws;
}

export function closeWs(): void {
  if (_ws) {
    _ws.close();
    _ws = null;
  }
}
