import type { Context, MiddlewareFn } from "grammy";
import { config } from "../../config.js";
import { getUser, upsertUser, type User } from "../../db/users.js";

export interface AuthState {
  user: User;
}

export type AuthedContext = Context & { state: AuthState };

export const ensureUser: MiddlewareFn<Context> = async (ctx, next) => {
  if (!ctx.from) return;

  if (
    config.WHITELIST_USER_IDS.length > 0 &&
    !config.WHITELIST_USER_IDS.includes(BigInt(ctx.from.id))
  ) {
    await ctx.reply("This bot is currently private. Contact the operator for access.");
    return;
  }

  upsertUser(ctx.from.id, ctx.from.username ?? null);
  const user = getUser(ctx.from.id);
  if (!user) return;
  (ctx as AuthedContext).state = { user };
  return next();
};

export const requireLinked: MiddlewareFn<Context> = async (ctx, next) => {
  const state = (ctx as AuthedContext).state;
  if (!state?.user?.trader_authority) {
    await ctx.reply(
      "You need to set up your trading wallet first. Send /start to create one."
    );
    return;
  }
  return next();
};

export const requireTos: MiddlewareFn<Context> = async (ctx, next) => {
  const state = (ctx as AuthedContext).state;
  if (!state?.user?.tos_accepted_at) {
    await ctx.reply(
      "You must accept the terms before trading. Send /tos to review and accept."
    );
    return;
  }
  return next();
};

export const requireRegistered: MiddlewareFn<Context> = async (ctx, next) => {
  const state = (ctx as AuthedContext).state;
  if (!state?.user?.linked_at) {
    await ctx.reply(
      "You need to register your trader account first. Send /register [access_code] (Phoenix is in private beta)."
    );
    return;
  }
  return next();
};
