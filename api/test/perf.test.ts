import request from 'supertest';
import { buildDbApp, closePool, createUser } from './helpers';

/**
 * Performance smoke test: one business with 20,000 invoices (and 40,000 lines). The bounds are generous
 * (they must hold on a slow CI runner); they exist to catch an accidental full-scan or N+1, not to
 * benchmark. Timings are printed so a regression is visible before it trips the limit.
 */
const N = 20_000;
let ctx: Awaited<ReturnType<typeof buildDbApp>>;
let bearer: string;
let businessId: string;

beforeAll(async () => {
  ctx = await buildDbApp();
  const user = await createUser();
  businessId = user.businessId;
  bearer = await ctx.bearer(user.id);
  await ctx.db.query(
    `INSERT INTO customers (business_id, company_name, email)
     SELECT $1, 'Customer ' || g, 'c' || g || '@example.test' FROM generate_series(1, 200) g`,
    [businessId],
  );
  await ctx.db.query(
    `INSERT INTO invoices (business_id, customer_id, number, status, issue_date, due_date, currency,
        subtotal_minor, tax_total_minor, total_minor, amount_paid_minor)
     SELECT $1, c.id, 'INV-' || lpad(g::text, 6, '0'),
            (ARRAY['draft','sent','viewed','partially_paid','paid','cancelled'])[1 + g % 6]::invoice_status,
            current_date - (g % 400), current_date - (g % 400) + 14, 'USD',
            10000 + (g % 500) * 100, 500, 10500 + (g % 500) * 100,
            CASE WHEN g % 6 = 4 THEN 10500 + (g % 500) * 100 WHEN g % 6 = 3 THEN 2000 ELSE 0 END
     FROM generate_series(1, ${N}) g
     JOIN LATERAL (SELECT id FROM customers WHERE business_id = $1 ORDER BY id OFFSET (g % 200) LIMIT 1) c ON true`,
    [businessId],
  );
  await ctx.db.query(
    `INSERT INTO invoice_items (invoice_id, business_id, position, description, quantity, unit_price_minor, taxes,
        line_total_minor, tax_minor)
     SELECT i.id, i.business_id, p, 'Item ' || p, 1, 5000, '[]'::jsonb, 5000, 0
     FROM invoices i, generate_series(0, 1) p WHERE i.business_id = $1`,
    [businessId],
  );
  await ctx.db.query(
    `INSERT INTO payments (business_id, invoice_id, amount_minor, currency, status, paid_at)
     SELECT business_id, id, amount_paid_minor, 'USD', 'successful', now() - (random() * interval '300 days')
     FROM invoices WHERE business_id = $1 AND amount_paid_minor > 0`,
    [businessId],
  );
  await ctx.db.query('ANALYZE');
}, 120_000);
afterAll(async () => {
  // Keep the shared test database small and keep other suites' global overdue sweeps unaffected.
  await ctx.db.query('DELETE FROM payments WHERE business_id = $1', [businessId]);
  await ctx.db.query('DELETE FROM invoices WHERE business_id = $1', [businessId]);
  await closePool();
}, 120_000);

async function timed(label: string, url: string, limitMs: number) {
  const t0 = Date.now();
  const res = await request(ctx.app).get(url).set('Authorization', bearer);
  const ms = Date.now() - t0;
  console.log(`perf ${label}: ${ms} ms`);
  expect(res.status).toBe(200);
  expect(ms).toBeLessThan(limitMs);
  return res.body;
}

describe(`with ${N} invoices in one business`, () => {
  it('lists a page of invoices', async () => {
    const b = await timed('invoice list', '/v1/invoices?limit=25', 1500);
    expect(b.total).toBe(N);
    expect(b.items).toHaveLength(25);
  });

  it('pages deep into the list', async () => {
    await timed('invoice list offset 15000', '/v1/invoices?limit=25&offset=15000', 2000);
  });

  it('filters by status (including derived overdue and outstanding)', async () => {
    await timed('status=paid', '/v1/invoices?status=paid&limit=25', 1500);
    await timed('status=overdue', '/v1/invoices?status=overdue&limit=25', 2000);
    await timed('status=outstanding', '/v1/invoices?status=outstanding&limit=25', 2000);
  });

  it('searches by customer name, number and amount', async () => {
    await timed('search name', '/v1/invoices?search=Customer%20150&limit=25', 2500);
    await timed('search number', '/v1/invoices?search=INV-0123&limit=25', 2500);
    await timed('search amount', '/v1/invoices?search=105&limit=25', 2500);
  });

  it('filters by date range and customer', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await timed('date range', `/v1/invoices?from=2026-01-01&to=${today}&limit=25`, 2000);
  });

  it('builds the dashboard', async () => {
    const b = await timed('dashboard', '/v1/dashboard', 2500);
    expect(b.currencies[0].outstandingCount).toBeGreaterThan(0);
    await timed('dashboard this_month', '/v1/dashboard?period=this_month', 2500);
  });

  it('opens one invoice', async () => {
    const first = (await request(ctx.app).get('/v1/invoices?limit=1').set('Authorization', bearer))
      .body.items[0];
    await timed('invoice detail', `/v1/invoices/${first.id}`, 800);
  });

  it('lists payments and customers', async () => {
    await timed('payments', '/v1/payments?limit=25', 2000);
    await timed('customers', '/v1/customers?limit=25', 1000);
  });
});
