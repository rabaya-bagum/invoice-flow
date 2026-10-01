import {
  calculateInvoice,
  canTransition,
  isEditable,
  MoneyError,
  type InvoiceListQuery,
  type InvoiceTotals,
  type InvoiceWriteInput,
  type ManualTransition,
} from '@invoiceflow/shared';
import type { Database } from '../db';
import {
  createInvoiceRepository,
  NUMBER_CONSTRAINT,
  type InvoiceRecord,
  type InvoiceRepository,
  type InvoiceWrite,
} from '../repositories/invoice-repository';
import { AppError, notFound } from '../utils/errors';

export interface Actor {
  businessId: string;
  userId: string;
  ip?: string;
}

export type InvoiceDto = InvoiceRecord & {
  taxBreakdown: InvoiceTotals['taxBreakdown'];
  warnings: string[];
  editable: boolean;
};

const MAX_NUMBER_ATTEMPTS = 20;

const uniqueNumberViolation = (e: unknown) =>
  (e as { code?: string; constraint?: string })?.code === '23505' &&
  (e as { constraint?: string }).constraint === NUMBER_CONSTRAINT;

/** The one place invoice money is computed. Client totals are never read. */
export function computeTotals(input: InvoiceWriteInput, amountPaidMinor = 0): InvoiceTotals {
  try {
    return calculateInvoice({
      currency: input.currency as never,
      taxInclusive: input.taxInclusive,
      feesMinor: input.feesMinor,
      amountPaidMinor,
      discount: input.discount
        ? input.discount.type === 'percent'
          ? { type: 'percent', bps: input.discount.value }
          : { type: 'fixed', amountMinor: input.discount.value }
        : undefined,
      lines: input.items.map((i) => ({
        quantityMilli: i.quantityMilli,
        unitPriceMinor: i.unitPriceMinor,
        taxes: i.taxes,
      })),
    });
  } catch (e) {
    if (e instanceof MoneyError) throw new AppError(422, 'INVALID_INVOICE', e.message);
    throw e;
  }
}

function toWrite(input: InvoiceWriteInput, totals: InvoiceTotals, number: string): InvoiceWrite {
  return {
    customerId: input.customerId,
    number,
    issueDate: input.issueDate,
    dueDate: input.dueDate,
    currency: input.currency,
    taxInclusive: input.taxInclusive,
    discountType: input.discount?.type ?? null,
    discountValue: input.discount?.value ?? null,
    feesMinor: input.feesMinor,
    subtotalMinor: totals.subtotal,
    discountTotalMinor: totals.discountTotal,
    taxTotalMinor: totals.taxTotal,
    totalMinor: totals.total,
    notes: input.notes,
    terms: input.terms,
    items: input.items.map((it, i) => {
      const line = totals.lines[i] as InvoiceTotals['lines'][number];
      return {
        productId: it.productId,
        description: it.description,
        quantityMilli: it.quantityMilli,
        unitPriceMinor: it.unitPriceMinor,
        taxes: it.taxes,
        lineTotalMinor: line.lineTotal,
        discountMinor: line.discount,
        taxMinor: line.tax,
      };
    }),
  };
}

