/**
 * A random RFC 4122 v4 id for a draft created on the device. It is not a secret: the server only
 * needs it to be unused, and it refuses to reuse one.
 */
export function newInvoiceId(): string {
  const hex = '0123456789abcdef';
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    return hex[c === 'x' ? r : (r & 0x3) | 0x8] as string;
  });
}
