import type { CommandContext, Context } from "grammy";
import { createAlert, listAlerts, deleteAlert } from "../../db/alerts.js";
import { resolveSymbol } from "../../phoenix/markets.js";
import { getClientForUser } from "../../phoenix/clients.js";
import { bold, code, fmtUsd } from "../format.js";

export async function alertCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const parts = (ctx.match?.toString() ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) {
    return void ctx.reply("Usage: /alert <symbol> <op> <price>\n  e.g. /alert SOL > 150");
  }
  const op = parts[1];
  if (op !== ">" && op !== "<") return void ctx.reply("Op must be > or <");
  try {
    const client = await getClientForUser(ctx.from.id);
    const symbol = await resolveSymbol(client, parts[0]!);
    const target = parseFloat(parts[2]!);
    if (!Number.isFinite(target) || target <= 0) return void ctx.reply("Invalid price.");
    const id = createAlert(ctx.from.id, symbol, op, target);
    await ctx.reply(`Alert #${id}: ${symbol} ${op} ${fmtUsd(target)}`);
  } catch (e) {
    await ctx.reply((e as Error).message);
  }
}

export async function alertsCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const rows = listAlerts(ctx.from.id);
  if (rows.length === 0) return void ctx.reply("No active alerts.");
  const lines = [`${bold("Active alerts")}`];
  for (const a of rows) {
    lines.push(`${code(`#${a.id}`)} ${a.symbol} ${a.op} ${fmtUsd(a.target)}`);
  }
  await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
}

export async function delAlertCmd(ctx: CommandContext<Context>): Promise<void> {
  if (!ctx.from) return;
  const id = parseInt((ctx.match?.toString() ?? "").trim(), 10);
  if (!Number.isFinite(id)) return void ctx.reply("Usage: /delalert <id>");
  const ok = deleteAlert(id, ctx.from.id);
  await ctx.reply(ok ? `Alert #${id} deleted.` : "Alert not found.");
}
