import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
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
import { createMemoryAssetStorage } from '../src/services/asset-storage';
import { createDocumentService } from '../src/services/document-service';
import type { EmailMessage, EmailSender } from '../src/services/email';
import Stripe from 'stripe';
import { createNotificationService } from '../src/services/notification-service';
import { createOverdueService } from '../src/services/overdue-service';
import type { PushMessage, PushResult, PushSender } from '../src/services/push';
import { createPaymentService } from '../src/services/payment-service';
import type { ChargeLite, PaymentIntentLite, StripeGateway } from '../src/services/stripe-gateway';
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
    documentService: unused('documentService'),
    paymentService: unused('paymentService'),
    notificationService: unused('notificationService'),
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

export async function buildDbApp(
  env: Record<string, string> = {},
  opts: { stripe?: boolean } = {},
) {
  const { privateKey, jwks } = await makeKeys();
  const db = getPool();
  const database = createDatabase(db);
  const businessRepo = createBusinessRepository(db);
  const invoiceService = createInvoiceService(database);
  const assets = createMemoryAssetStorage();
  // Captures outgoing email; set `email.fail = true` to simulate a provider outage.
  const email: EmailSender & { sent: EmailMessage[]; fail: boolean } = {
    sent: [],
    fail: false,
    async send(m) {
      if (this.fail) throw new Error('provider down');
      this.sent.push(m);
    },
  };
  const documentService = createDocumentService({
    db: database,
    invoices: invoiceService,
    businesses: businessRepo,
    assets,
    email,
    config: {
      PUBLIC_APP_URL: 'https://api.test',
      EMAIL_FROM: 'Test <noreply@test.dev>',
      linkSecret: 'test-secret-test-secret-test-secret-1234',
    },
  });
  // Fake push provider. Tests control delivery by calling notifications.dispatchPending() themselves.
  const push: PushSender & {
    batches: PushMessage[][];
    fail: Error | null;
    errors: Record<string, string>;
  } = {
    batches: [],
    fail: null,
    errors: {}, // token -> Expo error code to return for that token
    async send(messages) {
      if (this.fail) throw this.fail;
      this.batches.push(messages);
      return messages.map((m): PushResult =>
        this.errors[m.to]
          ? { to: m.to, ok: false, error: this.errors[m.to] }
          : { to: m.to, ok: true },
      );
    },
  };
  const realNotifications = createNotificationService({
    db: database,
    sender: push,
    log: () => undefined,
  });
  const notificationService = { ...realNotifications, kick: () => undefined }; // no background sends in tests
  const overdue = createOverdueService(database);
  const stripe = fakeStripe();
  const paymentService = createPaymentService({
    db: database,
    invoices: invoiceService,
    businesses: businessRepo,
    gateway: opts.stripe === false ? null : stripe.gateway,
    config: {
      PUBLIC_APP_URL: 'https://api.test',
      PLATFORM_FEE_BPS: 250,
      STRIPE_PUBLISHABLE_KEY: 'pk_test_123',
    },
  });
  const app = createApp(config({ STRIPE_PUBLISHABLE_KEY: 'pk_test_123', ...env }), {
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
    invoiceService,
    taxRateRepo: createTaxRateRepository(database),
    documentService,
    paymentService,
    notificationService,
  });
  const bearer = async (userId: string) => `Bearer ${await sign(privateKey, { sub: userId })}`;
  return {
    app,
    db,
    bearer,
    email,
    assets,
    stripe,
    push,
    notifications: notificationService,
    overdue,
  };
}

/**
 * Extracts text and page count from a PDF. Runs pdf-parse in a plain Node subprocess because
 * pdf.js uses dynamic imports that Jest's module system does not support.
 */
