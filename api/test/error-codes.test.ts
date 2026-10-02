import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.join(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = path.join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
  });
}

/** Every error code the API can answer with, found in the code that throws it. */
const apiCodes = new Set<string>();
for (const f of files(path.join(root, 'src'))) {
  const s = readFileSync(f, 'utf8');
  for (const m of s.matchAll(/AppError\(\s*\d+,\s*'([A-Z_]+)'/g)) apiCodes.add(m[1] as string);
  for (const m of s.matchAll(/code:\s*'([A-Z_]+)'/g)) apiCodes.add(m[1] as string);
}

const mobileSrc = readFileSync(path.join(root, '../mobile/src/utils/errors.ts'), 'utf8');
const friendly = new Set([...mobileSrc.matchAll(/^\s+([A-Z_]{4,}):/gm)].map((m) => m[1] as string));

/**
 * Codes the app deliberately does not translate, each with the reason. Anything else the API can say
 * must have a plain-language message in mobile/src/utils/errors.ts.
 */
const NOT_SHOWN: Record<string, string> = {
  UNAUTHENTICATED: 'handled as an expired session (401)',
  RATE_LIMITED: 'handled as "too many attempts" (429)',
  INTERNAL: 'handled as "servers are having trouble" (5xx)',
  INVALID_SIGNATURE: 'Stripe webhook only; no user sees it',
  INVALID_PUSH_TOKEN: 'registered silently in the background',
  ALREADY_DECIDED: 'customer web page only (its own message list)',
  ESTIMATE_EXPIRED: 'customer web page only (its own message list)',
};

describe('error messages', () => {
  it('found the codes', () => {
    expect(apiCodes.size).toBeGreaterThan(30);
    expect(friendly.size).toBeGreaterThan(25);
  });

  it('gives every user-facing API error code a plain-language message in the app', () => {
    const missing = [...apiCodes].filter((c) => !friendly.has(c) && !(c in NOT_SHOWN)).sort();
    expect(missing).toEqual([]);
  });

  it('has no message for a code the API never sends (dead text)', () => {
    const dead = [...friendly].filter((c) => !apiCodes.has(c)).sort();
    expect(dead).toEqual([]);
  });

  it('does not list a code as "not shown" once it has a message', () => {
    expect(Object.keys(NOT_SHOWN).filter((c) => friendly.has(c))).toEqual([]);
  });

  it('the customer pages explain every error their script can receive', () => {
    for (const file of ['pay-client.ts', 'estimate-page.ts']) {
      const src = readFileSync(path.join(root, 'src/public', file), 'utf8');
      expect(src).toMatch(/RATE_LIMITED/);
    }
    const page = readFileSync(path.join(root, 'src/public/estimate-page.ts'), 'utf8');
    for (const c of ['ALREADY_DECIDED', 'ESTIMATE_EXPIRED', 'ALREADY_CONVERTED']) {
      expect(page).toContain(c);
    }
  });
});
