import type { InvoiceWriteInput } from '@invoiceflow/shared';
import type { Invoice } from '../models';

const norm = (v: string | null | undefined) => (v ?? '').trim();

/**
 * True when the server copy already holds exactly the content we are trying to upload. That is the
 * normal result of "the save worked but the reply was lost": it must not be shown as a conflict.
 */
export function serverHasContent(server: Invoice, p: InvoiceWriteInput): boolean {
  if (
    server.customerId !== p.customerId ||
    server.issueDate !== p.issueDate ||
    server.dueDate !== p.dueDate ||
    server.currency !== p.currency ||
    server.taxInclusive !== p.taxInclusive ||
    server.feesMinor !== p.feesMinor ||
    norm(server.notes) !== norm(p.notes) ||
    norm(server.terms) !== norm(p.terms)
  )
    return false;
  if (p.number && p.number !== server.number) return false;
  const d = p.discount;
  if ((server.discountType ?? null) !== (d?.type ?? null)) return false;
  if ((server.discountValue ?? null) !== (d?.value ?? null)) return false;
  if (server.items.length !== p.items.length) return false;
  return p.items.every((it, i) => {
    const s = server.items[i];
    return (
      !!s &&
      (s.productId ?? null) === (it.productId ?? null) &&
      s.description === it.description &&
      s.quantityMilli === it.quantityMilli &&
      s.unitPriceMinor === it.unitPriceMinor &&
      JSON.stringify(s.taxes) === JSON.stringify(it.taxes)
    );
  });
}
