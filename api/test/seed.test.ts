import { calculateInvoice } from '@invoiceflow/shared';
import request from 'supertest';
import { parseArgs, run } from '../src/seed/cli';
import { resetBusinessData, seedDemoData, SEED_COUNTS, SeedError } from '../src/seed/seed';
import { createDatabase } from '../src/db';
import { buildDbApp, closePool, createUser, getPool } from './helpers';

let ctx: Awaited<ReturnType<typeof buildDbApp>>;
beforeAll(async () => {
  ctx = await buildDbApp();
});
afterAll(closePool);

const database = () => createDatabase(getPool());

async function seeded() {
  const user = await createUser();
  const actor = { businessId: user.businessId, userId: user.id };
  const summary = await seedDemoData(database(), actor);
  const auth = await ctx.bearer(user.id);
  const get = (url: string) => request(ctx.app).get(url).set('Authorization', auth);
  return { user, actor, summary, get };
}

describe('demo seed', () => {
  it('creates 5 customers, 10 products and 20 invoices covering every status', async () => {
    const { summary, get } = await seeded();
    expect(summary).toMatchObject({ ...SEED_COUNTS });
    expect(summary.byStatus).toEqual({
      draft: 3,
      sent: 4,
      viewed: 2,
      paid: 5,
      partial: 3,
      overdue: 3,
    });

    expect((await get('/v1/customers?limit=100')).body.total).toBe(5);
    expect((await get('/v1/products?limit=100')).body.total).toBe(10);
    const list = (await get('/v1/invoices?limit=100')).body;
    expect(list.total).toBe(20);
    const count = async (status: string) =>
      (await get(`/v1/invoices?status=${status}&limit=100`)).body.total as number;
    expect({
      draft: await count('draft'),
      sent: await count('sent'),
      viewed: await count('viewed'),
      paid: await count('paid'),
      partially_paid: await count('partially_paid'),
      overdue: await count('overdue'),
    }).toEqual({ draft: 3, sent: 4, viewed: 2, paid: 5, partially_paid: 3, overdue: 3 });
  });
  it('numbers invoices INV-0001 to INV-0020', async () => {
    const { get } = await seeded();
    const numbers = ((await get('/v1/invoices?limit=100')).body.items as { number: string }[])
      .map((i) => i.number)
      .sort();
    expect(numbers[0]).toBe('INV-0001');
    expect(numbers[19]).toBe('INV-0020');
  });

  it('stores totals identical to a fresh server calculation', async () => {
    const { user } = await seeded();
    const rows = (
      await getPool().query(
        `SELECT i.id, i.currency, i.tax_inclusive, i.discount_type, i.discount_value, i.fees_minor,
                i.total_minor, i.subtotal_minor, i.tax_total_minor, i.discount_total_minor
         FROM invoices i WHERE i.business_id = $1`,
        [user.businessId],
      )
    ).rows;
    expect(rows).toHaveLength(20);
    for (const r of rows) {
      const items = (
        await getPool().query(
          `SELECT quantity, unit_price_minor, taxes FROM invoice_items WHERE invoice_id = $1`,
          [r.id],
        )
      ).rows;
      const t = calculateInvoice({
        currency: r.currency.trim(),
        taxInclusive: r.tax_inclusive,
        feesMinor: Number(r.fees_minor),
        amountPaidMinor: 0,
        discount: r.discount_type
          ? r.discount_type === 'percent'
            ? { type: 'percent', bps: Number(r.discount_value) }
            : { type: 'fixed', amountMinor: Number(r.discount_value) }
          : undefined,
        lines: items.map((it) => ({
          quantityMilli: Math.round(Number(it.quantity) * 1000),
          unitPriceMinor: Number(it.unit_price_minor),
          taxes: it.taxes,
        })),
      } as never);
      expect(Number(r.total_minor)).toBe(t.total);
      expect(Number(r.tax_total_minor)).toBe(t.taxTotal);
    }
  });

  it("records payments that agree with each invoice's paid amount", async () => {
    const { user, summary } = await seeded();
    expect(summary.payments).toBe(8);
    const mismatched = await getPool().query(
      `SELECT i.id FROM invoices i
       WHERE i.business_id = $1
         AND i.amount_paid_minor <> coalesce((SELECT sum(amount_minor) FROM payments p WHERE p.invoice_id = i.id), 0)`,
      [user.businessId],
    );
    expect(mismatched.rows).toEqual([]);
  });

  it('feeds the dashboard consistent numbers', async () => {
    const { get } = await seeded();
    const d = (await get('/v1/dashboard')).body;
    const usd = d.currencies[0];
    expect(usd.draftCount).toBe(3);
    expect(usd.overdueCount).toBe(3);
    expect(usd.outstandingCount).toBeGreaterThanOrEqual(10);
    expect(usd.paidMinor).toBeGreaterThan(0);
    expect(d.currencies.map((c: { currency: string }) => c.currency)).toContain('EUR');
    expect(d.recentInvoices).toHaveLength(5);
    expect(d.recentPayments).toHaveLength(5);
  });

  it('refuses to seed a business that already has data', async () => {
    const { actor } = await seeded();
    await expect(seedDemoData(database(), actor)).rejects.toThrow(SeedError);
  });

  it('resets and reseeds, restarting numbering', async () => {
    const { actor, get } = await seeded();
    await resetBusinessData(database(), actor.businessId);
    expect((await get('/v1/invoices')).body.total).toBe(0);
    await seedDemoData(database(), actor);
    const numbers = ((await get('/v1/invoices?limit=100')).body.items as { number: string }[]).map(
      (i) => i.number,
    );
    expect(numbers).toContain('INV-0001');
    expect(numbers).toHaveLength(20);
  });

  it('does not touch other businesses', async () => {
    const other = await createUser();
    await getPool().query(
      `INSERT INTO customers (business_id, company_name) VALUES ($1, 'Keep Me')`,
      [other.businessId],
    );
    const { actor } = await seeded();
    await resetBusinessData(database(), actor.businessId);
    const n = await getPool().query('SELECT count(*) FROM customers WHERE business_id = $1', [
      other.businessId,
    ]);
    expect(Number(n.rows[0].count)).toBe(1);
  });
});

describe('seed CLI', () => {
  it('parses arguments', () => {
    expect(parseArgs(['--', '--email', 'a@b.co'])).toEqual({
      email: 'a@b.co',
      reset: false,
      yes: false,
    });
    expect(parseArgs(['--email=a@b.co', '--reset', '--yes'])).toEqual({
      email: 'a@b.co',
      reset: true,
      yes: true,
    });
  });

  it('requires an email and confirmation for --reset', () => {
    expect(() => parseArgs([])).toThrow(/Usage/);
    expect(() => parseArgs(['--email', 'a@b.co', '--reset'])).toThrow(/--yes/);
    expect(() => parseArgs(['--nope'])).toThrow(/Unknown/);
  });

  it('reports an unknown account', async () => {
    await expect(
      run(
        ['--email', 'nobody@example.test'],
        process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL,
      ),
    ).rejects.toThrow(/./);
  });
});