export function createInvoiceService(db: Database) {
  const repo = (q: Pick<Database, 'query'> = db) => createInvoiceRepository(q);

  /** Re-derives the breakdown from stored inputs so it can never drift from the stored totals. */
  function toDto(inv: InvoiceRecord, warnings: string[] = []): InvoiceDto {
    const totals = computeTotals(
      {
        customerId: inv.customerId,
        number: inv.number,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        currency: inv.currency,
        taxInclusive: inv.taxInclusive,
        discount: inv.discountType
          ? { type: inv.discountType, value: inv.discountValue as number }
          : null,
        feesMinor: inv.feesMinor,
        notes: inv.notes,
        terms: inv.terms,
        items: inv.items,
      } as InvoiceWriteInput,
      inv.amountPaidMinor,
    );
    return {
      ...inv,
      taxBreakdown: totals.taxBreakdown,
      warnings,
      editable: isEditable(inv.status, inv.amountPaidMinor),
    };
  }

  const warningsFor = (input: Pick<InvoiceWriteInput, 'issueDate' | 'dueDate'>) =>
    input.dueDate < input.issueDate ? ['DUE_DATE_BEFORE_ISSUE_DATE'] : [];

  async function validateReferences(
    r: InvoiceRepository,
    businessId: string,
    input: InvoiceWriteInput,
  ) {
    if (!(await r.customerUsable(businessId, input.customerId))) {
      throw new AppError(422, 'INVALID_CUSTOMER', 'Choose a valid customer');
    }
    const productIds = [
      ...new Set(input.items.map((i) => i.productId).filter((p): p is string => !!p)),
    ];
    if (
      productIds.length &&
      (await r.countOwnedProducts(businessId, productIds)) !== productIds.length
    ) {
      throw new AppError(422, 'INVALID_PRODUCT', 'One of the selected products no longer exists');
    }
  }

  return {
    list: (businessId: string, q: InvoiceListQuery) => repo().list(businessId, q),

    /** A customer's invoices; an id from another business is "not found", like everywhere else. */
    async listForCustomer(businessId: string, customerId: string, q: InvoiceListQuery) {
      if (!(await repo().customerForPrint(businessId, customerId))) throw notFound('Customer');
      return repo().list(businessId, { ...q, customerId });
    },

    async get(businessId: string, id: string) {
      const inv = await repo().get(businessId, id);
      if (!inv) throw notFound('Invoice');
      return toDto(inv);
    },

    async create(actor: Actor, input: InvoiceWriteInput) {
      const totals = computeTotals(input);
      const id = await db.transaction(async (tx) => {
        const r = repo(tx);
        await validateReferences(r, actor.businessId, input);

        let newId: string | null = null;
        let number = '';
        for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS && !newId; attempt++) {
          number = input.number ?? (await r.allocateNumber(actor.businessId));
          // Savepoint: a taken number must not abort the whole transaction.
          await tx.query('SAVEPOINT invoice_number');
          try {
            newId = await r.insert(actor.businessId, toWrite(input, totals, number));
            await tx.query('RELEASE SAVEPOINT invoice_number');
          } catch (e) {
            await tx.query('ROLLBACK TO SAVEPOINT invoice_number');
            if (!uniqueNumberViolation(e)) throw e;
            if (input.number)
              throw new AppError(409, 'NUMBER_EXISTS', `Invoice number ${number} is already used`);
            // An auto number collided with a manually entered one: take the next.
          }
        }
        if (!newId)
          throw new AppError(
            503,
            'NUMBERING_BUSY',
            'Could not allocate an invoice number, try again',
          );

        await r.addActivity(actor.businessId, newId, 'created', 'Invoice created');
        await r.addAudit({
          businessId: actor.businessId,
          userId: actor.userId,
          action: 'invoice.create',
          entityId: newId,
          ip: actor.ip,
          metadata: { number },
        });
        return newId;
      });
      return toDto((await repo().get(actor.businessId, id)) as InvoiceRecord, warningsFor(input));
    },

    async update(actor: Actor, id: string, input: InvoiceWriteInput) {
      await db.transaction(async (tx) => {
        const r = repo(tx);
        const current = await r.lock(actor.businessId, id);
        if (!current) throw notFound('Invoice');
        if (!isEditable(current.status, current.amountPaidMinor)) {
          throw new AppError(409, 'INVOICE_LOCKED', 'This invoice can no longer be edited');
        }
        if (await r.hasPendingPayment(actor.businessId, id)) {
          throw new AppError(
            409,
            'PAYMENT_IN_PROGRESS',
            'A payment is in progress for this invoice. Try again in a moment.',
          );
        }
        if (input.version !== undefined && input.version !== current.version) {
          throw new AppError(
            409,
            'VERSION_CONFLICT',
            'This invoice was changed elsewhere. Reload and try again.',
          );
        }
        await validateReferences(r, actor.businessId, input);
        const totals = computeTotals(input, current.amountPaidMinor);
        try {
          await tx.query('SAVEPOINT invoice_number');
          await r.replace(
            actor.businessId,
            id,
            toWrite(input, totals, input.number ?? current.number),
          );
          await tx.query('RELEASE SAVEPOINT invoice_number');
        } catch (e) {
          await tx.query('ROLLBACK TO SAVEPOINT invoice_number');
          if (uniqueNumberViolation(e))
            throw new AppError(409, 'NUMBER_EXISTS', 'That invoice number is already used');
          throw e;
        }
        await r.addActivity(actor.businessId, id, 'updated', 'Invoice edited');
        await r.addAudit({
          businessId: actor.businessId,
          userId: actor.userId,
          action: 'invoice.update',
          entityId: id,
          ip: actor.ip,
        });
      });
      return toDto((await repo().get(actor.businessId, id)) as InvoiceRecord, warningsFor(input));
    },

    async remove(actor: Actor, id: string) {
      await db.transaction(async (tx) => {
        const r = repo(tx);
        const current = await r.lock(actor.businessId, id);
        if (!current) throw notFound('Invoice');
        if (current.status !== 'draft') {
          throw new AppError(
            409,
            'INVOICE_NOT_DRAFT',
            'Only drafts can be deleted. Cancel the invoice instead.',
          );
        }
        await r.addAudit({
          businessId: actor.businessId,
          userId: actor.userId,
          action: 'invoice.delete',
          entityId: id,
          ip: actor.ip,
          metadata: { number: current.number },
        });
        await r.delete(actor.businessId, id);
      });
    },

    async transition(actor: Actor, id: string, to: ManualTransition) {
      await db.transaction(async (tx) => {
        const r = repo(tx);
        const current = await r.lock(actor.businessId, id);
        if (!current) throw notFound('Invoice');
        if (!canTransition(current.status, to)) {
          throw new AppError(
            409,
            'INVALID_TRANSITION',
            `A ${current.status.replace('_', ' ')} invoice cannot become ${to}`,
          );
        }
        if (await r.hasPendingPayment(actor.businessId, id)) {
          throw new AppError(
            409,
            'PAYMENT_IN_PROGRESS',
            'A payment is in progress for this invoice. Try again in a moment.',
          );
        }
        if (to === 'cancelled' && current.amountPaidMinor > 0) {
          throw new AppError(
            409,
            'INVALID_TRANSITION',
            'An invoice with payments cannot be cancelled',
          );
        }
        await r.setStatus(actor.businessId, id, to);
        await r.addActivity(
          actor.businessId,
          id,
          to,
          to === 'sent' ? 'Invoice marked as sent' : 'Invoice cancelled',
        );
        await r.addAudit({
          businessId: actor.businessId,
          userId: actor.userId,
          action: `invoice.${to}`,
          entityId: id,
          ip: actor.ip,
        });
      });
      return this.get(actor.businessId, id);
    },

    async activity(businessId: string, id: string) {
      if (!(await repo().get(businessId, id))) throw notFound('Invoice');
      return repo().activity(businessId, id);
    },
  };
}
export type InvoiceService = ReturnType<typeof createInvoiceService>;
