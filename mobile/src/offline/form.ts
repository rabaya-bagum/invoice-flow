import type { Invoice } from '../models';
import { invoiceToForm, type InvoiceForm } from '../utils/invoice-form';
import type { DraftOp } from './types';

/** The edit form for a queued draft, built from what was saved on the device. */
export function opToForm(op: DraftOp): InvoiceForm | null {
  const p = op.payload;
  if (!p) return null;
  // invoiceToForm reads only the content fields, so a content-only stand-in is enough.
  const stand = {
    id: op.invoiceId,
    number: p.number ?? '',
    customerId: p.customerId,
    customerName: op.summary.customerName,
    issueDate: p.issueDate,
    dueDate: p.dueDate,
    currency: p.currency,
    taxInclusive: p.taxInclusive,
    discountType: p.discount?.type ?? null,
    discountValue: p.discount?.value ?? null,
    feesMinor: p.feesMinor,
    notes: p.notes,
    terms: p.terms,
    version: op.baseVersion ?? 1,
    items: p.items.map((it, i) => ({ id: `${op.invoiceId}-${i}`, ...it })),
  } as unknown as Invoice;
  return { ...invoiceToForm(stand), version: undefined };
}
