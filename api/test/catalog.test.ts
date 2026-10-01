import request from 'supertest';
import { buildDbApp, closePool, createUser } from './helpers';

type Ctx = Awaited<ReturnType<typeof buildDbApp>>;
let ctx: Ctx;
let a: Awaited<ReturnType<typeof createUser>>;
let b: Awaited<ReturnType<typeof createUser>>;
let authA: string;
let authB: string;

beforeAll(async () => {
  ctx = await buildDbApp();
  a = await createUser();
  b = await createUser();
  authA = await ctx.bearer(a.id);
  authB = await ctx.bearer(b.id);
});
afterAll(closePool);

const asA = (m: 'get' | 'post' | 'put' | 'delete', url: string) =>
  request(ctx.app)[m](url).set('Authorization', authA);
const asB = (m: 'get' | 'post' | 'put' | 'delete', url: string) =>
  request(ctx.app)[m](url).set('Authorization', authB);

describe('authentication and routing', () => {
  it.each(['/v1/business', '/v1/customers', '/v1/products'])('%s requires a token', async (url) => {
    expect((await request(ctx.app).get(url)).status).toBe(401);
  });

  it('treats non-UUID ids as 404 without touching the database', async () => {
    expect((await asA('get', '/v1/customers/not-a-uuid')).status).toBe(404);
    expect((await asA('get', "/v1/products/1'%20OR%20'1'='1")).status).toBe(404);
  });
});

describe('business profile', () => {
  it('returns the default business created at signup', async () => {
    const res = await asA('get', '/v1/business');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: a.businessId,
      defaultCurrency: 'USD',
      invoicePrefix: 'INV-',
      numberPadding: 4,
      stripeChargesEnabled: false,
    });
  });

  it('updates only the provided fields and clears blanks', async () => {
    const res = await asA('put', '/v1/business').send({
      name: 'Acme Studio',
      phone: '555-0100',
      defaultCurrency: 'CAD',
      defaultTaxRateBps: 500,
      defaultPaymentTermsDays: 30,
      accentColor: '#112233',
      displayOptions: { showSku: false },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Acme Studio',
      phone: '555-0100',
      defaultCurrency: 'CAD',
      defaultTaxRateBps: 500,
      accentColor: '#112233',
      displayOptions: { showSku: false },
    });
    const cleared = await asA('put', '/v1/business').send({ phone: '' });
    expect(cleared.body.phone).toBeNull();
    expect(cleared.body.name).toBe('Acme Studio'); // untouched
  });

  it.each([
    ['unsupported currency', { defaultCurrency: 'ZZZ' }],
    ['negative tax rate', { defaultTaxRateBps: -1 }],
    ['tax rate over 100%', { defaultTaxRateBps: 10001 }],
    ['bad colour', { accentColor: 'blue' }],
    ['bad timezone', { timezone: 'Mars/Olympus' }],
    ['bad prefix', { invoicePrefix: 'INV 1!' }],
    ['bad website', { website: 'not a url' }],
    ['empty name', { name: ' ' }],
    ['read-only field', { stripeChargesEnabled: true }],
    ['unknown field', { ownerId: 'x' }],
  ])('rejects %s', async (_n, body) => {
    const res = await asA('put', '/v1/business').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it("never exposes or changes another account's business", async () => {
    await asB('put', '/v1/business').send({ name: 'Bob Co' });
    expect((await asA('get', '/v1/business')).body.name).toBe('Acme Studio');
    expect((await asB('get', '/v1/business')).body.id).toBe(b.businessId);
  });
});

