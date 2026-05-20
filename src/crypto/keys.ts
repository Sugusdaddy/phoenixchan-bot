import { webcrypto } from "node:crypto";
import { config } from "../config.js";

const subtle = webcrypto.subtle;

let _key: CryptoKey | null = null;
async function getKey(): Promise<CryptoKey> {
  if (_key) return _key;
  const hex = config.MASTER_ENCRYPTION_KEY;
  const raw = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    raw[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  _key = await subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  return _key;
}

export async function encrypt(plaintext: Uint8Array): Promise<Buffer> {
  const key = await getKey();
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return Buffer.from(out);
}

export async function decrypt(blob: Buffer | Uint8Array): Promise<Uint8Array> {
  const key = await getKey();
  const bytes = blob instanceof Buffer ? new Uint8Array(blob) : blob;
  const iv = bytes.slice(0, 12);
  const ct = bytes.slice(12);
  const pt = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
  return pt;
}
