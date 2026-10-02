import {
  SUPPORTED_CURRENCIES,
  addDays,
  displayStatus,
  getExponent,
  todayInTimezone,
} from '@invoiceflow/shared';
import request from 'supertest';
import { buildDbApp, closePool, createUser } from './helpers';

type Ctx = Awaited<ReturnType<typeof buildDbApp>>;
let ctx: Ctx;

beforeAll(async () => {
  ctx = await buildDbApp();
});
afterAll(closePool);

/** A fresh account with its own token and helpers, so suites never interfere. */
async function account() {
  const user = await createUser();
  const auth = await ctx.bearer(user.id);
  const call = (m: 'get' | 'post' | 'put' | 'delete', url: string) =>
    request(ctx.app)[m](url).set('Authorization', auth);
  const customer = async (body: object = { companyName: 'Acme Ltd' }) =>
    (await call('post', '/v1/customers').send(body)).body.id as string;
  return { user, auth, call, customer };
}

const item = (over: object = {}) => ({
  description: 'Web Development',
  quantityMilli: 10_000,
  unitPriceMinor: 10_000,
  taxes: [{ name: 'GST', rateBps: 500 }],
  ...over,
});
const invoiceBody = (customerId: string, over: object = {}) => ({
  customerId,
  issueDate: '2026-10-01',
  dueDate: '2026-10-15',
  currency: 'USD',
  items: [item()],
  ...over,
});

describe('create and calculation', () => {
  it('computes totals on the server and auto-numbers', async () => {
    const a = await account();
    const cid = await a.customer();
    const res = await a.call('post', '/v1/invoices').send(
      invoiceBody(cid, {
        items: [
          item(),
          item({
            description: 'Consulting',
            quantityMilli: 1_500,
            unitPriceMinor: 15_000,
            taxes: [],
          }),
        ],
        discount: { type: 'percent', value: 1_000 },
        feesMinor: 2_500,
        notes: 'Thanks',
        // A tampering client: all of this must be ignored.
        totalMinor: 1,
        subtotalMinor: 1,
        balanceDueMinor: 0,
        status: 'paid',
        amountPaidMinor: 999_999,
      }),
    );
    expect(res.status).toBe(201);
    // subtotal 1000.00 + 225.00 = 1225.00 ; 10% discount = 122.50 ; GST on (1000 - 100)=900 -> 45.00
    expect(res.body).toMatchObject({
      number: 'INV-0001',
      status: 'draft',
      displayStatus: 'draft',
      subtotalMinor: 122_500,
      discountTotalMinor: 12_250,
      taxTotalMinor: 4_500,
      feesMinor: 2_500,
      totalMinor: 117_250, // 1225.00 - 122.50 discount + 45.00 tax + 25.00 fees
      balanceDueMinor: 117_250,
      amountPaidMinor: 0,
      editable: true,
      customerName: 'Acme Ltd',
    });
    expect(res.body.taxBreakdown).toEqual([
      { name: 'GST', rateBps: 500, taxableAmount: 90_000, tax: 4_500 },
    ]);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[1]).toMatchObject({ quantityMilli: 1_500, lineTotalMinor: 22_500 });
  });

  it('handles tax-inclusive pricing', async () => {
    const a = await account();
    const cid = await a.customer();
    const res = await a.call('post', '/v1/invoices').send(
      invoiceBody(cid, {
        taxInclusive: true,
        items: [item({ quantityMilli: 1_000, unitPriceMinor: 10_500 })],
      }),
    );
    expect(res.body).toMatchObject({ totalMinor: 10_500, taxTotalMinor: 500 });
  });

  it('stores money as integer cents', async () => {
    const a = await account();
    const cid = await a.customer();
    const res = await a.call('post', '/v1/invoices').send(
      invoiceBody(cid, {
        items: [item({ quantityMilli: 1_000, unitPriceMinor: 6_778, taxes: [] })],
      }),
    );
    const row = await ctx.db.query(
      'SELECT total_minor, pg_typeof(total_minor)::text AS t FROM invoices WHERE id = $1',
      [res.body.id],
    );
    expect(row.rows[0]).toMatchObject({ total_minor: 6_778, t: 'bigint' });
  });

  it.each([
    ['fixed discount over subtotal', { discount: { type: 'fixed', value: 10_000_000 } }, 422],
    ['percent discount over 100%', { discount: { type: 'percent', value: 10_001 } }, 400],
    ['negative quantity', { items: [item({ quantityMilli: -1 })] }, 400],
    ['negative price', { items: [item({ unitPriceMinor: -5 })] }, 400],
    ['unknown currency', { currency: 'ZZZ' }, 400],
    ['no items', { items: [] }, 400],
    ['bad date', { issueDate: '2026-02-30' }, 400],
  ])('rejects %s', async (_n, patch, status) => {
    const a = await account();
    const res = await a.call('post', '/v1/invoices').send(invoiceBody(await a.customer(), patch));
    expect(res.status).toBe(status);
  });

  it('warns (but allows) a due date before the issue date', async () => {
    const a = await account();
    const res = await a
      .call('post', '/v1/invoices')
      .send(invoiceBody(await a.customer(), { dueDate: '2026-09-01' }));
    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual(['DUE_DATE_BEFORE_ISSUE_DATE']);
  });
});

