import {
  addDays,
  canConvertEstimate,
  type CurrencyCode,
  canTransitionEstimate,
  isEstimateEditable,
  todayInTimezone,
  type EstimateListQuery,
  type EstimateWriteInput,
  type InvoiceTotals,
  type InvoiceWriteInput,
  type ManualEstimateTransition,
} from '@invoiceflow/shared';
import type { Database } from '../db';
import { createBusinessRepository } from '../repositories/business-repository';
import {
  createEstimateRepository,
  ESTIMATE_NUMBER_CONSTRAINT,
  type EstimateRecord,
  type EstimateRepository,
  type EstimateWrite,
} from '../repositories/estimate-repository';
import { createInvoiceRepository } from '../repositories/invoice-repository';
import { AppError, notFound } from '../utils/errors';
import { computeTotals, type Actor, type InvoiceService } from './invoice-service';

const MAX_NUMBER_ATTEMPTS = 20;

const uniqueNumberViolation = (e: unknown) =>
  (e as { code?: string })?.code === '23505' &&
  (e as { constraint?: string }).constraint === ESTIMATE_NUMBER_CONSTRAINT;

/** The server is the only calculator: an estimate prices exactly like an invoice. */
const asInvoiceInput = (i: EstimateWriteInput): InvoiceWriteInput => {
  const { expiryDate, ...rest } = i;
  return { ...rest, dueDate: expiryDate } as InvoiceWriteInput;
};

