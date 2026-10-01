import { CurrencyCode, assertCurrency } from './currency';
import { MoneyError } from './errors';
import { allocate, assertMinor, mulDivRound, toMinor } from './rounding';

export interface TaxRate {
  /** Stable key for grouping the breakdown, e.g. "GST" or a tax_rates.id. */
  name: string;
  /** Basis points: 5% = 500, 13.5% = 1350. */
  rateBps: number;
}

export interface LineInput {
  /** Thousandths of a unit: 1.5 -> 1500. */
  quantityMilli: number;
  /** Minor units per whole unit of quantity. */
  unitPriceMinor: number;
  taxes?: TaxRate[];
}

export type DiscountInput =
  { type: 'percent'; bps: number } | { type: 'fixed'; amountMinor: number };

export interface InvoiceInput {
  currency: CurrencyCode;
  lines: LineInput[];
  discount?: DiscountInput;
  /** If true, unit prices already include tax. */
  taxInclusive?: boolean;
  /** Flat fees, untaxed. */
  feesMinor?: number;
  amountPaidMinor?: number;
}

export interface LineResult {
  /** quantity x unit price, as entered (includes tax when taxInclusive). */
  lineTotal: number;
  discount: number;
  /** Amount tax is computed on / the net-of-tax value of the line after discount. */
  netAmount: number;
  tax: number;
}

export interface TaxBreakdownEntry {
  name: string;
  rateBps: number;
  taxableAmount: number;
  tax: number;
}

export interface InvoiceTotals {
  lines: LineResult[];
  /** Sum of line totals before discount (tax-inclusive in inclusive mode). */
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  feesTotal: number;
  total: number;
  amountPaid: number;
  /** total - amountPaid. Negative only if the invoice was overpaid. */
  balanceDue: number;
  taxBreakdown: TaxBreakdownEntry[];
}

const MAX_BPS = 10_000n;

function assertBps(bps: number, label: string, code: 'INVALID_RATE' | 'INVALID_DISCOUNT'): void {
  if (!Number.isInteger(bps) || bps < 0 || bps > Number(MAX_BPS)) {
    throw new MoneyError(code, `${label} must be an integer between 0 and 10000 basis points`);
  }
}

/**
 * Deterministic invoice maths. Pure and float-free: every step is bigint with
 * round-half-up, and any rounding remainder in discount allocation is distributed
 * exactly so parts always sum to the whole.
 *
 * Order of operations:
 *  1. line total = round(qty * unit price)
 *  2. invoice discount (percent of subtotal, or fixed) is allocated across lines pro rata
 *  3. tax per line on the discounted amount, rounded per line and per tax, then summed
 *  4. fees (untaxed) added; payments subtracted for balance due
 */
export function calculateInvoice(input: InvoiceInput): InvoiceTotals {
  assertCurrency(input.currency);
  const inclusive = input.taxInclusive ?? false;
  const fees = input.feesMinor ?? 0;
  const paid = input.amountPaidMinor ?? 0;
  assertMinor(fees, 'fees');
  assertMinor(paid, 'amountPaid');

  const lineTotals = input.lines.map((l, i) => {
    assertMinor(l.unitPriceMinor, `line ${i + 1} unit price`);
    if (!Number.isSafeInteger(l.quantityMilli) || l.quantityMilli < 0) {
      throw new MoneyError('INVALID_QUANTITY', `line ${i + 1} quantity must be >= 0`);
    }
    for (const t of l.taxes ?? []) assertBps(t.rateBps, `tax "${t.name}"`, 'INVALID_RATE');
    return mulDivRound(BigInt(l.quantityMilli), BigInt(l.unitPriceMinor), 1000n);
  });

  const subtotal = lineTotals.reduce((a, b) => a + b, 0n);

  let discountTotal = 0n;
  const d = input.discount;
  if (d) {
    if (d.type === 'percent') {
      assertBps(d.bps, 'discount', 'INVALID_DISCOUNT');
      discountTotal = mulDivRound(subtotal, BigInt(d.bps), MAX_BPS);
    } else {
      assertMinor(d.amountMinor, 'discount');
      if (BigInt(d.amountMinor) > subtotal) {
        throw new MoneyError('INVALID_DISCOUNT', 'Discount cannot exceed the subtotal');
      }
      discountTotal = BigInt(d.amountMinor);
    }
  }

  const discounts = allocate(discountTotal, lineTotals);
  const breakdown = new Map<string, TaxBreakdownEntry>();
  let taxTotal = 0n;
  let netSum = 0n;

  const lines: LineResult[] = input.lines.map((line, i) => {
    const gross = lineTotals[i] as bigint;
    const afterDiscount = gross - (discounts[i] as bigint);
    const taxes = line.taxes ?? [];
    const rates = taxes.map((t) => BigInt(t.rateBps));
    const rateSum = rates.reduce((a, b) => a + b, 0n);

    let lineTaxParts: bigint[];
    let net: bigint;
    if (inclusive) {
      // Tax is embedded in the price: extract it, then split among taxes by rate.
      const lineTax = mulDivRound(afterDiscount, rateSum, MAX_BPS + rateSum);
      lineTaxParts = allocate(lineTax, rates);
      net = afterDiscount - lineTax;
    } else {
      net = afterDiscount;
      lineTaxParts = rates.map((r) => mulDivRound(net, r, MAX_BPS));
    }

    let lineTax = 0n;
    taxes.forEach((t, k) => {
      const part = lineTaxParts[k] as bigint;
      lineTax += part;
      const key = `${t.name}|${t.rateBps}`;
      const e = breakdown.get(key) ?? {
        name: t.name,
        rateBps: t.rateBps,
        taxableAmount: 0,
        tax: 0,
      };
      e.taxableAmount += toMinor(net);
      e.tax += toMinor(part);
      breakdown.set(key, e);
    });

    taxTotal += lineTax;
    netSum += net;
    return {
      lineTotal: toMinor(gross),
      discount: toMinor(discounts[i] as bigint),
      netAmount: toMinor(net),
      tax: toMinor(lineTax),
    };
  });

  const afterDiscountTotal = subtotal - discountTotal;
  const total = (inclusive ? afterDiscountTotal : netSum + taxTotal) + BigInt(fees);

  return {
    lines,
    subtotal: toMinor(subtotal),
    discountTotal: toMinor(discountTotal),
    taxTotal: toMinor(taxTotal),
    feesTotal: fees,
    total: toMinor(total),
    amountPaid: paid,
    balanceDue: toMinor(total) - paid,
    taxBreakdown: [...breakdown.values()],
  };
}
