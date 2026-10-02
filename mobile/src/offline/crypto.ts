import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { base64ToBytes, bytesToBase64 } from '../utils/base64';

/** Version 2 of the on-device file format (version 1 was plain JSON). */
const FORMAT = 2;
const ALG = 'xchacha20poly1305';
export const KEY_BYTES = 32;
const NONCE_BYTES = 24;

export type RandomBytes = (n: number) => Uint8Array;

interface Envelope {
  v: number;
  alg: string;
  n: string;
  c: string;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

/**
 * Authenticated encryption (XChaCha20-Poly1305) of a text file. A fresh random 24-byte nonce is used for
 * every write, and `context` (the file name) is authenticated too, so a file cannot be swapped for
 * another one, and any change to the bytes makes decryption fail instead of returning altered data.
 */
export function encryptText(
  key: Uint8Array,
  context: string,
  text: string,
  random: RandomBytes,
): string {
  const nonce = random(NONCE_BYTES);
  const sealed = xchacha20poly1305(key, nonce, enc.encode(context)).encrypt(enc.encode(text));
  const env: Envelope = { v: FORMAT, alg: ALG, n: bytesToBase64(nonce), c: bytesToBase64(sealed) };
  return JSON.stringify(env);
}

/** True when the stored text is one of our encrypted envelopes (as opposed to old plain JSON). */
export function isEncrypted(stored: string): boolean {
  try {
    const e = JSON.parse(stored) as Partial<Envelope>;
    return e.v === FORMAT && e.alg === ALG && typeof e.n === 'string' && typeof e.c === 'string';
  } catch {
    return false;
  }
}

/** Returns the plain text, or throws if the key, the file name or a single byte is wrong. */
export function decryptText(key: Uint8Array, context: string, stored: string): string {
  const e = JSON.parse(stored) as Envelope;
  if (e.v !== FORMAT || e.alg !== ALG) throw new Error('unsupported format');
  const nonce = base64ToBytes(e.n);
  if (nonce.length !== NONCE_BYTES) throw new Error('bad nonce');
  return dec.decode(xchacha20poly1305(key, nonce, enc.encode(context)).decrypt(base64ToBytes(e.c)));
}
