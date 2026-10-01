import { randomUUID } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import { Pool } from 'pg';
import { createApp } from '../src/app';
import { loadConfig } from '../src/config';
import { createDatabase, createPool } from '../src/db';
import {
  createAccountRepository,
  type Account,
  type AccountRepository,
  type AuditEntry,
} from '../src/repositories/account-repository';
import { createBusinessRepository } from '../src/repositories/business-repository';
import { createCustomerRepository } from '../src/repositories/customer-repository';
import { createTaxRateRepository } from '../src/repositories/tax-rate-repository';
import { createInvoiceService } from '../src/services/invoice-service';
import { createProductRepository } from '../src/repositories/product-repository';
import { createAccountService } from '../src/services/account-service';
import {
  createBusinessService,
  createCustomerService,
  createProductService,
} from '../src/services/catalog-services';
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

const config = (extra: Record<string, string> = {}) =>
  loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent', RATE_LIMIT_PER_MINUTE: '100000', ...extra });

/** A dependency that fails loudly if a test unexpectedly reaches it. */
function unused<T extends object>(name: string): T {
  return new Proxy(
    {},
    {
      get: () => () => {
        throw new Error(`${name} not available in this test`);
      },
    },
  ) as T;
}

// ------------------------------------------------------------------ fake-backed app (no DB)
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

export async function buildTestApp(env: Record<string, string> = {}) {
  const { privateKey, jwks } = await makeKeys();
  const fake = fakeRepo();
  const app = createApp(config(env), {
    verifyToken: createTokenVerifier({ issuer: ISSUER, key: jwks, algorithms: ['ES256'] }),
    accountService: createAccountService(fake.repo),
    businessRepo: unused('businessRepo'),
    businessService: unused('businessService'),
    customerService: unused('customerService'),
    productService: unused('productService'),
    invoiceService: unused('invoiceService'),
    taxRateRepo: unused('taxRateRepo'),
  });
  return { app, privateKey, ...fake };
}

// ------------------------------------------------------------------ real-DB app
let pool: Pool | null = null;
export function getPool(): Pool {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('No test database (TEST_DATABASE_URL unset; was SKIP_DB_TESTS set?)');
  return (pool ??= createPool(url));
}
export const closePool = async () => {
  await pool?.end();
  pool = null;
};

/** Inserts an auth user; the signup trigger creates their profile and business. */
export async function createUser(email = `${randomUUID()}@example.com`) {
  const id = randomUUID();
  await getPool().query('INSERT INTO auth.users (id, email) VALUES ($1, $2)', [id, email]);
  const biz = await getPool().query<{ id: string }>(
    'SELECT id FROM business_profiles WHERE owner_id = $1',
    [id],
  );
  return { id, email, businessId: (biz.rows[0] as { id: string }).id };
}

export async function buildDbApp() {
  const { privateKey, jwks } = await makeKeys();
  const db = getPool();
  const database = createDatabase(db);
  const businessRepo = createBusinessRepository(db);
  const app = createApp(config(), {
    verifyToken: createTokenVerifier({ issuer: ISSUER, key: jwks, algorithms: ['ES256'] }),
    accountService: createAccountService(
      createAccountRepository(
        db,
        async (id) => void (await db.query('DELETE FROM auth.users WHERE id = $1', [id])),
      ),
    ),
    businessRepo,
    businessService: createBusinessService(businessRepo),
    customerService: createCustomerService(createCustomerRepository(db)),
    productService: createProductService(createProductRepository(db)),
    invoiceService: createInvoiceService(database),
    taxRateRepo: createTaxRateRepository(database),
  });
  const bearer = async (userId: string) => `Bearer ${await sign(privateKey, { sub: userId })}`;
  return { app, db, bearer };
}
