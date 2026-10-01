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
