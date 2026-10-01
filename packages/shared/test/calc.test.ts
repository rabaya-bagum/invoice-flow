import fc from 'fast-check';
import { calculateInvoice, MoneyError, InvoiceInput } from '../src';

const GST = { name: 'GST', rateBps: 500 };
const PST = { name: 'PST', rateBps: 700 };

describe('calculateInvoice (exclusive tax)', () => {
  it('computes the simple case', () => {
    const r = calculateInvoice({
      currency: 'USD',
      lines: [
        { quantityMilli: 10_000, unitPriceMinor: 10_000, taxes: [GST] }, // 10h x $100
        { quantityMilli: 1_000, unitPriceMinor: 15_000 }, // 1 x $150, untaxed
      ],
    });
    expect(r.subtotal).toBe(115_000);
    expect(r.taxTotal).toBe(5_000);
    expect(r.total).toBe(120_000);
    expect(r.balanceDue).toBe(120_000);
    expect(r.taxBreakdown).toEqual([
      { name: 'GST', rateBps: 500, taxableAmount: 100_000, tax: 5_000 },
    ]);
  });

  it('rounds line totals half up on fractional quantities', () => {
    // 0.333 x $1.00 = 33.3c -> 33 ; 0.335 x $1.00 = 33.5c -> 34
    expect(
      calculateInvoice({ currency: 'USD', lines: [{ quantityMilli: 333, unitPriceMinor: 100 }] })
        .subtotal,
    ).toBe(33);
    expect(
      calculateInvoice({ currency: 'USD', lines: [{ quantityMilli: 335, unitPriceMinor: 100 }] })
        .subtotal,
    ).toBe(34);
  });

  it('handles multiple taxes on one line', () => {
    const r = calculateInvoice({
      currency: 'CAD',
      lines: [{ quantityMilli: 1_000, unitPriceMinor: 10_000, taxes: [GST, PST] }],
    });
    expect(r.taxTotal).toBe(1_200);
    expect(r.total).toBe(11_200);
    expect(r.taxBreakdown.map((t) => t.tax)).toEqual([500, 700]);
  });

  it('applies a percentage discount before tax', () => {
    const r = calculateInvoice({
      currency: 'USD',
      lines: [{ quantityMilli: 1_000, unitPriceMinor: 100_000, taxes: [GST] }],
      discount: { type: 'percent', bps: 1_000 }, // 10%
    });
    expect(r.discountTotal).toBe(10_000);
    expect(r.taxTotal).toBe(4_500); // 5% of 900.00
    expect(r.total).toBe(94_500);
  });

  it('applies a fixed discount, allocated across lines exactly', () => {
    const r = calculateInvoice({
      currency: 'USD',
      lines: [
        { quantityMilli: 1_000, unitPriceMinor: 3_333, taxes: [GST] },
        { quantityMilli: 1_000, unitPriceMinor: 3_333, taxes: [GST] },
        { quantityMilli: 1_000, unitPriceMinor: 3_334, taxes: [GST] },
      ],
      discount: { type: 'fixed', amountMinor: 100 },
    });
    expect(r.lines.reduce((a, l) => a + l.discount, 0)).toBe(100);
    expect(r.discountTotal).toBe(100);
  });

  it('adds fees untaxed and subtracts payments for balance due', () => {
    const r = calculateInvoice({
      currency: 'USD',
      lines: [{ quantityMilli: 1_000, unitPriceMinor: 100_000 }],
      feesMinor: 2_500,
      amountPaidMinor: 40_000,
    });
    expect(r.total).toBe(102_500);
    expect(r.balanceDue).toBe(62_500);
  });

  it('matches the partial payment example ($1000 total, $400 paid, $600 due)', () => {
    const r = calculateInvoice({
      currency: 'USD',
      lines: [{ quantityMilli: 1_000, unitPriceMinor: 100_000 }],
      amountPaidMinor: 40_000,
    });
    expect(r.balanceDue).toBe(60_000);
  });

  it('works for zero- and three-decimal currencies', () => {
    expect(
      calculateInvoice({
        currency: 'JPY',
        lines: [
          { quantityMilli: 3_000, unitPriceMinor: 1_234, taxes: [{ name: 'JCT', rateBps: 1_000 }] },
        ],
      }).total,
    ).toBe(4_072); // 3702 + 370.2 -> 370
    expect(
      calculateInvoice({
        currency: 'KWD',
        lines: [{ quantityMilli: 1_000, unitPriceMinor: 1_234 }],
      }).total,
    ).toBe(1_234);
  });
});

