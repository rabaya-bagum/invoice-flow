import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAC = /^[A-Za-z0-9_-]{43}$/; // base64url of 32 bytes

export const newSalt = () => randomBytes(16).toString('hex');

/** `kind` separates token families: an invoice link can never open an estimate, or the reverse. */
const mac = (secret: string, id: string, salt: string, kind?: string) =>
  createHmac('sha256', secret)
    .update(kind ? `${kind}:${id}:${salt}` : `${id}:${salt}`)
    .digest('base64url');

/** Link token = "<invoice id>.<HMAC(secret, id:salt)>". Unforgeable without the server secret. */
export function makeToken(secret: string, invoiceId: string, salt: string, kind?: string): string {
  return `${invoiceId}.${mac(secret, invoiceId, salt, kind)}`;
}

export function parseToken(token: string): { invoiceId: string; mac: string } | null {
  const [id, m, ...rest] = token.split('.');
  if (rest.length || !id || !m || !UUID.test(id) || !MAC.test(m)) return null;
  return { invoiceId: id.toLowerCase(), mac: m };
}

/** Constant-time check of a presented MAC against the expected one. */
export function verifyToken(
  secret: string,
  invoiceId: string,
  salt: string,
  presented: string,
  kind?: string,
) {
  const a = Buffer.from(mac(secret, invoiceId, salt, kind));
  const b = Buffer.from(presented);
  return a.length === b.length && timingSafeEqual(a, b);
}
