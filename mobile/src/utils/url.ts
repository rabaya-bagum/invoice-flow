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
