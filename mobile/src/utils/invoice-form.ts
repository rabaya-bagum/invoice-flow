import {
  addDays,
  calculateInvoice,
  formatPercent,
  formatQuantity,
  invoiceInputSchema,
  isSupportedCurrency,
  minorToDecimalString,
  MoneyError,
  parseMoney,
  parsePercent,
  parseQuantity,
  type CurrencyCode,
  type InvoiceTotals,
  type InvoiceWriteInput,
} from '@invoiceflow/shared';
import type { BusinessProfile, Invoice, TaxRate } from '../models';

export interface LineForm {
  key: string;
  productId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  taxes: Array<{ name: string; rateBps: number }>;
}

export interface InvoiceForm {
  customerId: string | null;
  customerName: string;
  number: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  taxInclusive: boolean;
  discountType: 'none' | 'percent' | 'fixed';
  discountValue: string;
  fees: string;
  notes: string;
  terms: string;
  lines: LineForm[];
  /** Present when editing: sent back so the server can detect concurrent edits. */
  version?: number;
}

let counter = 0;
export const newLineKey = () => `line-${Date.now()}-${counter++}`;

export function emptyLine(taxes: LineForm['taxes'] = []): LineForm {
  return {
    key: newLineKey(),
    productId: null,
    description: '',
    quantity: '1',
    unitPrice: '',
    taxes,
  };
}

/** The tax a new line starts with: the business's default named rate, else its default percentage. */
export function defaultLineTaxes(business: BusinessProfile, rates: TaxRate[]): LineForm['taxes'] {
  const def = rates.find((r) => r.isDefault);
  if (def) return [{ name: def.name, rateBps: def.rateBps }];
  return business.defaultTaxRateBps > 0
    ? [{ name: 'Tax', rateBps: business.defaultTaxRateBps }]
    : [];
}

export function newInvoiceForm(
  business: BusinessProfile,
  rates: TaxRate[],
  today: string,
): InvoiceForm {
  return {
    customerId: null,
    customerName: '',
    number: '',
    issueDate: today,
    dueDate: addDays(today, business.defaultPaymentTermsDays),
    currency: business.defaultCurrency,
    taxInclusive: false,
    discountType: 'none',
    discountValue: '',
    fees: '',
    notes: '',
    terms: '',
    lines: [emptyLine(defaultLineTaxes(business, rates))],
  };
}

export function invoiceToForm(inv: Invoice): InvoiceForm {
  const cur = isSupportedCurrency(inv.currency) ? inv.currency : 'USD';
  return {
    customerId: inv.customerId,
    customerName: inv.customerName,
    number: inv.number,
    issueDate: inv.issueDate,
    dueDate: inv.dueDate,
    currency: inv.currency,
    taxInclusive: inv.taxInclusive,
    discountType: inv.discountType ?? 'none',
    discountValue:
      inv.discountType === 'percent' && inv.discountValue !== null
        ? formatPercent(inv.discountValue)
        : inv.discountType === 'fixed' && inv.discountValue !== null
          ? minorToDecimalString(inv.discountValue, cur)
          : '',
    fees: inv.feesMinor ? minorToDecimalString(inv.feesMinor, cur) : '',
    notes: inv.notes ?? '',
    terms: inv.terms ?? '',
    version: inv.version,
    lines: inv.items.map((it) => ({
      key: it.id,
      productId: it.productId,
      description: it.description,
      quantity: formatQuantity(it.quantityMilli),
      unitPrice: minorToDecimalString(it.unitPriceMinor, cur),
      taxes: it.taxes,
    })),
  };
}

const moneyOrNull = (v: string, cur: CurrencyCode) => {
  if (!v.trim()) return 0;
  try {
    return parseMoney(v, cur);
  } catch {
    return null;
  }
};

/**
 * Turns form text into the API payload. Local checks produce friendly, field-keyed messages
 * (e.g. `lines.0.unitPrice`); the shared schema then applies exactly the rules the server will.
 */
