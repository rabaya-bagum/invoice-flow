import request from 'supertest';
import { buildDbApp, closePool, createUser } from './helpers';

type Ctx = Awaited<ReturnType<typeof buildDbApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await buildDbApp();
});
afterAll(closePool);

const iso = (offsetDays: number) => {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return d.toISOString().slice(0, 10);
};

async function account() {
  const user = await createUser();
  const auth = await ctx.bearer(user.id);
  const call = (m: 'get' | 'post' | 'put' | 'delete', url: string) =>
    request(ctx.app)[m](url).set('Authorization', auth);
  const customerId = (await call('post', '/v1/customers').send({ companyName: 'Acme Ltd' })).body
    .id as string;
  /** Creates an invoice for `amount` minor units, then moves it to `status`. */
  const invoice = async (
    amount: number,
    opts: { status?: 'draft' | 'sent'; due?: number; currency?: string } = {},
  ) => {
    const inv = (
      await call('post', '/v1/invoices').send({
        customerId,
        issueDate: iso(-30),
        dueDate: iso(opts.due ?? 14),
        currency: opts.currency ?? 'USD',
        items: [{ description: 'Work', quantityMilli: 1000, unitPriceMinor: amount, taxes: [] }],
      })
    ).body as { id: string };
    if ((opts.status ?? 'sent') === 'sent') {
      await call('post', `/v1/invoices/${inv.id}/transition`).send({ to: 'sent' });
    }
    return inv.id;
  };
  /** Records money received against an invoice directly (the webhook path is covered elsewhere). */
  const pay = async (
    invoiceId: string,
    amount: number,
    over: { refunded?: number; paidAt?: string; currency?: string; status?: string } = {},
  ) => {
    const business = (
      await ctx.db.query('SELECT business_id FROM invoices WHERE id = $1', [invoiceId])
    ).rows[0].business_id;
    await ctx.db.query(
      `INSERT INTO payments (business_id, invoice_id, amount_minor, refunded_minor, currency, status, paid_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        business,
        invoiceId,
        amount,
        over.refunded ?? 0,
        over.currency ?? 'USD',
        over.status ?? 'successful',
        over.paidAt ?? new Date().toISOString(),
      ],
    );
  };
  const dash = async (period?: string) =>
    (await call('get', `/v1/dashboard${period ? `?period=${period}` : ''}`)).body;
  return { user, auth, call, invoice, pay, dash };
}

describe('GET /v1/dashboard', () => {
  it('requires authentication', async () => {
    expect((await request(ctx.app).get('/v1/dashboard')).status).toBe(401);
  });

  it('returns a zero row in the default currency for an empty business', async () => {
    const a = await account();
    await a.call('post', '/v1/business').send({ name: 'Fresh Co', defaultCurrency: 'EUR' });
    const body = await a.dash();
    expect(body.period).toBe('all');
    expect(body.currencies).toHaveLength(1);
    expect(body.currencies[0]).toMatchObject({
      currency: body.defaultCurrency,
      outstandingMinor: 0,
      overdueMinor: 0,
      draftMinor: 0,
      paidMinor: 0,
    });
    expect(body.recentInvoices).toEqual([]);
    expect(body.recentPayments).toEqual([]);
  });

  it('totals outstanding, overdue and draft by status', async () => {
    const a = await account();
    await a.invoice(10_000, { due: 10 }); // sent, not yet due
    await a.invoice(25_000, { due: -5 }); // sent, overdue
    await a.invoice(4_000, { status: 'draft' });
    const partial = await a.invoice(30_000, { due: -1 }); // overdue + partly paid
    await a.pay(partial, 12_000);
    await ctx.db.query(
      "UPDATE invoices SET amount_paid_minor = 12000, status = 'partially_paid' WHERE id = $1",
      [partial],
    );

    const t = (await a.dash()).currencies[0];
    expect(t).toMatchObject({
      outstandingMinor: 10_000 + 25_000 + 18_000,
      outstandingCount: 3,
      overdueMinor: 25_000 + 18_000,
      overdueCount: 2,
      draftMinor: 4_000,
      draftCount: 1,
      paidMinor: 12_000,
      paidCount: 1,
    });
  });

  it('matches the invoice list overdue filter', async () => {
    const a = await account();
    await a.invoice(1_000, { due: -3 });
    await a.invoice(2_000, { due: -40 });
    await a.invoice(3_000, { due: 5 });
    const list = await a.call('get', '/v1/invoices?status=overdue&limit=100');
    const listed = (list.body.items as { balanceDueMinor: number }[]).reduce(
      (s, i) => s + i.balanceDueMinor,
      0,
    );
    const t = (await a.dash()).currencies[0];
    expect(t.overdueMinor).toBe(listed);
    expect(t.overdueCount).toBe(list.body.items.length);
  });

  it('lists outstanding invoices with the same total as the dashboard card', async () => {
    const a = await account();
    await a.invoice(1_000, { due: 5 });
    await a.invoice(2_000, { due: -5 });
    await a.invoice(4_000, { status: 'draft' });
    const list = await a.call('get', '/v1/invoices?status=outstanding&limit=100');
    expect(list.body.total).toBe(2);
    const t = (await a.dash()).currencies[0];
    expect(t.outstandingCount).toBe(2);
    expect(t.outstandingMinor).toBe(3_000);
  });

  it('nets refunds out of paid and ignores pending or failed payments', async () => {
    const a = await account();
    const inv = await a.invoice(50_000);
    await a.pay(inv, 20_000, { refunded: 5_000 });
    await a.pay(inv, 9_000, { status: 'failed' });
    await a.pay(inv, 7_000, { status: 'pending' });
    const t = (await a.dash()).currencies[0];
    expect(t.paidMinor).toBe(15_000);
    expect(t.paidCount).toBe(1);
  });

  it('filters paid by period', async () => {
    const a = await account();
    const inv = await a.invoice(50_000);
    await a.pay(inv, 1_000);
    await a.pay(inv, 2_000, { paidAt: new Date(Date.now() - 400 * 86_400_000).toISOString() });
    expect((await a.dash('all')).currencies[0].paidMinor).toBe(3_000);
    expect((await a.dash('this_month')).currencies[0].paidMinor).toBe(1_000);
    expect((await a.dash('this_year')).currencies[0].paidMinor).toBe(1_000);
  });

  it('keeps currencies separate with the default first', async () => {
    const a = await account();
    await a.invoice(10_000);
    await a.invoice(7_000, { currency: 'EUR' });
    await a.invoice(3_000, { currency: 'CAD' });
    const { currencies, defaultCurrency } = await a.dash();
    expect(currencies[0].currency).toBe(defaultCurrency);
    const others = currencies.slice(1).map((c: { currency: string }) => c.currency);
    expect(others).toEqual([...others].sort());
    const by = Object.fromEntries(
      currencies.map((c: { currency: string; outstandingMinor: number }) => [
        c.currency,
        c.outstandingMinor,
      ]),
    );
    expect(by.EUR).toBe(7_000);
    expect(by.CAD).toBe(3_000);
  });

  it('returns the five most recent invoices and successful payments', async () => {
    const a = await account();
    let last = '';
    for (let i = 0; i < 7; i++) {
      last = await a.invoice(1_000 + i);
      await a.pay(last, 100 + i);
    }
    const body = await a.dash();
    expect(body.recentInvoices).toHaveLength(5);
    expect(body.recentPayments).toHaveLength(5);
  });

  it("never includes another business's figures", async () => {
    const a = await account();
    const b = await account();
    await a.invoice(99_000);
    const inv = await b.invoice(1_000);
    await b.pay(inv, 500);
    const t = (await b.dash()).currencies[0];
    expect(t.outstandingMinor).toBe(1_000);
    expect(t.paidMinor).toBe(500);
    expect((await b.dash()).recentInvoices).toHaveLength(1);
  });

  it('rejects an unknown period', async () => {
    const a = await account();
    expect((await a.call('get', '/v1/dashboard?period=decade')).status).toBe(400);
  });
});