function toWrite(input: EstimateWriteInput, totals: InvoiceTotals, number: string): EstimateWrite {
  return {
    customerId: input.customerId,
    number,
    issueDate: input.issueDate,
    expiryDate: input.expiryDate,
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

export type EstimateDto = EstimateRecord & {
  taxBreakdown: InvoiceTotals['taxBreakdown'];
  editable: boolean;
  convertible: boolean;
};

export function createEstimateService(db: Database, invoices: InvoiceService) {
  const repo = (q: Pick<Database, 'query'> = db) => createEstimateRepository(q);

  function toDto(e: EstimateRecord): EstimateDto {
    const totals = computeTotals(
      asInvoiceInput({
        customerId: e.customerId,
        number: e.number,
        issueDate: e.issueDate,
        expiryDate: e.expiryDate,
        currency: e.currency,
        taxInclusive: e.taxInclusive,
        discount: e.discountType
          ? { type: e.discountType, value: e.discountValue as number }
          : null,
        feesMinor: e.feesMinor,
        notes: e.notes,
        terms: e.terms,
        items: e.items,
      } as EstimateWriteInput),
    );
    const converted = !!e.convertedInvoiceId;
    return {
      ...e,
      taxBreakdown: totals.taxBreakdown,
      editable: isEstimateEditable(e.status, converted),
      convertible: canConvertEstimate(e.status, converted),
    };
  }

  async function validateReferences(
    tx: Pick<Database, 'query'>,
    businessId: string,
    input: EstimateWriteInput,
  ) {
    const inv = createInvoiceRepository(tx);
    if (!(await inv.customerUsable(businessId, input.customerId))) {
      throw new AppError(422, 'INVALID_CUSTOMER', 'Choose a valid customer');
    }
    const productIds = [
      ...new Set(input.items.map((i) => i.productId).filter((p): p is string => !!p)),
    ];
    if (
      productIds.length &&
      (await inv.countOwnedProducts(businessId, productIds)) !== productIds.length
    ) {
      throw new AppError(422, 'INVALID_PRODUCT', 'One of the selected products no longer exists');
    }
  }

  const audit = (
    r: EstimateRepository,
    actor: Actor,
    action: string,
    id: string,
    metadata?: object,
  ) =>
    r.addAudit({
      businessId: actor.businessId,
      userId: actor.userId,
      action,
      entityId: id,
      ip: actor.ip,
      metadata,
    });

  return {
    list: (businessId: string, q: EstimateListQuery) => repo().list(businessId, q),

    async get(businessId: string, id: string) {
      const e = await repo().get(businessId, id);
      if (!e) throw notFound('Estimate');
      return toDto(e);
    },

    async create(actor: Actor, input: EstimateWriteInput) {
      const totals = computeTotals(asInvoiceInput(input));
      const id = await db.transaction(async (tx) => {
        const r = repo(tx);
        await validateReferences(tx, actor.businessId, input);
        let newId: string | null = null;
        let number = '';
        for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS && !newId; attempt++) {
          number = input.number ?? (await r.allocateNumber(actor.businessId));
          await tx.query('SAVEPOINT estimate_number');
          try {
            newId = await r.insert(actor.businessId, toWrite(input, totals, number));
            await tx.query('RELEASE SAVEPOINT estimate_number');
          } catch (e) {
            await tx.query('ROLLBACK TO SAVEPOINT estimate_number');
            if (!uniqueNumberViolation(e)) throw e;
            if (input.number)
              throw new AppError(409, 'NUMBER_EXISTS', `Estimate number ${number} is already used`);
          }
        }
        if (!newId)
          throw new AppError(
            503,
            'NUMBERING_BUSY',
            'Could not allocate an estimate number, try again',
          );
        await audit(r, actor, 'estimate.create', newId, { number });
        return newId;
      });
      return toDto((await repo().get(actor.businessId, id)) as EstimateRecord);
    },

    async update(actor: Actor, id: string, input: EstimateWriteInput) {
      await db.transaction(async (tx) => {
        const r = repo(tx);
        const current = await r.lock(actor.businessId, id);
        if (!current) throw notFound('Estimate');
        if (!isEstimateEditable(current.status, !!current.convertedInvoiceId)) {
          throw new AppError(409, 'ESTIMATE_LOCKED', 'This estimate can no longer be edited');
        }
        if (input.version !== undefined && input.version !== current.version) {
          throw new AppError(
            409,
            'VERSION_CONFLICT',
            'This estimate was changed elsewhere. Reload and try again.',
          );
        }
        await validateReferences(tx, actor.businessId, input);
        const totals = computeTotals(asInvoiceInput(input));
        try {
          await tx.query('SAVEPOINT estimate_number');
          await r.replace(
            actor.businessId,
            id,
            toWrite(input, totals, input.number ?? current.number),
          );
          await tx.query('RELEASE SAVEPOINT estimate_number');
        } catch (e) {
          await tx.query('ROLLBACK TO SAVEPOINT estimate_number');
          if (uniqueNumberViolation(e))
            throw new AppError(409, 'NUMBER_EXISTS', 'That estimate number is already used');
          throw e;
        }
        await audit(r, actor, 'estimate.update', id);
      });
      return this.get(actor.businessId, id);
    },

    async remove(actor: Actor, id: string) {
      await db.transaction(async (tx) => {
        const r = repo(tx);
        const current = await r.lock(actor.businessId, id);
        if (!current) throw notFound('Estimate');
        if (current.status !== 'draft' || current.convertedInvoiceId) {
          throw new AppError(409, 'ESTIMATE_NOT_DRAFT', 'Only draft estimates can be deleted');
        }
        await audit(r, actor, 'estimate.delete', id, { number: current.number });
        await r.delete(actor.businessId, id);
      });
    },

    async transition(actor: Actor, id: string, to: ManualEstimateTransition) {
      await db.transaction(async (tx) => {
        const r = repo(tx);
        const current = await r.lock(actor.businessId, id);
        if (!current) throw notFound('Estimate');
        if (current.convertedInvoiceId) {
          throw new AppError(
            409,
            'ESTIMATE_LOCKED',
            'This estimate was already turned into an invoice',
          );
        }
        if (!canTransitionEstimate(current.status, to)) {
          throw new AppError(
            409,
            'INVALID_TRANSITION',
            `A ${current.status} estimate cannot become ${to}`,
          );
        }
        await r.setStatus(actor.businessId, id, to);
        await audit(r, actor, `estimate.${to}`, id);
      });
      return this.get(actor.businessId, id);
    },

    /**
     * Turns an estimate into a DRAFT invoice with the same lines, in one transaction. The estimate is
     * locked first, so two taps (or two devices) can never create two invoices.
     */
    async convert(actor: Actor, id: string) {
      const invoiceId = await db.transaction(async (tx) => {
        const r = repo(tx);
        const current = await r.lock(actor.businessId, id);
        if (!current) throw notFound('Estimate');
        if (current.convertedInvoiceId) {
          throw new AppError(
            409,
            'ALREADY_CONVERTED',
            'This estimate was already turned into an invoice',
          );
        }
        if (!canConvertEstimate(current.status, false)) {
          throw new AppError(
            409,
            'NOT_CONVERTIBLE',
            'A declined estimate cannot be turned into an invoice',
          );
        }
        const est = (await r.get(actor.businessId, id)) as EstimateRecord;
        const business = await createBusinessRepository(tx).get(actor.businessId);
        if (!business) throw notFound('Business');
        const today = todayInTimezone(business.timezone);
        const input: InvoiceWriteInput = {
          customerId: est.customerId,
          number: null,
          issueDate: today,
          dueDate: addDays(today, business.defaultPaymentTermsDays),
          currency: est.currency as CurrencyCode,
          taxInclusive: est.taxInclusive,
          discount: est.discountType
            ? { type: est.discountType, value: est.discountValue as number }
            : null,
          feesMinor: est.feesMinor,
          notes: est.notes,
          terms: est.terms,
          items: est.items.map((i) => ({
            productId: i.productId,
            description: i.description,
            quantityMilli: i.quantityMilli,
            unitPriceMinor: i.unitPriceMinor,
            taxes: i.taxes,
          })),
        };
        const newInvoiceId = await invoices.createWithin(tx, actor, input, computeTotals(input));
        await r.markConverted(actor.businessId, id, newInvoiceId);
        await audit(r, actor, 'estimate.convert', id, { invoiceId: newInvoiceId });
        return newInvoiceId;
      });
      return {
        estimate: await this.get(actor.businessId, id),
        invoice: await invoices.get(actor.businessId, invoiceId),
      };
    },
  };
}
export type EstimateService = ReturnType<typeof createEstimateService>;