describe('customers', () => {
  const customer = {
    firstName: 'Ann',
    lastName: 'Lee',
    companyName: 'Lee Landscaping',
    email: 'ANN@Example.com',
    city: 'Austin',
  };

  it('creates, reads, updates and soft-deletes', async () => {
    const created = await asA('post', '/v1/customers').send(customer);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ firstName: 'Ann', email: 'ann@example.com', phone: null });
    const id = created.body.id;

    expect((await asA('get', `/v1/customers/${id}`)).body.city).toBe('Austin');

    const updated = await asA('put', `/v1/customers/${id}`).send({
      companyName: 'Lee & Co',
      notes: 'VIP',
    });
    expect(updated.status).toBe(200);
    // PUT replaces: omitted fields are cleared
    expect(updated.body).toMatchObject({
      companyName: 'Lee & Co',
      notes: 'VIP',
      firstName: null,
      city: null,
    });

    expect((await asA('delete', `/v1/customers/${id}`)).status).toBe(204);
    expect((await asA('get', `/v1/customers/${id}`)).status).toBe(404);
    expect((await asA('delete', `/v1/customers/${id}`)).status).toBe(404);
    const stillThere = await ctx.db.query('SELECT deleted_at FROM customers WHERE id = $1', [id]);
    expect(stillThere.rows[0].deleted_at).not.toBeNull(); // soft delete keeps history
  });

  it.each([
    ['no name at all', { email: 'x@y.co' }],
    ['invalid email', { firstName: 'A', email: 'nope' }],
    ['over-long name', { firstName: 'x'.repeat(101) }],
  ])('rejects %s', async (_n, body) => {
    expect((await asA('post', '/v1/customers').send(body)).status).toBe(400);
  });

  it('ignores a business_id supplied in the body (no mass assignment)', async () => {
    const res = await asA('post', '/v1/customers').send({
      firstName: 'Sneaky',
      businessId: b.businessId,
      business_id: b.businessId,
    });
    expect(res.status).toBe(201);
    const row = await ctx.db.query('SELECT business_id FROM customers WHERE id = $1', [
      res.body.id,
    ]);
    expect(row.rows[0].business_id).toBe(a.businessId);
  });

  describe('search and pagination', () => {
    let owner: Awaited<ReturnType<typeof createUser>>;
    let auth: string;
    const get = (q: string) => request(ctx.app).get(`/v1/customers${q}`).set('Authorization', auth);

    beforeAll(async () => {
      owner = await createUser();
      auth = await ctx.bearer(owner.id);
      const names = ['Zed', 'Amy', 'Bob', 'Cat', 'Dan'];
      for (const n of names) {
        await request(ctx.app)
          .post('/v1/customers')
          .set('Authorization', auth)
          .send({ firstName: n, lastName: 'Test', email: `${n.toLowerCase()}@x.co` });
      }
      await request(ctx.app)
        .post('/v1/customers')
        .set('Authorization', auth)
        .send({ companyName: '100% Pure_Clean' });
    });

    it('lists alphabetically with a total', async () => {
      const r = await get('');
      expect(r.body.total).toBe(6);
      expect(r.body.items.map((c: { firstName: string | null }) => c.firstName)).toEqual([
        null,
        'Amy',
        'Bob',
        'Cat',
        'Dan',
        'Zed',
      ]);
    });

    it('pages with limit/offset', async () => {
      const r = await get('?limit=2&offset=2');
      expect(r.body.items).toHaveLength(2);
      expect(r.body.total).toBe(6);
      expect((await get('?limit=0')).status).toBe(400);
      expect((await get('?limit=101')).status).toBe(400);
    });

    it('searches names, company and email case-insensitively', async () => {
      expect((await get('?search=amy')).body.total).toBe(1);
      expect((await get('?search=CAT%20test')).body.total).toBe(1);
      expect((await get('?search=dan@x')).body.total).toBe(1);
      expect((await get('?search=pure')).body.total).toBe(1);
    });

    it('treats LIKE wildcards in search literally', async () => {
      expect((await get('?search=%25')).body.total).toBe(1); // only the "100%" company
      expect((await get('?search=_')).body.total).toBe(1); // only "Pure_Clean"
    });

    it('is not injectable through search', async () => {
      const r = await get(`?search=${encodeURIComponent("'; DROP TABLE customers; --")}`);
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(0);
      expect((await get('')).body.total).toBe(6);
    });
  });
});

