import { buildTotalsRows } from '@invoiceflow/shared';
import type { Estimate, Invoice } from '../models';

/**
 * An estimate prices and prints exactly like an invoice, so the app renders it through the invoice
 * components. This adapter fills the payment fields (nothing is paid or owing on an estimate).
 */
export function estimateAsInvoice(e: Estimate): Invoice {
  return {
    ...e,
    status: 'draft', // unused by the document; the real status is on `displayStatus`
    displayStatus: e.displayStatus as Invoice['displayStatus'],
    dueDate: e.expiryDate,
    amountPaidMinor: 0,
    balanceDueMinor: e.totalMinor,
    sentAt: null,
    warnings: [],
  };
}

/** Totals rows without the paid/balance lines: an estimate's headline is its Total. */
export const estimateTotalsRows = (e: Estimate) =>
  buildTotalsRows({
    currency: e.currency,
    taxInclusive: e.taxInclusive,
    subtotal: e.subtotalMinor,
    discountTotal: e.discountTotalMinor,
    taxBreakdown: e.taxBreakdown,
    fees: e.feesMinor,
    total: e.totalMinor,
    amountPaid: 0,
    balanceDue: e.totalMinor,
  }).filter((r) => r.label !== 'Amount paid' && r.label !== 'Balance due');
