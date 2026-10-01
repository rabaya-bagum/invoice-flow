import { readFileSync } from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { buildDbApp, closePool, createUser } from './helpers';

type Ctx = Awaited<ReturnType<typeof buildDbApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await buildDbApp();
});
afterAll(closePool);

const ZERO = '00000000-0000-4000-8000-000000000000';

/** Every route the API registers, read from the route files so a new route cannot be forgotten. */
function declaredRoutes() {
  const out: Array<{ method: 'get' | 'post' | 'put' | 'delete'; path: string }> = [];
  for (const file of ['catalog.ts', 'me.ts']) {
    const src = readFileSync(path.join(__dirname, '../src/routes', file), 'utf8');
    for (const m of src.matchAll(/\br\.(get|post|put|delete)\(\s*'([^']+)'/g)) {
      out.push({ method: m[1] as never, path: `/v1${m[2]}` });
    }
  }
  return out;
}
const concrete = (p: string) => p.replace(/:kind/, 'logo').replace(/:\w+/g, ZERO);

async function tenant() {
  const user = await createUser();
  const auth = await ctx.bearer(user.id);
  const call = (m: 'get' | 'post' | 'put' | 'delete', url: string) =>
    request(ctx.app)[m](url).set('Authorization', auth);
  return { user, auth, call };
}

describe('authentication on every route', () => {
  const routes = declaredRoutes();

  it('found the routes to check', () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it.each(routes.map((r) => [`${r.method.toUpperCase()} ${r.path}`, r] as const))(
    '%s requires a valid session',
    async (_name, r) => {
      const url = concrete(r.path);
      expect((await request(ctx.app)[r.method](url)).status).toBe(401);
      expect(
        (await request(ctx.app)[r.method](url).set('Authorization', 'Bearer not.a.jwt')).status,
      ).toBe(401);
    },
  );

  it('keeps unauthenticated 401s free of internals', async () => {
    const res = await request(ctx.app).get('/v1/invoices');
    expect(res.body).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Authentication required' },
    });
  });
});