describe('products', () => {
  const product = {
    name: 'Web Development',
    description: 'Hourly',
    priceMinor: 10000,
    unit: 'hour',
    taxRateBps: 500,
    sku: 'WEB-1',
    category: 'Services',
  };

  it('creates, reads, updates and deletes', async () => {
    const created = await asA('post', '/v1/products').send(product);
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ priceMinor: 10000, unit: 'hour', isActive: true });
    const id = created.body.id;

    const updated = await asA('put', `/v1/products/${id}`).send({ ...product, priceMinor: 12550 });
    expect(updated.body.priceMinor).toBe(12550);

    expect((await asA('delete', `/v1/products/${id}`)).status).toBe(204);
    expect((await asA('get', `/v1/products/${id}`)).status).toBe(404);
  });

  it.each([
    ['negative price', { ...product, sku: 'N1', priceMinor: -1 }],
    ['fractional price', { ...product, sku: 'N2', priceMinor: 10.5 }],
    ['string price', { ...product, sku: 'N3', priceMinor: '100' }],
    ['tax over 100%', { ...product, sku: 'N4', taxRateBps: 10001 }],
    ['no name', { ...product, sku: 'N5', name: '' }],
  ])('rejects %s', async (_n, body) => {
    expect((await asA('post', '/v1/products').send(body)).status).toBe(400);
  });

  it('enforces SKU uniqueness per business only', async () => {
    const sku = `SKU-${Date.now()}`;
    expect((await asA('post', '/v1/products').send({ ...product, sku })).status).toBe(201);
    const dup = await asA('post', '/v1/products').send({ ...product, sku });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('SKU_EXISTS');
    expect((await asB('post', '/v1/products').send({ ...product, sku })).status).toBe(201);
  });

  it('filters by category, search and active state', async () => {
    const owner = await createUser();
    const auth = await ctx.bearer(owner.id);
    const post = (p: object) =>
      request(ctx.app).post('/v1/products').set('Authorization', auth).send(p);
    await post({ name: 'Consulting', priceMinor: 15000, category: 'Services' });
    await post({ name: 'Mulch bag', priceMinor: 800, category: 'Goods' });
    await post({ name: 'Old service', priceMinor: 100, category: 'Services', isActive: false });
    const get = (q: string) => request(ctx.app).get(`/v1/products${q}`).set('Authorization', auth);
    expect((await get('')).body.total).toBe(2); // inactive hidden by default
    expect((await get('?includeInactive=true')).body.total).toBe(3);
    expect((await get('?category=Goods')).body.items[0].name).toBe('Mulch bag');
    expect((await get('?search=consult')).body.total).toBe(1);
  });
});

describe('cross-account isolation (IDOR)', () => {
  it("B cannot read, change or delete A's customer or product", async () => {
    const c = (await asA('post', '/v1/customers').send({ firstName: 'Private' })).body.id;
    const p = (
      await asA('post', '/v1/products').send({
        name: 'Secret',
        priceMinor: 1,
        sku: `IDOR-${Date.now()}`,
      })
    ).body.id;

    for (const [kind, id] of [
      ['customers', c],
      ['products', p],
    ] as const) {
      expect((await asB('get', `/v1/${kind}/${id}`)).status).toBe(404);
      const body =
        kind === 'customers' ? { firstName: 'Hacked' } : { name: 'Hacked', priceMinor: 1 };
      expect((await asB('put', `/v1/${kind}/${id}`).send(body)).status).toBe(404);
      expect((await asB('delete', `/v1/${kind}/${id}`)).status).toBe(404);
      const list = await asB('get', `/v1/${kind}?limit=100`);
      expect(JSON.stringify(list.body)).not.toContain(id);
    }

    // ...and A's data is untouched.
    expect((await asA('get', `/v1/customers/${c}`)).body.firstName).toBe('Private');
    expect((await asA('get', `/v1/products/${p}`)).body.name).toBe('Secret');
  });
});

describe('/v1/me against the real database', () => {
  it('returns the caller account and deletes with cascade', async () => {
    const u = await createUser();
    const auth = await ctx.bearer(u.id);
    const me = await request(ctx.app).get('/v1/me').set('Authorization', auth);
    expect(me.body.business.id).toBe(u.businessId);

    await request(ctx.app)
      .post('/v1/customers')
      .set('Authorization', auth)
      .send({ firstName: 'Gone' });
    const del = await request(ctx.app)
      .delete('/v1/me')
      .set('Authorization', auth)
      .send({ confirm: 'DELETE' });
    expect(del.status).toBe(204);

    const left = await ctx.db.query(
      'SELECT (SELECT count(*) FROM business_profiles WHERE id = $1) AS b, (SELECT count(*) FROM customers WHERE business_id = $1) AS c',
      [u.businessId],
    );
    expect(Number(left.rows[0].b) + Number(left.rows[0].c)).toBe(0);
    const audit = await ctx.db.query(
      "SELECT 1 FROM audit_logs WHERE user_id = $1 AND action = 'account.delete'",
      [u.id],
    );
    expect(audit.rowCount).toBe(1);
  });
});
