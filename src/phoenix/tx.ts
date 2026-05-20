import {
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  getSignatureFromTransaction,
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

  await withRetry("sendAndConfirm", () =>
    sendAndConfirm(signed, { commitment: "confirmed" })
  );

  const signature = getSignatureFromTransaction(signed);
  logger.info({ signature }, "tx confirmed");
  return signature;
}
