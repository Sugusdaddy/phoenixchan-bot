import type { Authority, MintAddress } from "@ellipsis-labs/rise";
import { buildCreateAssociatedTokenAccountIdempotent } from "@ellipsis-labs/rise";
import {
  address,
  AccountRole,
  getAddressEncoder,
  getProgramDerivedAddress,
  type Address,
  type Instruction,
  type KeyPairSigner,
} from "@solana/kit";
import { getClient } from "./clients.js";
import { sendInstructions } from "./tx.js";
import { signerFromBytes } from "../crypto/solana.js";
import { decrypt } from "../crypto/keys.js";
import { getEncryptedSecret } from "../db/wallets.js";
import { logger } from "../logger.js";

const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ATA_PROGRAM = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
export const USDC_MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
export const USDC_DECIMALS = 6;

export function usdcToBaseUnits(amount: number): bigint {
  return BigInt(Math.floor(amount * 10 ** USDC_DECIMALS));
}

async function deriveAta(owner: Address, mint: Address): Promise<Address> {
  const enc = getAddressEncoder();
  const [pda] = await getProgramDerivedAddress({
    programAddress: ATA_PROGRAM,
    seeds: [enc.encode(owner), enc.encode(TOKEN_PROGRAM), enc.encode(mint)],
  });
  return pda;
}

function buildSplTransferIx(
  source: Address,
  destination: Address,
  owner: Address,
  amount: bigint
): Instruction {
  const data = new Uint8Array(9);
  data[0] = 3; // Transfer
  const view = new DataView(data.buffer);
  view.setBigUint64(1, amount, true);
  return {
    programAddress: TOKEN_PROGRAM,
    accounts: [
      { address: source, role: AccountRole.WRITABLE },
      { address: destination, role: AccountRole.WRITABLE },
      { address: owner, role: AccountRole.READONLY_SIGNER },
    ],
    data,
  };
}

async function loadSigner(telegramId: number): Promise<KeyPairSigner> {
  const enc = getEncryptedSecret(telegramId);
  if (!enc) throw new Error("Wallet not initialized.");
  const bytes = await decrypt(enc);
  return signerFromBytes(bytes);
}

export interface WithdrawParams {
  telegramId: number;
  authority: string;
  amountUsdc: number;
  destination: string;
}

export async function performWithdraw(p: WithdrawParams): Promise<{ txSig: string }> {
  if (p.amountUsdc <= 0) throw new Error("Amount must be positive");
  const amount = usdcToBaseUnits(p.amountUsdc);

  const client = getClient();
  const signer = await loadSigner(p.telegramId);
  if (signer.address !== p.authority) {
    throw new Error("Signer address does not match stored authority");
  }

  const ownerAddr = p.authority as Address;
  const destAddr = p.destination as Address;
  const sourceAta = await deriveAta(ownerAddr, USDC_MINT);
  const destAta = await deriveAta(destAddr, USDC_MINT);

  const instructions: Instruction[] = [];

  const withdrawIxs = await client.ixs.buildWithdrawIxs({
    authority: p.authority as Authority,
    amount,
    traderPdaIndex: 0,
  });
  instructions.push(...(withdrawIxs.instructions as unknown as Instruction[]));

  const createDestAta = (await buildCreateAssociatedTokenAccountIdempotent({
    payer: p.authority as Authority,
    owner: p.destination as Authority,
    mint: USDC_MINT as unknown as MintAddress,
  })) as unknown as Instruction;
  instructions.push(createDestAta);

  instructions.push(buildSplTransferIx(sourceAta, destAta, ownerAddr, amount));

  const txSig = await sendInstructions(signer, instructions);
  logger.info(
    { telegramId: p.telegramId, amount: p.amountUsdc, destination: p.destination, txSig },
    "withdraw completed"
  );
  return { txSig };
}