describe('calculateInvoice (inclusive tax)', () => {
  it('extracts tax from the price', () => {
    const r = calculateInvoice({
      currency: 'USD',
      taxInclusive: true,
      lines: [{ quantityMilli: 1_000, unitPriceMinor: 10_500, taxes: [GST] }],
    });
    expect(r.total).toBe(10_500);
    expect(r.taxTotal).toBe(500);
    expect(r.lines[0]?.netAmount).toBe(10_000);
  });

  it('splits embedded tax across multiple rates and totals exactly', () => {
    const r = calculateInvoice({
      currency: 'CAD',
      taxInclusive: true,
      lines: [{ quantityMilli: 1_000, unitPriceMinor: 11_200, taxes: [GST, PST] }],
    });
    expect(r.taxTotal).toBe(1_200);
    expect(r.taxBreakdown.map((t) => t.tax)).toEqual([500, 700]);
    expect(r.total).toBe(11_200);
  });

  it('applies discount to the gross then extracts tax', () => {
    const r = calculateInvoice({
      currency: 'USD',
      taxInclusive: true,
      lines: [{ quantityMilli: 1_000, unitPriceMinor: 10_500, taxes: [GST] }],
      discount: { type: 'percent', bps: 5_000 },
    });
    expect(r.total).toBe(5_250);
    expect(r.taxTotal).toBe(250);
  });
});

describe('calculateInvoice validation', () => {
  const base: InvoiceInput = {
    currency: 'USD',
    lines: [{ quantityMilli: 1_000, unitPriceMinor: 1_000 }],
  };

  it.each([
    ['negative quantity', { lines: [{ quantityMilli: -1, unitPriceMinor: 1 }] }],
    ['negative price', { lines: [{ quantityMilli: 1, unitPriceMinor: -1 }] }],
    ['fractional price', { lines: [{ quantityMilli: 1, unitPriceMinor: 1.5 }] }],
    ['discount over 100%', { discount: { type: 'percent' as const, bps: 10_001 } }],
    ['fixed discount over subtotal', { discount: { type: 'fixed' as const, amountMinor: 1_001 } }],
    ['negative fees', { feesMinor: -1 }],
    ['bad currency', { currency: 'ZZZ' as never }],
    [
      'tax rate over 100%',
      { lines: [{ quantityMilli: 1, unitPriceMinor: 1, taxes: [{ name: 'X', rateBps: 10_001 }] }] },
    ],
  ])('rejects %s', (_label, patch) => {
    expect(() => calculateInvoice({ ...base, ...patch })).toThrow(MoneyError);
  });
});

describe('calculateInvoice properties', () => {
  const line = fc.record({
    quantityMilli: fc.integer({ min: 0, max: 1_000_000 }),
    unitPriceMinor: fc.integer({ min: 0, max: 100_000_000 }),
    taxes: fc.array(
      fc.record({
        name: fc.constantFrom('GST', 'PST', 'VAT'),
        rateBps: fc.integer({ min: 0, max: 3_000 }),
      }),
      { maxLength: 3 },
    ),
  });

  it('is deterministic and internally consistent', () => {
    fc.assert(
      fc.property(
        fc.array(line, { minLength: 1, maxLength: 8 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.boolean(),
        fc.integer({ min: 0, max: 100_000 }),
        (lines, discountBps, taxInclusive, fees) => {
          const input: InvoiceInput = {
            currency: 'USD',
            lines,
            discount: { type: 'percent', bps: discountBps },
            taxInclusive,
            feesMinor: fees,
          };
          const a = calculateInvoice(input);
          expect(calculateInvoice(input)).toEqual(a);
          expect(a.lines.reduce((s, l) => s + l.lineTotal, 0)).toBe(a.subtotal);
          expect(a.lines.reduce((s, l) => s + l.discount, 0)).toBe(a.discountTotal);
          expect(a.lines.reduce((s, l) => s + l.tax, 0)).toBe(a.taxTotal);
          expect(a.taxBreakdown.reduce((s, t) => s + t.tax, 0)).toBe(a.taxTotal);
          const expected = taxInclusive
            ? a.subtotal - a.discountTotal + fees
            : a.subtotal - a.discountTotal + a.taxTotal + fees;
          expect(a.total).toBe(expected);
          expect(a.total).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});
