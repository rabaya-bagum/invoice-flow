import { buildTotalsRows, type InvoiceTotals, type TotalsRow } from '@invoiceflow/shared';
import type { Invoice } from '../models';

export type { TotalsRow };

export const rowsFromTotals = (t: InvoiceTotals, currency: string, taxInclusive: boolean) =>
  buildTotalsRows({
    currency,
    taxInclusive,
    subtotal: t.subtotal,
    discountTotal: t.discountTotal,
    taxBreakdown: t.taxBreakdown,
    fees: t.feesTotal,
    total: t.total,
    amountPaid: t.amountPaid,
    balanceDue: t.balanceDue,
  });

export const rowsFromInvoice = (i: Invoice) =>
  buildTotalsRows({
    currency: i.currency,
    taxInclusive: i.taxInclusive,
    subtotal: i.subtotalMinor,
    discountTotal: i.discountTotalMinor,
    taxBreakdown: i.taxBreakdown,
    fees: i.feesMinor,
    total: i.totalMinor,
    amountPaid: i.amountPaidMinor,
    balanceDue: i.balanceDueMinor,
  });
