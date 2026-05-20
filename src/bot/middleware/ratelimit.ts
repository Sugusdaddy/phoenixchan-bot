import type { Context, MiddlewareFn } from "grammy";
import { tryConsume } from "../../db/ratelimit.js";
import { config } from "../../config.js";

export function rateLimit(bucket: string, limit?: number, windowSec = 60): MiddlewareFn<Context> {
  const effective = limit ?? config.RATE_LIMIT_TRADES_PER_MIN;
  return async (ctx, next) => {
    if (!ctx.from) return;
    if (!tryConsume(ctx.from.id, bucket, effective, windowSec)) {
      await ctx.reply(`Rate limit hit on ${bucket}. Try again in a minute.`);
      return;
    }
    return next();
  };
}
