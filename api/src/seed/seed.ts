import { type CurrencyCode, type InvoiceWriteInput } from '@invoiceflow/shared';
import type { Database } from '../db';
import { createCustomerRepository } from '../repositories/customer-repository';
import { createProductRepository } from '../repositories/product-repository';
import { createTaxRateRepository } from '../repositories/tax-rate-repository';
import { createEstimateService } from '../services/estimate-service';
import { createInvoiceService, type Actor } from '../services/invoice-service';

/** The demo shape: what a tester sees after `pnpm seed`. Counts are asserted by tests. */
export const SEED_COUNTS = { customers: 5, products: 10, invoices: 20, estimates: 4 } as const;

const customerSeeds = [
  {
    companyName: 'Acme Landscaping',
    firstName: 'Dana',
    lastName: 'Whitfield',
    email: 'accounts@acme-landscaping.test',
    phone: '+1 604 555 0101',
    city: 'Vancouver',
    province: 'BC',
    country: 'CA',
  },
  {
    companyName: null,
    firstName: 'Ann',
    lastName: 'Lee',
    email: 'ann.lee@example.test',
    phone: '+1 604 555 0102',
    city: 'Burnaby',
    province: 'BC',
    country: 'CA',
  },
  {
    companyName: 'Northwind Dental',
    firstName: 'Priya',
    lastName: 'Nair',
    email: 'billing@northwind-dental.test',
    phone: '+1 778 555 0103',
    city: 'Surrey',
    province: 'BC',
    country: 'CA',
  },
  {
    companyName: null,
    firstName: 'Bob',
    lastName: 'Carter',
    email: 'bob.carter@example.test',
    phone: '+1 250 555 0104',
    city: 'Victoria',
    province: 'BC',
    country: 'CA',
  },
  {
    companyName: 'Sunrise Café',
    firstName: 'Marta',
    lastName: 'Ruiz',
    email: 'hello@sunrise-cafe.test',
    phone: '+1 604 555 0105',
    city: 'Richmond',
    province: 'BC',
    country: 'CA',
  },
] as const;

const GST = 500;

// [name, price in minor units, unit, category]
const productSeeds = [
  ['Web Development', 10_000, 'hour', 'Services'],
  ['Consulting', 15_000, 'hour', 'Services'],
  ['Landscaping', 7_500, 'hour', 'Services'],
  ['Logo Design', 45_000, 'project', 'Design'],
  ['Monthly Hosting', 2_500, 'month', 'Services'],
  ['Dental Cleaning Package', 12_000, 'package', 'Health'],
  ['Catering Platter', 8_500, 'platter', 'Food'],
  ['Bookkeeping', 6_000, 'hour', 'Services'],
  ['Photography Session', 30_000, 'session', 'Design'],
  ['Website Maintenance', 20_000, 'month', 'Services'],
] as const;

type Display = 'draft' | 'sent' | 'viewed' | 'paid' | 'partial' | 'overdue';

interface InvoiceSeed {
  customer: number;
  status: Display;
  /** Days relative to today. */
  issue: number;
  due: number;
  /** [product index, quantity in thousandths]. */
  items: [number, number][];
  currency?: string;
  taxInclusive?: boolean;
  discount?: InvoiceWriteInput['discount'];
  feesMinor?: number;
  /** For partial invoices: share of the total already received, in percent. */
  paidPercent?: number;
  notes?: string;
}

// Order matters: invoices are auto-numbered INV-0001 .. INV-0020 in this order.
const invoiceSeeds: InvoiceSeed[] = [
  {
    customer: 0,
    status: 'paid',
    issue: -75,
    due: -61,
    items: [
      [2, 12_000],
      [4, 1_000],
    ],
  },
  { customer: 2, status: 'paid', issue: -70, due: -56, items: [[5, 8_000]] },
  {
    customer: 4,
    status: 'paid',
    issue: -62,
    due: -48,
    items: [
      [6, 4_000],
      [4, 1_000],
    ],
    notes: 'Thanks for your business!',
  },
  {
    customer: 1,
    status: 'paid',
    issue: -55,
    due: -41,
    items: [[3, 1_000]],
    discount: { type: 'percent', value: 1_000 },
  },
  { customer: 3, status: 'paid', issue: -48, due: -34, items: [[7, 10_000]] },
  { customer: 0, status: 'overdue', issue: -45, due: -31, items: [[2, 20_000]] },
  {
    customer: 2,
    status: 'overdue',
    issue: -38,
    due: -24,
    items: [
      [9, 1_000],
      [1, 2_000],
    ],
  },
  { customer: 4, status: 'overdue', issue: -29, due: -15, items: [[6, 6_000]], feesMinor: 1_500 },
  { customer: 1, status: 'partial', issue: -26, due: 4, items: [[0, 15_000]], paidPercent: 40 },
  { customer: 3, status: 'partial', issue: -20, due: 10, items: [[8, 2_000]], paidPercent: 50 },
  {
    customer: 0,
    status: 'partial',
    issue: -16,
    due: 14,
    items: [
      [2, 30_000],
      [4, 1_000],
    ],
    taxInclusive: true,
    paidPercent: 25,
  },
  {
    customer: 2,
    status: 'viewed',
    issue: -12,
    due: 18,
    items: [[5, 12_000]],
    discount: { type: 'fixed', value: 5_000 },
  },
  { customer: 4, status: 'viewed', issue: -9, due: 5, items: [[6, 3_000]] },
  {
    customer: 1,
    status: 'sent',
    issue: -8,
    due: 22,
    items: [
      [0, 8_000],
      [1, 1_500],
    ],
  },
  { customer: 3, status: 'sent', issue: -6, due: 24, items: [[7, 5_000]] },
  { customer: 0, status: 'sent', issue: -4, due: 10, items: [[9, 1_000]], currency: 'EUR' },
  { customer: 2, status: 'sent', issue: -2, due: 12, items: [[4, 3_000]] },
  {
    customer: 1,
    status: 'draft',
    issue: 0,
    due: 14,
    items: [
      [3, 1_000],
      [4, 1_000],
    ],
  },
  { customer: 4, status: 'draft', issue: 0, due: 14, items: [[6, 2_000]] },
  { customer: 3, status: 'draft', issue: 0, due: 14, items: [[8, 1_000]] },
];