export function buildInvoicePayload(form: InvoiceForm): {
  payload?: InvoiceWriteInput;
  errors: Record<string, string>;
} {
  const errors: Record<string, string> = {};
  const cur = form.currency.trim().toUpperCase();
  if (!isSupportedCurrency(cur)) {
    return { errors: { currency: 'Choose a supported currency, e.g. USD' } };
  }
  if (!form.customerId) errors.customerId = 'Choose a customer';

  const items = form.lines.map((l, i) => {
    let quantityMilli: number | undefined;
    let unitPriceMinor: number | undefined;
    try {
      quantityMilli = parseQuantity(l.quantity);
    } catch {
      errors[`lines.${i}.quantity`] = 'Enter a quantity, e.g. 1 or 2.5';
    }
    try {
      unitPriceMinor = parseMoney(l.unitPrice, cur);
    } catch {
      errors[`lines.${i}.unitPrice`] = `Enter a price, e.g. 100.00 (${cur})`;
    }
    return {
      productId: l.productId,
      description: l.description,
      quantityMilli,
      unitPriceMinor,
      taxes: l.taxes,
    };
  });

  let discount: InvoiceWriteInput['discount'] = null;
  if (form.discountType !== 'none' && form.discountValue.trim()) {
    try {
      discount =
        form.discountType === 'percent'
          ? { type: 'percent', value: parsePercent(form.discountValue) }
          : { type: 'fixed', value: parseMoney(form.discountValue, cur) };
    } catch {
      errors.discount =
        form.discountType === 'percent'
          ? 'Enter a percentage from 0 to 100'
          : `Enter an amount, e.g. 25.00 (${cur})`;
    }
  }

  const feesMinor = moneyOrNull(form.fees, cur);
  if (feesMinor === null) errors.fees = `Enter an amount, e.g. 5.00 (${cur})`;

  const parsed = invoiceInputSchema.safeParse({
    customerId: form.customerId ?? '',
    number: form.number,
    issueDate: form.issueDate,
    dueDate: form.dueDate,
    currency: cur,
    taxInclusive: form.taxInclusive,
    discount,
    feesMinor: feesMinor ?? 0,
    notes: form.notes,
    terms: form.terms,
    items,
    version: form.version,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [head, idx, field] = issue.path;
      const key =
        head === 'items' && typeof idx === 'number' && field
          ? `lines.${idx}.${String(field) === 'unitPriceMinor' ? 'unitPrice' : String(field) === 'quantityMilli' ? 'quantity' : String(field)}`
          : head === 'items'
            ? 'items'
            : String(head ?? '_');
      if (!errors[key]) errors[key] = issue.message;
    }
  }
  if (Object.keys(errors).length || !parsed.success) return { errors };
  return { payload: parsed.data, errors };
}

/**
 * Best-effort live totals for the form. Display only: lines that don't parse yet count as zero,
 * and the server's calculation on save is authoritative (it uses the same shared function).
 */
export function previewTotals(
  form: InvoiceForm,
): { totals: InvoiceTotals; currency: CurrencyCode } | { error: string } | null {
  const cur = form.currency.trim().toUpperCase();
  if (!isSupportedCurrency(cur)) return null;
  const lines = form.lines.map((l) => {
    let quantityMilli = 0;
    let unitPriceMinor = 0;
    try {
      quantityMilli = parseQuantity(l.quantity);
    } catch {
      /* counts as 0 until valid */
    }
    try {
      unitPriceMinor = parseMoney(l.unitPrice, cur);
    } catch {
      /* counts as 0 until valid */
    }
    return { quantityMilli, unitPriceMinor, taxes: l.taxes };
  });
  let discount: Parameters<typeof calculateInvoice>[0]['discount'];
  try {
    if (form.discountType === 'percent' && form.discountValue.trim()) {
      discount = { type: 'percent', bps: parsePercent(form.discountValue) };
    } else if (form.discountType === 'fixed' && form.discountValue.trim()) {
      discount = { type: 'fixed', amountMinor: parseMoney(form.discountValue, cur) };
    }
    return {
      currency: cur,
      totals: calculateInvoice({
        currency: cur,
        lines,
        discount,
        taxInclusive: form.taxInclusive,
        feesMinor: moneyOrNull(form.fees, cur) ?? 0,
      }),
    };
  } catch (e) {
    return { error: e instanceof MoneyError ? e.message : 'Check the amounts above' };
  }
}
