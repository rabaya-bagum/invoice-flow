import {
  addDays,
  canTransition,
  dateRangeFor,
  defaultInvoiceEmail,
  sendInvoiceInputSchema,
  displayStatus,
  INVOICE_STATUSES,
  invoiceInputSchema,
  invoiceListQuerySchema,
  isEditable,
  isValidDate,
  quantityToDecimalString,
  todayInTimezone,
} from '../src';

describe('dates', () => {
  it('validates calendar dates', () => {
    expect(isValidDate('2026-02-28')).toBe(true);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('26-01-01')).toBe(false);
  });
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
  it('computes today in a timezone', () => {
    const now = new Date('2026-10-01T02:30:00Z');
    expect(todayInTimezone('UTC', now)).toBe('2026-10-01');
    expect(todayInTimezone('America/Toronto', now)).toBe('2026-09-30');
    expect(todayInTimezone('Pacific/Auckland', now)).toBe('2026-10-01');
    expect(todayInTimezone('Not/AZone', now)).toBe('2026-10-01');
  });
  it('builds filter ranges (weeks start Monday)', () => {
    expect(dateRangeFor('today', '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-01' });
    expect(dateRangeFor('this_week', '2026-10-01')).toEqual({
      from: '2026-09-28',
      to: '2026-10-04',
    }); // Thursday
    expect(dateRangeFor('this_week', '2026-10-04')).toEqual({
      from: '2026-09-28',
      to: '2026-10-04',
    }); // Sunday
    expect(dateRangeFor('this_month', '2026-02-10')).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
  });
});

describe('invoice status rules', () => {
  it('allows the documented transitions only', () => {
    expect(canTransition('draft', 'sent')).toBe(true);
    expect(canTransition('draft', 'paid')).toBe(false);
    expect(canTransition('sent', 'viewed')).toBe(true);
    expect(canTransition('partially_paid', 'cancelled')).toBe(false);
    expect(canTransition('paid', 'refunded')).toBe(true);
    for (const s of INVOICE_STATUSES) {
      expect(canTransition('cancelled', s)).toBe(false);
      expect(canTransition(s, 'draft')).toBe(false); // nothing returns to draft
    }
  });
  it('only lets live, unpaid invoices be edited', () => {
    expect(isEditable('draft', 0)).toBe(true);
    expect(isEditable('sent', 0)).toBe(true);
    expect(isEditable('sent', 100)).toBe(false);
    expect(isEditable('paid', 0)).toBe(false);
    expect(isEditable('cancelled', 0)).toBe(false);
  });
  it('derives overdue from due date and balance', () => {
    const base = { dueDate: '2026-09-30', balanceDueMinor: 100 };
    expect(displayStatus({ ...base, status: 'sent' }, '2026-10-01')).toBe('overdue');
    expect(displayStatus({ ...base, status: 'partially_paid' }, '2026-10-01')).toBe('overdue');
    expect(displayStatus({ ...base, status: 'sent' }, '2026-09-30')).toBe('sent'); // due today is not overdue
    expect(displayStatus({ ...base, status: 'draft' }, '2026-10-01')).toBe('draft');
    expect(displayStatus({ ...base, status: 'paid', balanceDueMinor: 0 }, '2026-10-01')).toBe(
      'paid',
    );
    expect(displayStatus({ ...base, status: 'cancelled' }, '2026-10-01')).toBe('cancelled');
  });
});

describe('invoiceInputSchema', () => {
  const valid = {
    customerId: '11111111-1111-4111-8111-111111111111',
    issueDate: '2026-10-01',
    dueDate: '2026-10-15',
    currency: 'USD',
    items: [{ description: 'Work', quantityMilli: 1000, unitPriceMinor: 10000 }],
  };
  it('applies defaults and normalises', () => {
    const r = invoiceInputSchema.parse({ ...valid, number: '  ', notes: '' });
    expect(r).toMatchObject({
      number: null,
      taxInclusive: false,
      discount: null,
      feesMinor: 0,
      notes: null,
    });
    expect(r.items[0]?.taxes).toEqual([]);
  });
  it('ignores client-supplied totals', () => {
    const r = invoiceInputSchema.parse({ ...valid, totalMinor: 1, balanceDueMinor: 0 }) as Record<
      string,
      unknown
    >;
    expect(r.totalMinor).toBeUndefined();
  });
  it.each([
    ['no items', { items: [] }],
    ['negative quantity', { items: [{ description: 'x', quantityMilli: -1, unitPriceMinor: 1 }] }],
    ['negative price', { items: [{ description: 'x', quantityMilli: 1, unitPriceMinor: -1 }] }],
    ['float price', { items: [{ description: 'x', quantityMilli: 1, unitPriceMinor: 1.5 }] }],
    ['bad currency', { currency: 'usd' }],
    ['bad date', { dueDate: '2026-02-30' }],
    ['discount over 100%', { discount: { type: 'percent', value: 10001 } }],
    ['negative fixed discount', { discount: { type: 'fixed', value: -1 } }],
    ['bad customer id', { customerId: 'nope' }],
    [
      'tax over 100%',
      {
        items: [
          {
            description: 'x',
            quantityMilli: 1,
            unitPriceMinor: 1,
            taxes: [{ name: 'T', rateBps: 10001 }],
          },
        ],
      },
    ],
  ])('rejects %s', (_n, patch) => {
    expect(invoiceInputSchema.safeParse({ ...valid, ...patch }).success).toBe(false);
  });
});

describe('misc', () => {
  it('formats quantities for numeric(12,3)', () => {
    expect(quantityToDecimalString(1500)).toBe('1.500');
    expect(quantityToDecimalString(1)).toBe('0.001');
    expect(quantityToDecimalString(0)).toBe('0.000');
    expect(quantityToDecimalString(123456)).toBe('123.456');
  });
  it('parses list filters', () => {
    expect(invoiceListQuerySchema.parse({ status: 'overdue', from: '2026-01-01' })).toMatchObject({
      status: 'overdue',
      limit: 25,
    });
    expect(invoiceListQuerySchema.safeParse({ status: 'bogus' }).success).toBe(false);
    expect(invoiceListQuerySchema.safeParse({ from: '2026-99-01' }).success).toBe(false);
  });
});

describe('default invoice email', () => {
  it('matches the required wording', () => {
    const { subject, message } = defaultInvoiceEmail({
      businessName: 'Acme Studio',
      customerName: 'John Smith',
      invoiceNumber: 'INV-0001',
      totalMinor: 125_000,
      currency: 'USD',
      dueDate: '2026-10-15',
    });
    expect(subject).toBe('Invoice INV-0001 from Acme Studio');
    expect(message).toBe(
      'Hi John Smith,\n\nPlease find attached invoice INV-0001 for $1,250.00.\n\nPayment is due on October 15, 2026.\n\nThank you.',
    );
  });
  it('validates send input', () => {
    expect(sendInvoiceInputSchema.parse({})).toEqual({ to: null, subject: null, message: null });
    expect(sendInvoiceInputSchema.parse({ to: ' A@B.CO ' }).to).toBe('a@b.co');
    expect(sendInvoiceInputSchema.safeParse({ to: 'nope' }).success).toBe(false);
    expect(sendInvoiceInputSchema.safeParse({ message: 'x'.repeat(5001) }).success).toBe(false);
  });
});
