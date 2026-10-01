import { isSupportedCurrency } from './currency';
import { formatMoney, formatPercent } from './money';

export interface TotalsRow {
  label: string;
  value: string;
  strong?: boolean;
}

/** Normalised totals (minor units) from either the calculator or a stored invoice. */
export interface TotalsSource {
  currency: string;
  taxInclusive: boolean;
  subtotal: number;
  discountTotal: number;
  taxBreakdown: Array<{ name: string; rateBps: number; tax: number }>;
  fees: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
}

const money = (n: number, currency: string) =>
  isSupportedCurrency(currency) ? formatMoney(n, currency) : `${n} ${currency}`;

/** The rows shown under the items table: identical in the app preview, the PDF and the pay page. */
export function buildTotalsRows(s: TotalsSource): TotalsRow[] {
  const m = (n: number) => money(n, s.currency);
  const rows: TotalsRow[] = [
    { label: s.taxInclusive ? 'Subtotal (tax included)' : 'Subtotal', value: m(s.subtotal) },
  ];
  if (s.discountTotal > 0) rows.push({ label: 'Discount', value: `-${m(s.discountTotal)}` });
  for (const t of s.taxBreakdown) {
    rows.push({
      label: `${t.name} (${formatPercent(t.rateBps)}%)${s.taxInclusive ? ' included' : ''}`,
      value: m(t.tax),
    });
  }
  if (s.fees > 0) rows.push({ label: 'Fees', value: m(s.fees) });
  rows.push({ label: 'Total', value: m(s.total), strong: true });
  if (s.amountPaid > 0) rows.push({ label: 'Amount paid', value: m(s.amountPaid) });
  rows.push({ label: 'Balance due', value: m(s.balanceDue), strong: true });
  return rows;
}