describe('invoice numbers', () => {
  it('allocates unique sequential numbers under concurrency', async () => {
    const a = await account();
    const cid = await a.customer();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => a.call('post', '/v1/invoices').send(invoiceBody(cid))),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const numbers = results.map((r) => r.body.number).sort();
    expect(numbers).toEqual(
      Array.from({ length: 8 }, (_, i) => `INV-${String(i + 1).padStart(4, '0')}`),
    );
  });

  it('rejects a duplicate manual number but allows it in another business', async () => {
    const a = await account();
    const b = await account();
    const [ca, cb] = [await a.customer(), await b.customer()];
    expect(
      (await a.call('post', '/v1/invoices').send(invoiceBody(ca, { number: 'CUSTOM-1' }))).status,
    ).toBe(201);
    const dup = await a.call('post', '/v1/invoices').send(invoiceBody(ca, { number: 'CUSTOM-1' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('NUMBER_EXISTS');
    expect(
      (await b.call('post', '/v1/invoices').send(invoiceBody(cb, { number: 'CUSTOM-1' }))).status,
    ).toBe(201);
  });

  it('auto numbering skips a number already taken manually', async () => {
    const a = await account();
    const cid = await a.customer();
    await a.call('post', '/v1/invoices').send(invoiceBody(cid, { number: 'INV-0002' }));
    const n1 = await a.call('post', '/v1/invoices').send(invoiceBody(cid)); // INV-0001
    const n2 = await a.call('post', '/v1/invoices').send(invoiceBody(cid)); // INV-0002 taken -> INV-0003
    expect([n1.body.number, n2.body.number]).toEqual(['INV-0001', 'INV-0003']);
  });

  it('honours the business prefix and padding', async () => {
    const a = await account();
    await a.call('put', '/v1/business').send({ invoicePrefix: 'AC-', numberPadding: 6 });
    const res = await a.call('post', '/v1/invoices').send(invoiceBody(await a.customer()));
    expect(res.body.number).toBe('AC-000001');
  });

  it('a failed create does not burn a number', async () => {
    const a = await account();
    const cid = await a.customer();
    await a
      .call('post', '/v1/invoices')
      .send(invoiceBody(cid, { discount: { type: 'fixed', value: 99_999_999 } })); // 422
    expect((await a.call('post', '/v1/invoices').send(invoiceBody(cid))).body.number).toBe(
      'INV-0001',
    );
  });
});

describe('references', () => {
  it("rejects another business's, deleted, and unknown customers and products", async () => {
    const a = await account();
    const b = await account();
    const foreign = await b.customer();
    const gone = await a.customer();
    await a.call('delete', `/v1/customers/${gone}`);
    for (const customerId of [foreign, gone, '99999999-9999-4999-8999-999999999999']) {
      const res = await a.call('post', '/v1/invoices').send(invoiceBody(customerId));
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_CUSTOMER');
    }
    const foreignProduct = (await b.call('post', '/v1/products').send({ name: 'P', priceMinor: 1 }))
      .body.id;
    const res = await a
      .call('post', '/v1/invoices')
      .send(invoiceBody(await a.customer(), { items: [item({ productId: foreignProduct })] }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_PRODUCT');
  });

  it('links an own product', async () => {
    const a = await account();
    const pid = (
      await a.call('post', '/v1/products').send({ name: 'Consulting', priceMinor: 15_000 })
    ).body.id;
    const res = await a
      .call('post', '/v1/invoices')
      .send(invoiceBody(await a.customer(), { items: [item({ productId: pid })] }));
    expect(res.status).toBe(201);
    expect(res.body.items[0].productId).toBe(pid);
    // Deleting the product later must not touch the invoice.
    await a.call('delete', `/v1/products/${pid}`);
    expect((await a.call('get', `/v1/invoices/${res.body.id}`)).body.items[0]).toMatchObject({
      productId: null,
      description: 'Web Development',
    });
  });
});

describe('update, delete and status', () => {
  it('recalculates on update and bumps the version', async () => {
    const a = await account();
    const cid = await a.customer();
    const created = (await a.call('post', '/v1/invoices').send(invoiceBody(cid))).body;
    const res = await a.call('put', `/v1/invoices/${created.id}`).send(
      invoiceBody(cid, {
        version: created.version,
        items: [item({ quantityMilli: 2_000, taxes: [] })],
      }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      totalMinor: 20_000,
      version: created.version + 1,
      number: created.number,
    });
    expect(res.body.items).toHaveLength(1); // items are replaced, not appended
  });

  it('rejects a stale version', async () => {
    const a = await account();
    const cid = await a.customer();
    const created = (await a.call('post', '/v1/invoices').send(invoiceBody(cid))).body;
    await a.call('put', `/v1/invoices/${created.id}`).send(invoiceBody(cid));
    const stale = await a
      .call('put', `/v1/invoices/${created.id}`)
      .send(invoiceBody(cid, { version: created.version }));
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('locks invoices that have payments or are paid/cancelled', async () => {
    const a = await account();
    const cid = await a.customer();
    const id = (await a.call('post', '/v1/invoices').send(invoiceBody(cid))).body.id;
    await ctx.db.query(
      "UPDATE invoices SET status = 'partially_paid', amount_paid_minor = 100 WHERE id = $1",
      [id],
    );
    const res = await a.call('put', `/v1/invoices/${id}`).send(invoiceBody(cid));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVOICE_LOCKED');
    expect((await a.call('get', `/v1/invoices/${id}`)).body.editable).toBe(false);
  });

  it('deletes drafts only', async () => {
    const a = await account();
    const cid = await a.customer();
    const draft = (await a.call('post', '/v1/invoices').send(invoiceBody(cid))).body.id;
    const sent = (await a.call('post', '/v1/invoices').send(invoiceBody(cid))).body.id;
    await a.call('post', `/v1/invoices/${sent}/transition`).send({ to: 'sent' });
    expect((await a.call('delete', `/v1/invoices/${draft}`)).status).toBe(204);
    expect((await a.call('get', `/v1/invoices/${draft}`)).status).toBe(404);
    const res = await a.call('delete', `/v1/invoices/${sent}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVOICE_NOT_DRAFT');
  });

  it('follows the status rules and records activity', async () => {
    const a = await account();
    const id = (await a.call('post', '/v1/invoices').send(invoiceBody(await a.customer()))).body.id;
    const t = (to: string) => a.call('post', `/v1/invoices/${id}/transition`).send({ to });

    expect((await t('paid')).status).toBe(400); // not a manual transition
    const sent = await t('sent');
    expect(sent.status).toBe(200);
    expect(sent.body.status).toBe('sent');
    expect(sent.body.sentAt).not.toBeNull();
    expect((await t('sent')).body.error.code).toBe('INVALID_TRANSITION');
    expect((await t('cancelled')).body.status).toBe('cancelled');
    expect((await t('sent')).status).toBe(409); // cancelled is final
    expect(
      (await a.call('put', `/v1/invoices/${id}`).send(invoiceBody(await a.customer()))).status,
    ).toBe(409);

    const activity = await a.call('get', `/v1/invoices/${id}/activity`);
    expect(activity.body.items.map((x: { type: string }) => x.type)).toEqual([
      'created',
      'sent',
      'cancelled',
    ]);
  });

  it('writes audit log entries for mutations', async () => {
    const a = await account();
    const cid = await a.customer();
    const id = (await a.call('post', '/v1/invoices').send(invoiceBody(cid))).body.id;
    await a.call('put', `/v1/invoices/${id}`).send(invoiceBody(cid));
    await a.call('delete', `/v1/invoices/${id}`);
    const rows = await ctx.db.query(
      'SELECT action FROM audit_logs WHERE user_id = $1 AND entity_type = $2 ORDER BY created_at',
      [a.user.id, 'invoice'],
    );
    expect(rows.rows.map((r) => r.action)).toEqual([
      'invoice.create',
      'invoice.update',
      'invoice.delete',
    ]);
  });
});

describe('overdue', () => {
  const tz = 'Pacific/Kiritimati'; // UTC+14: "today" differs from UTC for most of the day

  it('is derived from the due date in the business timezone and agrees with the shared rule', async () => {
    const a = await account();
    await a.call('put', '/v1/business').send({ timezone: tz });
    const cid = await a.customer();
    const today = todayInTimezone(tz);
    const make = async (dueDate: string, status?: string, paid = 0) => {
      const id = (
        await a
          .call('post', '/v1/invoices')
          .send(invoiceBody(cid, { issueDate: addDays(today, -40), dueDate }))
      ).body.id;
      if (status)
        await ctx.db.query(
          'UPDATE invoices SET status = $2, amount_paid_minor = $3 WHERE id = $1',
          [id, status, paid],
        );
      return id;
    };
    const cases = [
      { id: await make(addDays(today, -1), 'sent'), expected: 'overdue' },
      { id: await make(addDays(today, -1), 'viewed'), expected: 'overdue' },
      { id: await make(addDays(today, -1), 'partially_paid', 5_000), expected: 'overdue' },
      { id: await make(today, 'sent'), expected: 'sent' }, // due today is not overdue
      { id: await make(addDays(today, 5), 'sent'), expected: 'sent' },
      { id: await make(addDays(today, -1)), expected: 'draft' },
      { id: await make(addDays(today, -1), 'cancelled'), expected: 'cancelled' },
      { id: await make(addDays(today, -1), 'paid', 50_000), expected: 'paid' },
    ];
    for (const c of cases) {
      const inv = (await a.call('get', `/v1/invoices/${c.id}`)).body;
      expect(inv.displayStatus).toBe(c.expected);
      expect(displayStatus(inv, today)).toBe(c.expected); // SQL and shared TS agree
    }

    const overdue = await a.call('get', '/v1/invoices?status=overdue');
    expect(overdue.body.total).toBe(3);
    const sent = await a.call('get', '/v1/invoices?status=sent');
    expect(sent.body.total).toBe(2); // overdue ones are excluded from "sent"
    expect((await a.call('get', '/v1/invoices?status=draft')).body.total).toBe(1);
  });
});

describe('list, search and filters', () => {
  let a: Awaited<ReturnType<typeof account>>;
  beforeAll(async () => {
    a = await account();
    const ann = await a.customer({ firstName: 'Ann', lastName: 'Lee', email: 'ann@lee.co' });
    const acme = await a.customer({ companyName: 'Acme Ltd' });
    const mk = (customerId: string, over: object) =>
      a.call('post', '/v1/invoices').send(invoiceBody(customerId, over));
    await mk(ann, {
      issueDate: '2026-09-02',
      dueDate: '2026-09-16',
      items: [item({ taxes: [], unitPriceMinor: 12_550, quantityMilli: 1_000 })],
    }); // $125.50
    await mk(acme, {
      issueDate: '2026-09-20',
      dueDate: '2026-10-04',
      items: [item({ taxes: [], unitPriceMinor: 99_900, quantityMilli: 1_000 })],
    }); // $999.00
    await mk(acme, {
      issueDate: '2026-10-01',
      dueDate: '2026-10-15',
      currency: 'JPY',
      items: [item({ taxes: [], unitPriceMinor: 5_000, quantityMilli: 1_000 })],
    }); // ¥5000
  });

  it('lists newest first with a total, and pages', async () => {
    const all = await a.call('get', '/v1/invoices');
    expect(all.body.total).toBe(3);
    expect(all.body.items.map((i: { issueDate: string }) => i.issueDate)).toEqual([
      '2026-10-01',
      '2026-09-20',
      '2026-09-02',
    ]);
    const page = await a.call('get', '/v1/invoices?limit=1&offset=1');
    expect(page.body.items).toHaveLength(1);
    expect(page.body.total).toBe(3);
    expect(page.body.items[0]).toMatchObject({ customerName: 'Acme Ltd' });
  });

  it('searches by customer, number and amount', async () => {
    const q = async (s: string) =>
      (await a.call('get', `/v1/invoices?search=${encodeURIComponent(s)}`)).body.total;
    expect(await q('ann lee')).toBe(1);
    expect(await q('acme')).toBe(2);
    expect(await q('ann@lee')).toBe(1);
    expect(await q('INV-0002')).toBe(1);
    expect(await q('125.50')).toBe(1);
    expect(await q('999')).toBe(1);
    expect(await q('5000')).toBe(1); // JPY has no decimals
    expect(await q('125.5')).toBe(1);
    expect(await q('nobody')).toBe(0);
  });

  it('treats wildcards literally and is not injectable', async () => {
    const q = async (s: string) => a.call('get', `/v1/invoices?search=${encodeURIComponent(s)}`);
    expect((await q('%')).body.total).toBe(0);
    expect((await q('_')).body.total).toBe(0);
    const inj = await q("'; DROP TABLE invoices; --");
    expect(inj.status).toBe(200);
    expect(inj.body.total).toBe(0);
    expect((await a.call('get', '/v1/invoices')).body.total).toBe(3);
  });

  it('filters by date range (inclusive) and rejects bad ones', async () => {
    const q = async (s: string) => (await a.call('get', `/v1/invoices?${s}`)).body.total;
    expect(await q('from=2026-09-20&to=2026-10-01')).toBe(2);
    expect(await q('from=2026-10-02')).toBe(0);
    expect(await q('to=2026-09-02')).toBe(1);
    expect((await a.call('get', '/v1/invoices?from=2026-13-01')).status).toBe(400);
    expect((await a.call('get', '/v1/invoices?status=bogus')).status).toBe(400);
  });

  it('shows invoice history per customer', async () => {
    const list = await a.call('get', '/v1/invoices?limit=100');
    const acmeId = list.body.items.find(
      (i: { customerName: string }) => i.customerName === 'Acme Ltd',
    ).customerId;
    const hist = await a.call('get', `/v1/customers/${acmeId}/invoices`);
    expect(hist.body.total).toBe(2);
    expect(hist.body.items.every((i: { customerId: string }) => i.customerId === acmeId)).toBe(
      true,
    );
  });
});

describe('cross-account isolation (IDOR)', () => {
  it("B cannot read or change A's invoices, or use A's customers", async () => {
    const a = await account();
    const b = await account();
    const cidA = await a.customer();
    const inv = (await a.call('post', '/v1/invoices').send(invoiceBody(cidA))).body;

    expect((await b.call('get', `/v1/invoices/${inv.id}`)).status).toBe(404);
    expect((await b.call('get', `/v1/invoices/${inv.id}/activity`)).status).toBe(404);
    expect(
      (await b.call('put', `/v1/invoices/${inv.id}`).send(invoiceBody(await b.customer()))).status,
    ).toBe(404);
    expect((await b.call('delete', `/v1/invoices/${inv.id}`)).status).toBe(404);
    expect(
      (await b.call('post', `/v1/invoices/${inv.id}/transition`).send({ to: 'cancelled' })).status,
    ).toBe(404);
    expect(JSON.stringify((await b.call('get', '/v1/invoices?limit=100')).body)).not.toContain(
      inv.id,
    );
    expect((await b.call('get', `/v1/customers/${cidA}/invoices`)).status).toBe(404);
    expect((await b.call('post', '/v1/invoices').send(invoiceBody(cidA))).status).toBe(422);

    const after = (await a.call('get', `/v1/invoices/${inv.id}`)).body;
    expect(after).toMatchObject({
      status: 'draft',
      version: inv.version,
      totalMinor: inv.totalMinor,
    });
  });
});

describe('tax rates', () => {
  it('creates, updates, deletes and keeps a single default', async () => {
    const a = await account();
    const gst = await a
      .call('post', '/v1/tax-rates')
      .send({ name: 'GST', rateBps: 500, isDefault: true });
    expect(gst.status).toBe(201);
    const pst = await a
      .call('post', '/v1/tax-rates')
      .send({ name: 'PST', rateBps: 700, isDefault: true });
    const list = (await a.call('get', '/v1/tax-rates')).body.items;
    expect(list.map((r: { name: string; isDefault: boolean }) => [r.name, r.isDefault])).toEqual([
      ['GST', false],
      ['PST', true],
    ]);

    const up = await a
      .call('put', `/v1/tax-rates/${gst.body.id}`)
      .send({ name: 'GST', rateBps: 600, isDefault: true });
    expect(up.body.rateBps).toBe(600);
    expect(
      (await a.call('get', '/v1/tax-rates')).body.items.filter(
        (r: { isDefault: boolean }) => r.isDefault,
      ),
    ).toHaveLength(1);

    expect((await a.call('delete', `/v1/tax-rates/${pst.body.id}`)).status).toBe(204);
    expect((await a.call('delete', `/v1/tax-rates/${pst.body.id}`)).status).toBe(404);
  });

  it('validates input, enforces unique names, and is isolated per business', async () => {
    const a = await account();
    const b = await account();
    expect(
      (await a.call('post', '/v1/tax-rates').send({ name: 'X', rateBps: 10_001 })).status,
    ).toBe(400);
    expect((await a.call('post', '/v1/tax-rates').send({ name: '', rateBps: 1 })).status).toBe(400);
    const r = await a.call('post', '/v1/tax-rates').send({ name: 'VAT', rateBps: 2_000 });
    expect(
      (await b.call('put', `/v1/tax-rates/${r.body.id}`).send({ name: 'VAT', rateBps: 1 })).status,
    ).toBe(404);
    expect((await b.call('delete', `/v1/tax-rates/${r.body.id}`)).status).toBe(404);
    expect((await b.call('get', '/v1/tax-rates')).body.items).toEqual([]);
  });

  it('a default update for a missing rate (404) leaves the current default alone', async () => {
    const a = await account();
    const b = await account();
    const gst = await a
      .call('post', '/v1/tax-rates')
      .send({ name: 'GST', rateBps: 500, isDefault: true });
    const gone = await a.call('post', '/v1/tax-rates').send({ name: 'Old', rateBps: 100 });
    await a.call('delete', `/v1/tax-rates/${gone.body.id}`);
    const defaults = async () =>
      (await a.call('get', '/v1/tax-rates')).body.items
        .filter((r: { isDefault: boolean }) => r.isDefault)
        .map((r: { id: string }) => r.id);

    const missing = await a
      .call('put', `/v1/tax-rates/${gone.body.id}`)
      .send({ name: 'Old', rateBps: 100, isDefault: true });
    expect(missing.status).toBe(404);
    expect(await defaults()).toEqual([gst.body.id]);

    // Another business's rate is "missing" too, and must not touch this business's default.
    const theirs = await b.call('post', '/v1/tax-rates').send({ name: 'VAT', rateBps: 2_000 });
    const foreign = await a
      .call('put', `/v1/tax-rates/${theirs.body.id}`)
      .send({ name: 'VAT', rateBps: 2_000, isDefault: true });
    expect(foreign.status).toBe(404);
    expect(await defaults()).toEqual([gst.body.id]);
  });

  it('deleting a rate does not change existing invoices', async () => {
    const a = await account();
    const r = await a.call('post', '/v1/tax-rates').send({ name: 'GST', rateBps: 500 });
    const inv = (await a.call('post', '/v1/invoices').send(invoiceBody(await a.customer()))).body;
    await a.call('delete', `/v1/tax-rates/${r.body.id}`);
    expect((await a.call('get', `/v1/invoices/${inv.id}`)).body.taxTotalMinor).toBe(
      inv.taxTotalMinor,
    );
  });
});

describe('database consistency', () => {
  it('currency_exponent() matches the shared currency table', async () => {
    for (const c of SUPPORTED_CURRENCIES) {
      const r = await ctx.db.query('SELECT currency_exponent($1) AS e', [c]);
      expect(r.rows[0].e).toBe(getExponent(c));
    }
  });
});
