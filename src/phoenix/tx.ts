import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
  getBase64EncodedWireTransaction,
  assertIsTransactionWithBlockhashLifetime,
  type KeyPairSigner,
  type Instruction,
} from "@solana/kit";
import { getRpc, getRpcSubscriptions } from "./rpc.js";
import { logger } from "../logger.js";

function isRateLimit(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err);
  return /429|too many requests|rate.?limit/i.test(msg);
}

async function withRetry<T>(label: string, fn: () => Promise<T>, attempts = 5): Promise<T> {
  let delayMs = 500;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRateLimit(e) || i === attempts - 1) throw e;
      logger.warn({ label, attempt: i + 1, delayMs }, "rpc rate limited, retrying");
      await new Promise((r) => setTimeout(r, delayMs + Math.random() * 200));
      delayMs = Math.min(delayMs * 2, 8000);
    }
  }
  throw lastErr;
}

export class SimulationError extends Error {
  logs: string[];
  programError: string | null;
  constructor(message: string, logs: string[], programError: string | null) {
    super(message);
    this.name = "SimulationError";
    this.logs = logs;
    this.programError = programError;
  }
}

export async function sendInstructions(
  signer: KeyPairSigner,
  instructions: Instruction[]
): Promise<string> {
  const rpc = getRpc();
  const rpcSubscriptions = getRpcSubscriptions();

  const { value: latestBlockhash } = await withRetry("getLatestBlockhash", () =>
    rpc.getLatestBlockhash().send()
  );

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m)
  );

  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);

  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  try {
    await withRetry("sendAndConfirm", () =>
      sendAndConfirm(signed, { commitment: "confirmed" })
    );
  } catch (e) {
    const wire = getBase64EncodedWireTransaction(signed);
    try {
      const sim = await rpc
        .simulateTransaction(wire, {
          encoding: "base64",
          commitment: "confirmed",
          sigVerify: false,
          replaceRecentBlockhash: true,
        })
        .send();
      const logs = (sim.value.logs ?? []) as string[];
      const programError = extractProgramError(logs, sim.value.err);
      logger.error({ logs, programError, err: sim.value.err }, "tx simulation details");
      throw new SimulationError(
        programError ?? (e as Error).message,
        logs,
        programError
      );
    } catch (simErr) {
      if (simErr instanceof SimulationError) throw simErr;
      throw e;
    }
  }

  const signature = getSignatureFromTransaction(signed);
  logger.info({ signature }, "tx confirmed");
  return signature;
}

function extractProgramError(logs: string[], err: unknown): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const line = logs[i]!;
    const m = /Program log: (?:Error: )?(.+)/.exec(line);
    if (m && m[1]) return m[1].trim();
    const f = /custom program error: (0x[0-9a-f]+)/i.exec(line);
    if (f) return `Custom program error ${f[1]}`;
  }
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (obj.InstructionError) return `Instruction error: ${JSON.stringify(obj.InstructionError)}`;
  }
  return null;
}
