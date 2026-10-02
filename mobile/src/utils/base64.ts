const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Bytes -> base64 without relying on Buffer/btoa (neither is guaranteed in React Native). */
export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += CHARS[(n >> 18) & 63] + CHARS[(n >> 12) & 63];
    out += b === undefined ? '=' : CHARS[(n >> 6) & 63];
    out += c === undefined ? '=' : CHARS[n & 63];
  }
  return out;
}

/** base64 -> bytes (inverse of bytesToBase64). Throws on anything that is not valid base64. */
export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/=+$/, '');
  if (clean.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(clean)) throw new Error('invalid base64');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (CHARS.indexOf(clean[i] as string) << 18) |
      (CHARS.indexOf(clean[i + 1] as string) << 12) |
      ((clean[i + 2] ? CHARS.indexOf(clean[i + 2] as string) : 0) << 6) |
      (clean[i + 3] ? CHARS.indexOf(clean[i + 3] as string) : 0);
    out[o++] = (n >> 16) & 255;
    if (clean[i + 2]) out[o++] = (n >> 8) & 255;
    if (clean[i + 3]) out[o++] = n & 255;
  }
  return out;
}
