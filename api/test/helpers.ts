import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import type {
  Account,
  AccountRepository,
  AuditEntry,
} from '../src/repositories/account-repository';
import { createAccountService } from '../src/services/account-service';
import { createTokenVerifier } from '../src/services/token-verifier';

export const ISSUER = 'https://project.supabase.co/auth/v1';
export const USER_A = '11111111-1111-4111-8111-111111111111';
export const USER_B = '22222222-2222-4222-8222-222222222222';

export async function makeKeys() {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  return { privateKey, jwks: createLocalJWKSet({ keys: [jwk] }) };
}

type Key = Awaited<ReturnType<typeof makeKeys>>['privateKey'];

export function sign(
  key: Key,
  claims: { sub?: string; email?: string; aud?: string; iss?: string; exp?: string | number } = {},
) {
  return new SignJWT({ email: claims.email ?? 'a@example.com' })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setSubject(claims.sub ?? USER_A)
    .setIssuer(claims.iss ?? ISSUER)
    .setAudience(claims.aud ?? 'authenticated')
    .setIssuedAt()
    .setExpirationTime(claims.exp ?? '5m')
    .sign(key);
}

const accountFor = (id: string, name: string): Account => ({
  user: { id, fullName: name },
  business: {
    id: `biz-${id}`,
    name: `${name} Co`,
    ownerName: name,
    email: `${name}@example.com`,
    defaultCurrency: 'USD',
    timezone: 'UTC',
    stripeChargesEnabled: false,
  },
});

export function fakeRepo() {
  const accounts = new Map<string, Account>([
    [USER_A, accountFor(USER_A, 'alice')],
    [USER_B, accountFor(USER_B, 'bob')],
  ]);
  const audit: AuditEntry[] = [];
  const deleted: string[] = [];
  const repo: AccountRepository = {
    findByUserId: async (id) => accounts.get(id) ?? null,
    recordAudit: async (e) => void audit.push(e),
    deleteUser: async (id) => void (accounts.delete(id), deleted.push(id)),
  };
  return { repo, audit, deleted };
}

export async function buildTestApp() {
  const { privateKey, jwks } = await makeKeys();
  const fake = fakeRepo();
  const app = createApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }), {
    verifyToken: createTokenVerifier({ issuer: ISSUER, key: jwks, algorithms: ['ES256'] }),
    accountService: createAccountService(fake.repo),
  });
  return { app, privateKey, ...fake };
}
