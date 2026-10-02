/**
 * Customer share tokens sit in the path of the public routes, and a token alone opens the document
 * and its pay page. Request logs must never contain a working link, so the token segment is masked.
 */
const TOKEN_PATH = /^(\/(?:pay|estimate|public\/invoices|public\/estimates)\/)[^/?#]+/i;

export const REDACTED = '[redacted]';

export function redactTokenUrl(url: string): string {
  return url.replace(TOKEN_PATH, `$1${REDACTED}`);
}

/** pino-http request serializer: masks the token in `url` and `params`. */
export function redactRequest<T extends { url?: string; params?: Record<string, unknown> }>(
  req: T,
): T {
  if (typeof req.url === 'string') req.url = redactTokenUrl(req.url);
  if (req.params && 'token' in req.params) req.params = { ...req.params, token: REDACTED };
  return req;
}
