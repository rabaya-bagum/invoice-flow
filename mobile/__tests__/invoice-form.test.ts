import { business } from '../test-utils';
import type { Invoice } from '../src/models';
import {
  buildInvoicePayload,
  defaultLineTaxes,
  emptyLine,
  invoiceToForm,
  newInvoiceForm,
  previewTotals,
  type InvoiceForm,
} from '../src/utils/invoice-form';

const CID = '11111111-1111-4111-8111-111111111111';
const base = (over: Partial<InvoiceForm> = {}): InvoiceForm => ({
  ...newInvoiceForm(business, [], '2026-10-01'),
  customerId: CID,
  lines: [
    {
      ...emptyLine(),
      description: 'Work',
      quantity: '10',
      unitPrice: '100.00',
      taxes: [{ name: 'GST', rateBps: 500 }],
    },
  ],
  ...over,
});

describe('newInvoiceForm', () => {
  it('uses business defaults for currency, due date and tax', () => {
    const f = newInvoiceForm(business, [], '2026-10-01');
    expect(f).toMatchObject({
      currency: 'USD',
      issueDate: '2026-10-01',
      dueDate: '2026-10-15',
      customerId: null,
    });
    expect(f.lines[0]?.taxes).toEqual([{ name: 'Tax', rateBps: 500 }]); // 5% default
  });
  it('prefers a named default tax rate', () => {
    const rates = [{ id: 'r', name: 'HST', rateBps: 1300, isDefault: true }];
    expect(defaultLineTaxes(business, rates)).toEqual([{ name: 'HST', rateBps: 1300 }]);
    expect(defaultLineTaxes({ ...business, defaultTaxRateBps: 0 }, [])).toEqual([]);
  });
});

describe('buildInvoicePayload', () => {
  it('converts text to minor units, thousandths and basis points', () => {
    const { payload, errors } = buildInvoicePayload(
      base({ discountType: 'percent', discountValue: '10', fees: '25', notes: ' Thanks ' }),
    );
    expect(errors).toEqual({});
    expect(payload).toMatchObject({
      customerId: CID,
      currency: 'USD',
      feesMinor: 2500,
      notes: 'Thanks',
      discount: { type: 'percent', value: 1000 },
      items: [
        { quantityMilli: 10000, unitPriceMinor: 10000, taxes: [{ name: 'GST', rateBps: 500 }] },
      ],
    });
  });

  it('handles fixed discounts and fractional quantities exactly', () => {
    const f = base({ discountType: 'fixed', discountValue: '12.34' });
    f.lines[0] = { ...f.lines[0]!, quantity: '1.5', unitPrice: '67.78' };
    expect(buildInvoicePayload(f).payload).toMatchObject({
      discount: { type: 'fixed', value: 1234 },
      items: [{ quantityMilli: 1500, unitPriceMinor: 6778 }],
    });
  });

  it('reports field-level errors with friendly text', () => {
    const f = base({
      customerId: null,
      discountType: 'percent',
      discountValue: '150',
      fees: 'abc',
    });
    f.lines = [
      { ...emptyLine(), description: '', quantity: '-1', unitPrice: '1.234' },
      { ...emptyLine(), description: 'ok', quantity: '1', unitPrice: '5' },
    ];
    const { payload, errors } = buildInvoicePayload(f);
    expect(payload).toBeUndefined();
    expect(errors.customerId).toBeTruthy();
    expect(errors['lines.0.description']).toBe('Enter a description');
    expect(errors['lines.0.quantity']).toMatch(/Enter a quantity/);
    expect(errors['lines.0.unitPrice']).toMatch(/Enter a price/);
    expect(errors['lines.1.unitPrice']).toBeUndefined();
    expect(errors.discount).toMatch(/0 to 100/);
    expect(errors.fees).toMatch(/Enter an amount/);
  });

  it('requires a supported currency and a valid date', () => {
    expect(buildInvoicePayload(base({ currency: 'zzz' })).errors.currency).toBeTruthy();
    expect(buildInvoicePayload(base({ currency: 'cad' })).payload?.currency).toBe('CAD');
    expect(buildInvoicePayload(base({ dueDate: '2026-02-30' })).errors.dueDate).toBeTruthy();
  });

  it('needs at least one line', () => {
    expect(buildInvoicePayload(base({ lines: [] })).errors.items).toBe('Add at least one item');
  });

  it('keeps the version for optimistic concurrency', () => {
    expect(buildInvoicePayload(base({ version: 4 })).payload?.version).toBe(4);
  });
});

describe('previewTotals', () => {
  it('matches the server maths for the documented example', () => {
    const r = previewTotals(base({ discountType: 'percent', discountValue: '10', fees: '25' })) as {
      totals: { subtotal: number; discountTotal: number; taxTotal: number; total: number };
    };
    // 10h x $100 = 1000.00; 10% off; 5% GST on 900.00; + 25.00 fee
    expect(r.totals).toMatchObject({
      subtotal: 100_000,
      discountTotal: 10_000,
      taxTotal: 4_500,
      total: 97_000,
    });
  });
  it('treats unparsed lines as zero while typing', () => {
    const f = base();
    f.lines[0] = { ...f.lines[0]!, unitPrice: '12.' };
    expect((previewTotals(f) as { totals: { total: number } }).totals.total).toBe(0);
  });
  it('explains an impossible fixed discount instead of throwing', () => {
    const r = previewTotals(base({ discountType: 'fixed', discountValue: '99999' }));
    expect(r).toEqual({ error: 'Discount cannot exceed the subtotal' });
  });
  it('returns null for an unsupported currency', () => {
    expect(previewTotals(base({ currency: 'XX' }))).toBeNull();
  });
});

describe('invoiceToForm', () => {
  it('round-trips an invoice into editable text and back to the same payload', () => {
    const inv = {
      id: 'i1',
      number: 'INV-0001',
      status: 'draft',
      displayStatus: 'draft',
      customerId: CID,
      customerName: 'Acme',
      issueDate: '2026-10-01',
      dueDate: '2026-10-15',
      currency: 'USD',
      taxInclusive: true,
      discountType: 'fixed',
      discountValue: 1234,
      feesMinor: 500,
      subtotalMinor: 0,
      discountTotalMinor: 0,
      taxTotalMinor: 0,
      totalMinor: 0,
      amountPaidMinor: 0,
      balanceDueMinor: 0,
      notes: 'n',
      terms: null,
      version: 3,
      sentAt: null,
      updatedAt: '',
      taxBreakdown: [],
      warnings: [],
      editable: true,
      items: [
        {
          id: 'x',
          productId: null,
          description: 'Work',
          quantityMilli: 1500,
          unitPriceMinor: 6778,
          taxes: [{ name: 'GST', rateBps: 500 }],
          lineTotalMinor: 0,
          discountMinor: 0,
          taxMinor: 0,
        },
      ],
    } as unknown as Invoice;
    const form = invoiceToForm(inv);
    expect(form).toMatchObject({
      discountType: 'fixed',
      discountValue: '12.34',
      fees: '5.00',
      version: 3,
      taxInclusive: true,
    });
    expect(form.lines[0]).toMatchObject({ quantity: '1.5', unitPrice: '67.78' });
    expect(buildInvoicePayload(form).payload).toMatchObject({
      number: 'INV-0001',
      discount: { type: 'fixed', value: 1234 },
      feesMinor: 500,
      version: 3,
      items: [{ quantityMilli: 1500, unitPriceMinor: 6778 }],
    });
  });
});
