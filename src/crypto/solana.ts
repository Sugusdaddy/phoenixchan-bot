import {
  createKeyPairSignerFromPrivateKeyBytes,
  type KeyPairSigner,
} from "@solana/kit";
import { randomBytes } from "node:crypto";

export async function generateEmbeddedWallet(): Promise<{
  signer: KeyPairSigner;
  privateKeyBytes: Uint8Array;
}> {
  const seed = new Uint8Array(randomBytes(32));
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  return { signer, privateKeyBytes: seed };
}

export async function signerFromBytes(bytes: Uint8Array): Promise<KeyPairSigner> {
  return createKeyPairSignerFromPrivateKeyBytes(bytes);
}