export async function pdfText(bytes: Buffer): Promise<{ text: string; pages: number }> {
  const out = spawnSync(process.execPath, [path.join(__dirname, 'pdf-extract.js')], {
    input: bytes,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (out.status !== 0) throw new Error(`pdf extraction failed: ${out.stderr.toString()}`);
  return JSON.parse(out.stdout.toString());
}

/** A valid 1x1 PNG. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// ------------------------------------------------------------------ fake Stripe
export const WEBHOOK_SECRET = 'whsec_test_secret';

// Test files run in parallel against ONE database with unique constraints on Stripe ids, so fake ids must
// be unique across fake instances and worker processes (pid + a process-wide counter).
let idSeq = 0;
const uniq = () => `${process.pid}${String(++idSeq).padStart(5, '0')}`;

interface FakeIntent extends PaymentIntentLite {
  amount: number;
  currency: string;
  params: Parameters<StripeGateway['createPaymentIntent']>[0];
}

/**
 * In-memory Stripe. Network calls are faked and recorded; webhook SIGNATURES are verified by the real
 * Stripe SDK, so signature handling is genuinely tested.
 */
export function fakeStripe() {
  const real = new Stripe('sk_test_fake');
  const accounts = new Map<
    string,
    {
      chargesEnabled: boolean;
      payoutsEnabled: boolean;
      detailsSubmitted: boolean;
      requirementsDue: string[];
    }
  >();
  const intents = new Map<string, FakeIntent>();
  const byKey = new Map<string, string>();
  const refundsByKey = new Map<string, { id: string; status: string }>();
  const state = {
    accounts,
    intents,
    refunds: [] as Array<{ paymentIntentId: string; amount: number; key: string }>,
    counts: { createPaymentIntent: 0, cancel: 0, createAccount: 0 },
    method: 'card' as ChargeLite['method'],
    failChargeLookup: 0,
    failIntentCreate: null as string | null,
  };
  const gateway: StripeGateway = {
    async createExpressAccount() {
      state.counts.createAccount++;
      const id = `acct_${uniq()}`;
      accounts.set(id, {
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        requirementsDue: ['external_account'],
      });
      return { id };
    },
    async createAccountLink(accountId, returnUrl, refreshUrl) {
      return {
        url: `https://connect.stripe.test/${accountId}?r=${encodeURIComponent(returnUrl)}&f=${encodeURIComponent(refreshUrl)}`,
      };
    },
    async retrieveAccount(id) {
      const a = accounts.get(id);
      if (!a) throw new Error('no such account');
      return a;
    },
    async createPaymentIntent(p, key) {
      const existing = byKey.get(key);
      if (existing) return intents.get(existing) as FakeIntent;
      if (state.failIntentCreate) {
        const { GatewayError } = await import('../src/services/stripe-gateway');
        throw new GatewayError(state.failIntentCreate, 'stripe says no');
      }
      state.counts.createPaymentIntent++;
      const id = `pi_${uniq()}`;
      const pi: FakeIntent = {
        id,
        clientSecret: `${id}_secret_abc`,
        status: 'requires_payment_method',
        amount: p.amount,
        currency: p.currency,
        params: p,
      };
      intents.set(id, pi);
      byKey.set(key, id);
      return pi;
    },
    async retrievePaymentIntent(id) {
      const pi = intents.get(id);
      if (!pi) throw new Error('no such intent');
      return pi;
    },
    async cancelPaymentIntent(id) {
      state.counts.cancel++;
      const pi = intents.get(id);
      if (pi) pi.status = 'canceled';
    },
    async retrieveCharge(id) {
      if (state.failChargeLookup > 0) {
        state.failChargeLookup--;
        throw new Error('stripe unavailable');
      }
      return { id, receiptUrl: `https://receipt.test/${id}`, method: state.method };
    },
    async createRefund(p, key) {
      const done = refundsByKey.get(key);
      if (done) return done;
      state.refunds.push({ ...p, key });
      const r = { id: `re_${uniq()}`, status: 'succeeded' };
      refundsByKey.set(key, r);
      return r;
    },
    constructEvent: (raw, sig) =>
      real.webhooks.constructEvent(raw, sig, WEBHOOK_SECRET) as unknown as ReturnType<
        StripeGateway['constructEvent']
      >,
  };

  /** Builds a validly signed webhook request body + header. */
  function signed(type: string, object: unknown, id = `evt_${uniq()}`) {
    const payload = JSON.stringify({ id, object: 'event', type, data: { object } });
    return {
      id,
      body: payload,
      signature: real.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET }),
    };
  }

  /** Customer completes payment at Stripe: intent succeeds, and we get the webhook payload. */
  function succeededEvent(intentId: string, over: Record<string, unknown> = {}, eventId?: string) {
    const pi = intents.get(intentId) as FakeIntent;
    pi.status = 'succeeded';
    return signed(
      'payment_intent.succeeded',
      {
        id: intentId,
        object: 'payment_intent',
        amount: pi.amount,
        amount_received: pi.amount,
        currency: pi.currency,
        latest_charge: `ch_${intentId}`,
        status: 'succeeded',
        ...over,
      },
      eventId,
    );
  }
  const failedEvent = (intentId: string, code = 'card_declined', eventId?: string) =>
    signed(
      'payment_intent.payment_failed',
      { id: intentId, object: 'payment_intent', last_payment_error: { code } },
      eventId,
    );
  const refundedEvent = (intentId: string, amountRefundedStripe: number, eventId?: string) =>
    signed(
      'charge.refunded',
      {
        id: `ch_${intentId}`,
        object: 'charge',
        payment_intent: intentId,
        amount_refunded: amountRefundedStripe,
      },
      eventId,
    );

  return { gateway, state, signed, succeededEvent, failedEvent, refundedEvent };
}
