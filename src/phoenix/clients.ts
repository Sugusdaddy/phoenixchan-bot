import { createPhoenixClient, type Authority } from "@ellipsis-labs/rise";
import { config } from "../config.js";
import { logger } from "../logger.js";

export type PhoenixClient = ReturnType<typeof createPhoenixClient>;

let _client: PhoenixClient | null = null;

function build(): PhoenixClient {
  return createPhoenixClient({
    apiUrl: config.PHOENIX_API_URL,
    apiKey: config.PHOENIX_API_KEY,
    rpcUrl: config.SOLANA_RPC_URL,
    pdaCache: { maxEntries: 2048 },
    exchangeMetadata: { stream: true },
    flight: {
      builderAuthority: config.PHOENIX_BUILDER_AUTHORITY as Authority,
      builderPdaIndex: 0,
      builderSubaccountIndex: 0,
    },
  });
}

export function getClient(): PhoenixClient {
  if (!_client) {
    _client = build();
    logger.info(
      { builder: config.PHOENIX_BUILDER_AUTHORITY, apiUrl: config.PHOENIX_API_URL },
      "phoenix client ready"
    );
  }
  return _client;
}

export function getBootstrapClient(): PhoenixClient {
  return getClient();
}

export async function getClientForUser(_telegramId: number): Promise<PhoenixClient> {
  return getClient();
}

export function invalidateUser(_telegramId: number): void {
  // no-op in shared-client model
}

export function disposeAll(): void {
  if (_client) {
    _client.dispose();
    _client = null;
  }
}

export function disposeBootstrap(): void {
  disposeAll();
}
