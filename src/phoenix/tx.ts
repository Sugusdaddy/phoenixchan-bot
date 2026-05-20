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

export async function sendInstructions(
  signer: KeyPairSigner,
  instructions: Instruction[]
): Promise<string> {
  const rpc = getRpc();
  const rpcSubscriptions = getRpcSubscriptions();
  const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m)
  );

  const signed = await signTransactionMessageWithSigners(message);
  assertIsTransactionWithBlockhashLifetime(signed);
  const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  await sendAndConfirm(signed, { commitment: "confirmed" });
  const signature = getSignatureFromTransaction(signed);
  logger.info({ signature }, "tx confirmed");
  return signature;
}
