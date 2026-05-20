import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN required"),

  PHOENIX_API_URL: z.string().url().default("https://perp-api.phoenix.trade"),
  PHOENIX_API_KEY: z.string().optional(),
  PHOENIX_BUILDER_AUTHORITY: z.string().min(32, "Builder pubkey required"),
  PHOENIX_BUILDER_PRIVATE_KEY: z.string().min(32, "Builder private key required"),

  SOLANA_RPC_URL: z.string().url().default("https://api.mainnet-beta.solana.com"),

  DATABASE_PATH: z.string().default("./data/phoenix-bot.db"),

  MASTER_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "MASTER_ENCRYPTION_KEY must be 32 bytes hex"),

  WHITELIST_USER_IDS: z
    .string()
    .optional()
    .transform((s) =>
      s
        ? s
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean)
            .map((x) => BigInt(x))
        : []
    ),

  RATE_LIMIT_TRADES_PER_MIN: z.coerce.number().int().positive().default(10),
  MAX_NOTIONAL_USDC: z.coerce.number().positive().default(1000),
  DEFAULT_CONFIRM_TRADES: z
    .string()
    .default("true")
    .transform((s) => s === "true"),

  LOG_LEVEL: z
    .enum(["trace", "debug", "info", "warn", "error", "fatal"])
    .default("info"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid configuration:");
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }
  return parsed.data;
}

export const config = load();
