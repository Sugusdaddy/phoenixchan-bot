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
  type Signature,
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

async function checkSignatureLanded(signature: Signature): Promise<{
  landed: boolean;
  err: unknown | null;
}> {
  try {
    const rpc = getRpc();
    const res = await rpc.getSignatureStatuses([signature]).send();
    const info = res.value[0];
    if (!info) return { landed: false, err: null };
    const status = info.confirmationStatus;
    if (status === "confirmed" || status === "finalized") {
      return { landed: true, err: info.err ?? null };
    }
    return { landed: false, err: null };
  } catch (e) {
    logger.warn({ err: (e as Error).message }, "getSignatureStatuses failed");
    return { landed: false, err: null };
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
  const signature = getSignatureFromTransaction(signed);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  try {
    await withRetry("sendAndConfirm", () =>
      sendAndConfirm(signed, { commitment: "confirmed" })
    );
    logger.info({ signature }, "tx confirmed");
    return signature;
  } catch (e) {
    const originalErrMsg = (e as Error).message ?? String(e);
    logger.warn(
      { signature, err: originalErrMsg },
      "sendAndConfirm failed, checking if tx landed"
    );

    await new Promise((r) => setTimeout(r, 1500));
    const status = await checkSignatureLanded(signature);
    if (status.landed && status.err === null) {
      logger.info({ signature }, "tx landed despite sendAndConfirm error");
      return signature;
    }
    if (status.landed && status.err !== null) {
      logger.error({ signature, err: status.err }, "tx landed but failed on-chain");
      throw new SimulationError(
        `Tx executed but failed on-chain: ${JSON.stringify(status.err)}`,
        [],
        JSON.stringify(status.err)
      );
    }

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
      const simErr = sim.value.err;
      const logs = (sim.value.logs ?? []) as string[];
      if (simErr !== null && simErr !== undefined) {
        const programError = extractProgramError(logs, simErr);
        logger.error({ signature, logs, programError, err: simErr }, "simulation error");
        throw new SimulationError(programError ?? originalErrMsg, logs, programError);
      }
      logger.warn({ signature }, "simulation passed but tx did not land — RPC timeout?");
      throw new Error(
        `Tx submitted but not confirmed within timeout. It may still land — check /pos in a moment.\n(sig: ${signature.slice(0, 16)}…)`
      );
    } catch (simErr) {
      if (simErr instanceof SimulationError) throw simErr;
      if (simErr instanceof Error && simErr.message.startsWith("Tx submitted but not")) throw simErr;
      throw e;
    }
  }
}

function extractProgramError(logs: string[], err: unknown): string | null {
  for (let i = logs.length - 1; i >= 0; i--) {
    const line = logs[i]!;
    const m = /Program log: (?:Error|Panicked|panicked|PANICKED|FAILED|Failed)[:\s]+(.+)/i.exec(
      line
    );
    if (m && m[1]) return m[1].trim();
    const f = /custom program error: (0x[0-9a-f]+)/i.exec(line);
    if (f) return `Custom program error ${f[1]}`;
    if (/Program \S+ failed/.test(line)) return line.replace(/^Program /, "").trim();
  }
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (obj.InstructionError) return `Instruction error: ${JSON.stringify(obj.InstructionError)}`;
  }
  return null;
}