interface EstimateSeed {
  customer: number;
  /** What the owner has done with it; "expired" is a sent estimate whose date has passed. */
  state: 'draft' | 'sent' | 'accepted' | 'expired';
  issue: number;
  expiry: number;
  items: [number, number][];
}

const estimateSeeds: EstimateSeed[] = [
  {
    customer: 3,
    state: 'draft',
    issue: 0,
    expiry: 30,
    items: [
      [3, 1_000],
      [4, 3_000],
    ],
  },
  { customer: 0, state: 'sent', issue: -5, expiry: 25, items: [[2, 40_000]] },
  { customer: 4, state: 'accepted', issue: -12, expiry: 18, items: [[6, 10_000]] },
  { customer: 2, state: 'expired', issue: -50, expiry: -20, items: [[1, 6_000]] },
];

export class SeedError extends Error {}

const dayStr = (businessToday: Date, offset: number) => {
  const d = new Date(businessToday.getTime() + offset * 86_400_000);
  return d.toISOString().slice(0, 10);
};

export interface SeedSummary {
  customers: number;
  products: number;
  invoices: number;
  estimates: number;
  payments: number;
  byStatus: Record<Display, number>;
}

/**
 * Fills an EMPTY business with demo data through the real services, so every stored total is the
 * server's own calculation. Refuses when the business already has customers, products or invoices.
 */
