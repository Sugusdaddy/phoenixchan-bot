import type { Authority } from "@ellipsis-labs/rise";
import type { Instruction, KeyPairSigner } from "@solana/kit";
import { getClient } from "./clients.js";
import { sendInstructions } from "./tx.js";
import { signerFromBytes } from "../crypto/solana.js";
import { decrypt } from "../crypto/keys.js";
import { getEncryptedSecret } from "../db/wallets.js";
import { usdcToBaseUnits } from "./withdraw.js";
import { logger } from "../logger.js";

async function loadSigner(telegramId: number): Promise<KeyPairSigner> {
  const enc = getEncryptedSecret(telegramId);
  if (!enc) throw new Error("Wallet not initialized.");
  const bytes = await decrypt(enc);
  return signerFromBytes(bytes);
}

export interface DepositParams {
  telegramId: number;
  authority: string;
  amountUsdc: number;
}

export async function performDeposit(p: DepositParams): Promise<{ txSig: string }> {
  if (p.amountUsdc <= 0) throw new Error("Amount must be positive");
  const amount = usdcToBaseUnits(p.amountUsdc);

  const client = getClient();
  const signer = await loadSigner(p.telegramId);
  if (signer.address !== p.authority) {
    throw new Error("Signer address does not match stored authority");
  }

  const result = await client.ixs.buildDepositIxs({
    authority: p.authority as Authority,
    amount,
    traderPdaIndex: 0,
  });

  const instructions = result.instructions as unknown as Instruction[];
  const txSig = await sendInstructions(signer, instructions);
  logger.info(
    { telegramId: p.telegramId, amount: p.amountUsdc, txSig },
    "deposit to Phoenix completed"
  );
  return { txSig };
}
