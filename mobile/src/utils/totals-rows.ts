import type { InvoiceTotals } from '@invoiceflow/shared';
import { formatPercent } from '@invoiceflow/shared';
import type { Invoice } from '../models';
import { money } from './format';

export interface TotalsRow {
  label: string;
  value: string;
  strong?: boolean;
}

interface Source {
  currency: string;
  taxInclusive: boolean;
  subtotal: number;
  discountTotal: number;
  taxBreakdown: Array<{ name: string; rateBps: number; tax: number }>;
  taxTotal: number;
  fees: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
}

function rows(s: Source): TotalsRow[] {
  const m = (n: number) => money(n, s.currency);
  const out: TotalsRow[] = [
    { label: s.taxInclusive ? 'Subtotal (tax included)' : 'Subtotal', value: m(s.subtotal) },
  ];
  if (s.discountTotal > 0) out.push({ label: 'Discount', value: `-${m(s.discountTotal)}` });
  for (const t of s.taxBreakdown) {
    out.push({
      label: `${t.name} (${formatPercent(t.rateBps)}%)${s.taxInclusive ? ' included' : ''}`,
      value: m(t.tax),
    });
  }
  if (s.fees > 0) out.push({ label: 'Fees', value: m(s.fees) });
  out.push({ label: 'Total', value: m(s.total), strong: true });
  if (s.amountPaid > 0) out.push({ label: 'Amount paid', value: m(s.amountPaid) });
  out.push({ label: 'Balance due', value: m(s.balanceDue), strong: true });
  return out;
}

export const rowsFromTotals = (t: InvoiceTotals, currency: string, taxInclusive: boolean) =>
  rows({
    currency,
    taxInclusive,
    subtotal: t.subtotal,
    discountTotal: t.discountTotal,
    taxBreakdown: t.taxBreakdown,
    taxTotal: t.taxTotal,
    fees: t.feesTotal,
    total: t.total,
    amountPaid: t.amountPaid,
    balanceDue: t.balanceDue,
  });

export const rowsFromInvoice = (i: Invoice) =>
  rows({
    currency: i.currency,
    taxInclusive: i.taxInclusive,
    subtotal: i.subtotalMinor,
    discountTotal: i.discountTotalMinor,
    taxBreakdown: i.taxBreakdown,
    taxTotal: i.taxTotalMinor,
    fees: i.feesMinor,
    total: i.totalMinor,
    amountPaid: i.amountPaidMinor,
    balanceDue: i.balanceDueMinor,
  });