export async function seedDemoData(
  db: Database,
  actor: Actor,
  now: Date = new Date(),
): Promise<SeedSummary> {
  const { businessId } = actor;
  const existing = await db.query<{ n: string }>(
    `SELECT (SELECT count(*) FROM customers WHERE business_id = $1)
          + (SELECT count(*) FROM products WHERE business_id = $1)
          + (SELECT count(*) FROM invoices WHERE business_id = $1)
          + (SELECT count(*) FROM estimates WHERE business_id = $1) AS n`,
    [businessId],
  );
  if (Number(existing.rows[0]?.n) > 0) {
    throw new SeedError('This business already has data. Re-run with --reset to wipe it first.');
  }
  const tz = (
    await db.query<{ timezone: string; default_currency: string }>(
      'SELECT timezone, default_currency FROM business_profiles WHERE id = $1',
      [businessId],
    )
  ).rows[0];
  if (!tz) throw new SeedError('Business not found');
  const defaultCurrency = tz.default_currency.trim();
  // "Today" in the business's timezone, so overdue/due dates line up with what the app shows.
  const today = (
    await db.query<{ d: string }>(`SELECT (($1::timestamptz) AT TIME ZONE $2)::date::text AS d`, [
      now.toISOString(),
      tz.timezone,
    ])
  ).rows[0]!.d;
  const base = new Date(`${today}T00:00:00Z`);

  const taxRates = createTaxRateRepository(db);
  if (!(await taxRates.list(businessId)).some((t) => t.name === 'GST')) {
    await taxRates.create(businessId, { name: 'GST', rateBps: GST, isDefault: true });
  }

  const customers = createCustomerRepository(db);
  const customerIds: string[] = [];
  for (const c of customerSeeds) {
    const made = await customers.create(businessId, {
      firstName: c.firstName,
      lastName: c.lastName,
      companyName: c.companyName,
      email: c.email,
      phone: c.phone,
      addressLine1: null,
      addressLine2: null,
      city: c.city,
      province: c.province,
      postalCode: null,
      country: c.country,
      notes: null,
    });
    customerIds.push(made.id);
  }

  const products = createProductRepository(db);
  const productIds: string[] = [];
  for (const [name, priceMinor, unit, category] of productSeeds) {
    const made = await products.create(businessId, {
      name,
      description: null,
      priceMinor,
      unit,
      taxRateBps: GST,
      sku: null,
      category,
      isActive: true,
    });
    productIds.push(made.id);
  }

  const invoices = createInvoiceService(db);
  const byStatus: Record<Display, number> = {
    draft: 0,
    sent: 0,
    viewed: 0,
    paid: 0,
    partial: 0,
    overdue: 0,
  };
  let payments = 0;

  for (const s of invoiceSeeds) {
    const currency = (s.currency ?? defaultCurrency) as CurrencyCode;
    const created = await invoices.create(actor, {
      customerId: customerIds[s.customer]!,
      number: null,
      issueDate: dayStr(base, s.issue),
      dueDate: dayStr(base, s.due),
      currency,
      taxInclusive: s.taxInclusive ?? false,
      discount: s.discount ?? null,
      feesMinor: s.feesMinor ?? 0,
      notes: s.notes ?? null,
      terms: 'Payment due by the date shown. Thank you!',
      items: s.items.map(([p, quantityMilli]) => ({
        productId: productIds[p]!,
        description: productSeeds[p]![0],
        quantityMilli,
        unitPriceMinor: productSeeds[p]![1],
        taxes: [{ name: 'GST', rateBps: GST }],
      })),
    });
    byStatus[s.status]++;
    if (s.status === 'draft') continue;

    const sentAt = `${dayStr(base, s.issue)}T16:00:00Z`;
    const sets: string[] = [
      `sent_at = $2::timestamptz`,
      `created_at = $2::timestamptz - interval '2 hours'`,
    ];
    const values: unknown[] = [created.id, sentAt];
    let status = 'sent';
    let paid = 0;

    if (s.status === 'viewed') {
      status = 'viewed';
      sets.push(`viewed_at = $2::timestamptz + interval '1 day'`);
    }
    if (s.status === 'paid') {
      status = 'paid';
      paid = created.totalMinor;
      sets.push(`viewed_at = $2::timestamptz + interval '1 day'`);
      sets.push(`paid_at = $2::timestamptz + interval '3 days'`);
    }
    if (s.status === 'partial') {
      status = 'partially_paid';
      paid = Math.round((created.totalMinor * (s.paidPercent ?? 50)) / 100);
      sets.push(`viewed_at = $2::timestamptz + interval '1 day'`);
    }
    values.push(status, paid);
    await db.query(
      `UPDATE invoices SET ${sets.join(', ')}, status = $3::invoice_status, amount_paid_minor = $4
       WHERE id = $1`,
      values,
    );

    await db.query(
      `INSERT INTO invoice_activity (business_id, invoice_id, type, message, created_at)
       VALUES ($1, $2, 'sent', 'Invoice sent', $3::timestamptz)`,
      [businessId, created.id, sentAt],
    );
    if (paid > 0) {
      await db.query(
        `INSERT INTO payments (business_id, invoice_id, amount_minor, currency, status, method, paid_at, created_at)
         VALUES ($1, $2, $3, $4, 'successful', 'card', $5::timestamptz, $5::timestamptz)`,
        [businessId, created.id, paid, currency, `${dayStr(base, s.issue + 3)}T18:30:00Z`],
      );
      await db.query(
        `INSERT INTO invoice_activity (business_id, invoice_id, type, message, created_at)
         VALUES ($1, $2, 'payment_received', 'Payment received', $3::timestamptz)`,
        [businessId, created.id, `${dayStr(base, s.issue + 3)}T18:30:00Z`],
      );
      payments++;
    }
  }

  const estimates = createEstimateService(db as Database, invoices);
  for (const s of estimateSeeds) {
    const created = await estimates.create(actor, {
      customerId: customerIds[s.customer]!,
      number: null,
      issueDate: dayStr(base, s.issue),
      expiryDate: dayStr(base, s.expiry),
      currency: defaultCurrency as CurrencyCode,
      taxInclusive: false,
      discount: null,
      feesMinor: 0,
      notes: null,
      terms: 'This estimate is valid until the date shown.',
      items: s.items.map(([p, quantityMilli]) => ({
        productId: productIds[p]!,
        description: productSeeds[p]![0],
        quantityMilli,
        unitPriceMinor: productSeeds[p]![1],
        taxes: [{ name: 'GST', rateBps: GST }],
      })),
    });
    if (s.state === 'draft') continue;
    await estimates.transition(actor, created.id, 'sent');
    if (s.state === 'accepted') await estimates.transition(actor, created.id, 'accepted');
  }

  return {
    customers: customerSeeds.length,
    products: productSeeds.length,
    invoices: invoiceSeeds.length,
    estimates: estimateSeeds.length,
    payments,
    byStatus,
  };
}

/** Wipes a business's customers, products, tax rates, invoices, payments and numbering. */
export async function resetBusinessData(db: Database, businessId: string): Promise<void> {
  await db.transaction(async (tx) => {
    for (const table of [
      'notifications',
      'payments',
      'estimate_items',
      'estimates',
      'invoice_activity',
      'invoice_items',
      'invoices',
      'customers',
      'products',
      'tax_rates',
    ]) {
      await tx.query(`DELETE FROM ${table} WHERE business_id = $1`, [businessId]);
    }
    await tx.query('DELETE FROM document_sequences WHERE business_id = $1', [businessId]);
  });
}