describe('tenant isolation', () => {
  /** Creates one of everything for the owner, then lets a stranger poke at it. */
  async function fixture() {
    const owner = await tenant();
    const stranger = await tenant();
    const customerId = (await owner.call('post', '/v1/customers').send({ companyName: 'Acme' }))
      .body.id as string;
    const productId = (
      await owner.call('post', '/v1/products').send({ name: 'Widget', priceMinor: 500 })
    ).body.id as string;
    const taxId = (
      await owner
        .call('post', '/v1/tax-rates')
        .send({ name: 'GST', rateBps: 500, isDefault: false })
    ).body.id as string;
    const invoiceId = (
      await owner.call('post', '/v1/invoices').send({
        customerId,
        issueDate: '2026-10-01',
        dueDate: '2026-10-15',
        currency: 'USD',
        items: [{ description: 'Work', quantityMilli: 1000, unitPriceMinor: 10_000, taxes: [] }],
      })
    ).body.id as string;
    const bizId = owner.user.businessId;
    const paymentId = (
      await ctx.db.query(
        `INSERT INTO payments (business_id, invoice_id, amount_minor, currency, status, paid_at)
         VALUES ($1, $2, 1000, 'USD', 'successful', now()) RETURNING id`,
        [bizId, invoiceId],
      )
    ).rows[0].id as string;
    const notificationId = (
      await ctx.db.query(
        `INSERT INTO notifications (business_id, type, title, body, push_sent_at) VALUES ($1, 't', 'T', 'B', now()) RETURNING id`,
        [bizId],
      )
    ).rows[0].id as string;
    return { owner, stranger, customerId, productId, taxId, invoiceId, paymentId, notificationId };
  }

  it("never reveals or changes another business's records by id", async () => {
    const f = await fixture();
    const s = f.stranger.call;
    const attempts: Array<[string, Promise<{ status: number }>]> = [
      ['get customer', Promise.resolve(s('get', `/v1/customers/${f.customerId}`))],
      [
        'update customer',
        Promise.resolve(s('put', `/v1/customers/${f.customerId}`).send({ companyName: 'Hacked' })),
      ],
      ['delete customer', Promise.resolve(s('delete', `/v1/customers/${f.customerId}`))],
      ['customer invoices', Promise.resolve(s('get', `/v1/customers/${f.customerId}/invoices`))],
      ['get product', Promise.resolve(s('get', `/v1/products/${f.productId}`))],
      [
        'update product',
        Promise.resolve(
          s('put', `/v1/products/${f.productId}`).send({ name: 'Hacked', priceMinor: 1 }),
        ),
      ],
      ['delete product', Promise.resolve(s('delete', `/v1/products/${f.productId}`))],
      [
        'update tax rate',
        Promise.resolve(
          s('put', `/v1/tax-rates/${f.taxId}`).send({
            name: 'Hacked',
            rateBps: 1,
            isDefault: false,
          }),
        ),
      ],
      ['delete tax rate', Promise.resolve(s('delete', `/v1/tax-rates/${f.taxId}`))],
      ['get invoice', Promise.resolve(s('get', `/v1/invoices/${f.invoiceId}`))],
      ['update invoice', Promise.resolve(s('put', `/v1/invoices/${f.invoiceId}`).send({}))],
      ['delete invoice', Promise.resolve(s('delete', `/v1/invoices/${f.invoiceId}`))],
      [
        'transition invoice',
        Promise.resolve(s('post', `/v1/invoices/${f.invoiceId}/transition`).send({ to: 'sent' })),
      ],
      ['invoice activity', Promise.resolve(s('get', `/v1/invoices/${f.invoiceId}/activity`))],
      ['invoice pdf', Promise.resolve(s('post', `/v1/invoices/${f.invoiceId}/pdf`))],
      [
        'send invoice',
        Promise.resolve(s('post', `/v1/invoices/${f.invoiceId}/send`).send({ to: 'x@y.co' })),
      ],
      ['share link', Promise.resolve(s('post', `/v1/invoices/${f.invoiceId}/share-link`))],
      ['revoke link', Promise.resolve(s('delete', `/v1/invoices/${f.invoiceId}/share-link`))],
      ['get payment', Promise.resolve(s('get', `/v1/payments/${f.paymentId}`))],
      ['refund payment', Promise.resolve(s('post', `/v1/payments/${f.paymentId}/refund`).send({}))],
      [
        'create intent',
        Promise.resolve(s('post', '/v1/payments/create-intent').send({ invoiceId: f.invoiceId })),
      ],
      [
        'read notification',
        Promise.resolve(s('post', `/v1/notifications/${f.notificationId}/read`)),
      ],
    ];
    const offenders: string[] = [];
    for (const [name, p] of attempts) {
      const res = await p;
      // 404 (not 403) so ids cannot be probed; 4xx validation errors are fine too.
      if (![404, 400, 422, 409].includes(res.status)) offenders.push(`${name}: ${res.status}`);
    }
    expect(offenders).toEqual([]);

    // And nothing actually changed for the owner.
    const o = f.owner.call;
    expect((await o('get', `/v1/customers/${f.customerId}`)).body.companyName).toBe('Acme');
    expect((await o('get', `/v1/products/${f.productId}`)).body.name).toBe('Widget');
    expect((await o('get', `/v1/invoices/${f.invoiceId}`)).body.status).toBe('draft');
    expect((await o('get', `/v1/tax-rates`)).body.items.map((t: { id: string }) => t.id)).toContain(
      f.taxId,
    );
    const read = await ctx.db.query('SELECT read_at FROM notifications WHERE id = $1', [
      f.notificationId,
    ]);
    expect(read.rows[0].read_at).toBeNull();
  });

  it("lists never include another business's rows", async () => {
    const f = await fixture();
    for (const url of [
      '/v1/customers',
      '/v1/products',
      '/v1/invoices',
      '/v1/payments',
      '/v1/notifications',
    ]) {
      const body = (await f.stranger.call('get', url)).body;
      expect([url, body.items]).toEqual([url, []]);
    }
    expect((await f.stranger.call('get', '/v1/tax-rates')).body.items).not.toContainEqual(
      expect.objectContaining({ id: f.taxId }),
    );
  });

  it("cannot invoice another business's customer or product", async () => {
    const f = await fixture();
    const res = await f.stranger.call('post', '/v1/invoices').send({
      customerId: f.customerId,
      issueDate: '2026-10-01',
      dueDate: '2026-10-15',
      currency: 'USD',
      items: [
        {
          productId: f.productId,
          description: 'x',
          quantityMilli: 1000,
          unitPriceMinor: 1,
          taxes: [],
        },
      ],
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it("cannot remove another user's push token", async () => {
    const a = await tenant();
    const b = await tenant();
    const token = `ExponentPushToken[${Math.random().toString(36).slice(2)}abcdef]`;
    await a.call('post', '/v1/push-tokens').send({ token, platform: 'ios' });
    await b.call('delete', '/v1/push-tokens').send({ token });
    const rows = await ctx.db.query('SELECT user_id FROM push_tokens WHERE token = $1', [token]);
    expect(rows.rows).toEqual([{ user_id: a.user.id }]);
  });
});

describe('mass assignment', () => {
  it('ignores client-supplied ownership, totals, status and payment fields', async () => {
    const a = await tenant();
    const b = await tenant();
    const customer = await a.call('post', '/v1/customers').send({
      companyName: 'Acme',
      businessId: b.user.businessId,
      id: ZERO,
    });
    expect(customer.status).toBe(201);
    const owner = await ctx.db.query('SELECT business_id FROM customers WHERE id = $1', [
      customer.body.id,
    ]);
    expect(owner.rows[0].business_id).toBe(a.user.businessId);

    const inv = await a.call('post', '/v1/invoices').send({
      customerId: customer.body.id,
      issueDate: '2026-10-01',
      dueDate: '2026-10-15',
      currency: 'USD',
      items: [{ description: 'Work', quantityMilli: 1000, unitPriceMinor: 10_000, taxes: [] }],
      status: 'paid',
      totalMinor: 1,
      amountPaidMinor: 10_000,
      businessId: b.user.businessId,
      publicToken: 'abc',
    });
    expect(inv.status).toBe(201);
    expect(inv.body).toMatchObject({ status: 'draft', totalMinor: 10_000, amountPaidMinor: 0 });
    const row = await ctx.db.query('SELECT business_id, public_token FROM invoices WHERE id = $1', [
      inv.body.id,
    ]);
    expect(row.rows[0]).toEqual({ business_id: a.user.businessId, public_token: null });
  });

  it('cannot edit an invoice once money has been paid against it', async () => {
    const a = await tenant();
    const cust = (await a.call('post', '/v1/customers').send({ companyName: 'Acme' })).body.id;
    const body = (unitPriceMinor: number) => ({
      customerId: cust,
      issueDate: '2026-10-01',
      dueDate: '2026-10-15',
      currency: 'USD',
      items: [{ description: 'Work', quantityMilli: 1000, unitPriceMinor, taxes: [] }],
    });
    const inv = (await a.call('post', '/v1/invoices').send(body(10_000))).body;
    await a.call('post', `/v1/invoices/${inv.id}/transition`).send({ to: 'sent' });
    await ctx.db.query(
      "UPDATE invoices SET amount_paid_minor = 4000, status = 'partially_paid' WHERE id = $1",
      [inv.id],
    );
    const res = await a.call('put', `/v1/invoices/${inv.id}`).send(body(1));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect((await a.call('get', `/v1/invoices/${inv.id}`)).body.totalMinor).toBe(10_000);
    const del = await a.call('delete', `/v1/invoices/${inv.id}`);
    expect(del.status).toBeGreaterThanOrEqual(400);
    expect((await a.call('get', `/v1/invoices/${inv.id}`)).status).toBe(200);
  });
});

describe('input handling', () => {
  it('treats SQL metacharacters in search as plain text', async () => {
    const a = await tenant();
    await a.call('post', '/v1/customers').send({ companyName: '100% Real_Co' });
    await a.call('post', '/v1/customers').send({ companyName: 'Other' });
    for (const q of ["'; DROP TABLE customers; --", '" OR 1=1 --', '\\', '%', '_']) {
      const res = await a.call('get', `/v1/customers?search=${encodeURIComponent(q)}`);
      expect([q, res.status]).toEqual([q, 200]);
    }
    const pct = await a.call('get', `/v1/customers?search=${encodeURIComponent('100%')}`);
    expect(pct.body.items).toHaveLength(1);
    const wild = await a.call('get', `/v1/customers?search=${encodeURIComponent('%')}`);
    expect(wild.body.items).toHaveLength(1); // a literal %, not "match everything"
    const still = await a.call('get', '/v1/customers');
    expect(still.body.items).toHaveLength(2);
  });

  it('rejects malformed ids and enum values with 4xx, not 500', async () => {
    const a = await tenant();
    for (const url of [
      '/v1/customers/not-a-uuid',
      '/v1/invoices/not-a-uuid',
      '/v1/payments/not-a-uuid',
    ]) {
      const res = await a.call('get', url);
      expect([url, res.status >= 400 && res.status < 500]).toEqual([url, true]);
    }
    expect((await a.call('get', '/v1/invoices?status=nope')).status).toBe(400);
    expect((await a.call('get', '/v1/invoices?limit=-1')).status).toBe(400);
    expect((await a.call('get', '/v1/invoices?limit=100000')).status).toBeLessThan(500);
  });

  it('answers malformed and oversized bodies with a clean 4xx', async () => {
    const a = await tenant();
    const bad = await a
      .call('post', '/v1/customers')
      .set('Content-Type', 'application/json')
      .send('{"companyName": ');
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).not.toMatch(/at |node_modules|SyntaxError/);

    const big = await a.call('post', '/v1/customers').send({ companyName: 'x'.repeat(200_000) });
    expect(big.status).toBe(413 === big.status ? 413 : 400);
    expect(big.status).toBeLessThan(500);

    const wrongType = await a
      .call('post', '/v1/customers')
      .set('Content-Type', 'text/plain')
      .send('companyName=Acme');
    expect(wrongType.status).toBeGreaterThanOrEqual(400);
    expect(wrongType.status).toBeLessThan(500);
  });

  it('rejects money values that are not safe integers', async () => {
    const a = await tenant();
    const cust = (await a.call('post', '/v1/customers').send({ companyName: 'Acme' })).body.id;
    for (const unitPriceMinor of [1.5, -1, 1e21, '100', null]) {
      const res = await a.call('post', '/v1/invoices').send({
        customerId: cust,
        issueDate: '2026-10-01',
        dueDate: '2026-10-15',
        currency: 'USD',
        items: [{ description: 'x', quantityMilli: 1000, unitPriceMinor, taxes: [] }],
      });
      expect([String(unitPriceMinor), res.status]).toEqual([String(unitPriceMinor), 400]);
    }
  });
});

describe('response hardening', () => {
  it('sets security headers and does not advertise Express', async () => {
    const res = await request(ctx.app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['x-frame-options']).toBeDefined();
  });

  it('does not enable CORS for arbitrary origins on the authenticated API', async () => {
    const a = await tenant();
    const res = await a.call('get', '/v1/business').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    const pre = await request(ctx.app)
      .options('/v1/invoices')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');
    expect(pre.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns the standard envelope for unknown routes without leaking details', async () => {
    const res = await request(ctx.app).get('/v1/definitely-not-a-route');
    expect(res.status).toBe(401); // auth comes first, so route existence is not revealed
    const anon = await request(ctx.app).get('/nope');
    expect(anon.status).toBe(404);
    expect(anon.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('never leaks stack traces or SQL in error bodies', async () => {
    const a = await tenant();
    const res = await a.call('get', '/v1/invoices/not-a-uuid');
    expect(JSON.stringify(res.body)).not.toMatch(/select |insert |pg_|stack|\.ts:/i);
  });
});

describe('Stripe webhook', () => {
  it('rejects missing or invalid signatures without touching state', async () => {
    const before = (await ctx.db.query('SELECT count(*) FROM webhook_events')).rows[0].count;
    const none = await request(ctx.app)
      .post('/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .send('{"id":"evt_x","type":"payment_intent.succeeded"}');
    expect(none.status).toBeGreaterThanOrEqual(400);
    expect(none.status).toBeLessThan(500);
    const bad = await request(ctx.app)
      .post('/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 't=1,v1=deadbeef')
      .send('{"id":"evt_x","type":"payment_intent.succeeded"}');
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    const after = (await ctx.db.query('SELECT count(*) FROM webhook_events')).rows[0].count;
    expect(after).toBe(before);
  });
});
