export function code(s: string): string {
  return `<code>${escapeHtml(s)}</code>`;
}

export function bold(s: string): string {
  return `<b>${escapeHtml(s)}</b>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function fmtUsd(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `$${n.toFixed(digits)}`;
}

export function fmtNum(n: number | null | undefined, digits = 4): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined || !Number.isFinite(bps)) return "—";
  return `${bps.toFixed(2)} bps`;
}

export function shortAddr(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function solscanLink(sig: string): string {
  return `https://solscan.io/tx/${sig}`;
}

export function solscanAccount(addr: string): string {
  return `https://solscan.io/account/${addr}`;
}
