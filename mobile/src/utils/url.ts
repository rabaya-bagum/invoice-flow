/** Query-string parser that does not depend on URL/URLSearchParams support in the JS runtime. */
export function parseQuery(url: string): Record<string, string> {
  const q = url.split('#')[0]?.split('?')[1] ?? '';
  const out: Record<string, string> = {};
  for (const pair of q.split('&')) {
    if (!pair) continue;
    const [k = '', v = ''] = pair.split('=');
    try {
      out[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    } catch {
      /* skip malformed pair */
    }
  }
  return out;
}

/**
 * On a physical device "localhost" is the phone itself, so in development a localhost API URL is
 * pointed at the machine serving the bundle (Expo's hostUri, e.g. "10.0.0.193:8081") instead.
 */
export function resolveDevApiUrl(baseUrl: string, hostUri: string | undefined): string {
  const devHost = hostUri?.split(':')[0];
  if (!devHost) return baseUrl;
  return baseUrl.replace(/^(https?:\/\/)(localhost|127\.0\.0\.1)(?=[:/]|$)/, `$1${devHost}`);
}
