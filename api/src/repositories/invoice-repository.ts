import {
  quantityToDecimalString,
  parseQuantity,
  type InvoiceListQuery,
  type InvoiceStatus,
} from '@invoiceflow/shared';
import type { Queryable } from '../db';
import { likePattern } from './sql';

export interface InvoiceItemRecord {
  id: string;
  productId: string | null;
  description: string;
  quantityMilli: number;
  unitPriceMinor: number;
  taxes: Array<{ name: string; rateBps: number }>;
  lineTotalMinor: number;
  discountMinor: number;
  taxMinor: number;
}

export interface InvoiceSummary {
  id: string;
  number: string;
  status: InvoiceStatus;
  displayStatus: string;
  customerId: string;
  customerName: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  totalMinor: number;
  amountPaidMinor: number;
  balanceDueMinor: number;
  updatedAt: string;
}

export interface InvoiceRecord extends InvoiceSummary {
  customerEmail: string | null;
  taxInclusive: boolean;
  discountType: 'percent' | 'fixed' | null;
  discountValue: number | null;
  feesMinor: number;
  subtotalMinor: number;
  discountTotalMinor: number;
  taxTotalMinor: number;
  notes: string | null;
  terms: string | null;
  version: number;
  sentAt: string | null;
  viewedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  items: InvoiceItemRecord[];
}

/** Everything the repository needs to write; totals are always computed by the service. */
export interface InvoiceWrite {
  customerId: string;
  number: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  taxInclusive: boolean;
  discountType: 'percent' | 'fixed' | null;
  discountValue: number | null;
  feesMinor: number;
  subtotalMinor: number;
  discountTotalMinor: number;
  taxTotalMinor: number;
  totalMinor: number;
  notes: string | null;
  terms: string | null;
  items: Array<{
    productId: string | null;
    description: string;
    quantityMilli: number;
    unitPriceMinor: number;
    taxes: Array<{ name: string; rateBps: number }>;
    lineTotalMinor: number;
    discountMinor: number;
    taxMinor: number;
  }>;
}

// "Overdue" is derived. This expression is the single SQL definition (list filter and display).
const TODAY = `(now() AT TIME ZONE b.timezone)::date`;
const DISPLAY_STATUS = `CASE WHEN i.status IN ('sent', 'viewed', 'partially_paid')
    AND i.balance_due_minor > 0 AND i.due_date < ${TODAY} THEN 'overdue' ELSE i.status::text END`;
const CUSTOMER_NAME = `coalesce(nullif(c.company_name, ''),
    nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Unnamed customer')`;

const SUMMARY = `i.id, i.number, i.status, ${DISPLAY_STATUS} AS "displayStatus",
  i.customer_id AS "customerId", ${CUSTOMER_NAME} AS "customerName",
  i.issue_date AS "issueDate", i.due_date AS "dueDate", i.currency,
  i.total_minor AS "totalMinor", i.amount_paid_minor AS "amountPaidMinor",
  i.balance_due_minor AS "balanceDueMinor", i.updated_at AS "updatedAt"`;

const DETAIL = `${SUMMARY}, c.email AS "customerEmail", i.tax_inclusive AS "taxInclusive", i.discount_type AS "discountType",
  i.discount_value AS "discountValue", i.fees_minor AS "feesMinor",
  i.subtotal_minor AS "subtotalMinor", i.discount_total_minor AS "discountTotalMinor",
  i.tax_total_minor AS "taxTotalMinor", i.notes, i.terms, i.version,
  i.sent_at AS "sentAt", i.viewed_at AS "viewedAt", i.paid_at AS "paidAt",
  i.created_at AS "createdAt"`;

const FROM = `FROM invoices i
  JOIN business_profiles b ON b.id = i.business_id
  JOIN customers c ON c.id = i.customer_id`;

export interface CustomerPrint {
  name: string;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
}

export const NUMBER_CONSTRAINT = 'invoices_business_id_number_key';

export interface InvoiceRepository {
  list(
    businessId: string,
    q: InvoiceListQuery,
  ): Promise<{ items: InvoiceSummary[]; total: number }>;
  get(businessId: string, id: string): Promise<InvoiceRecord | null>;
  /** SELECT ... FOR UPDATE: serialises concurrent edits of one invoice. */
  lock(
    businessId: string,
    id: string,
  ): Promise<{
    status: InvoiceStatus;
    amountPaidMinor: number;
    version: number;
    number: string;
  } | null>;
  customerUsable(businessId: string, customerId: string): Promise<boolean>;
  countOwnedProducts(businessId: string, ids: string[]): Promise<number>;
  allocateNumber(businessId: string): Promise<string>;
  insert(businessId: string, w: InvoiceWrite): Promise<string>;
  replace(businessId: string, id: string, w: InvoiceWrite): Promise<void>;
  setStatus(businessId: string, id: string, status: InvoiceStatus): Promise<void>;
  delete(businessId: string, id: string): Promise<void>;
  activity(
    businessId: string,
    id: string,
  ): Promise<Array<{ id: string; type: string; message: string | null; createdAt: string }>>;
  addActivity(
    businessId: string,
    invoiceId: string,
    type: string,
    message: string | null,
    metadata?: object,
  ): Promise<void>;
  customerForPrint(businessId: string, customerId: string): Promise<CustomerPrint | null>;
  /** Returns the invoice's share salt, creating one if none exists. */
  ensureShareSalt(businessId: string, id: string, newSalt: string): Promise<string | null>;
  clearShareSalt(businessId: string, id: string): Promise<void>;
  /** Public access: looks up by id only. The caller must verify the signed token before use. */
  publicLookup(invoiceId: string): Promise<{ businessId: string; salt: string | null } | null>;
  /** sent -> viewed, once. Returns true if this call changed the status. */
  markViewed(businessId: string, id: string): Promise<boolean>;
  /** True while a payment attempt is in flight: the invoice amount must not change under it. */
  hasPendingPayment(businessId: string, id: string): Promise<boolean>;
  /** Applies the result of payments/refunds to the invoice (called with the row locked). */
  setPaymentState(
    businessId: string,
    id: string,
    state: { amountPaidMinor: number; status: InvoiceStatus | null },
  ): Promise<void>;
  addAudit(entry: {
    businessId: string;
    userId: string | null;
    action: string;
    entityId: string;
    ip?: string;
    metadata?: object;
  }): Promise<void>;
}

export function createInvoiceRepository(db: Queryable): InvoiceRepository {
  async function insertItems(businessId: string, invoiceId: string, items: InvoiceWrite['items']) {
    const cols = 11;
    const params: unknown[] = [];
    const rows = items.map((it, pos) => {
      params.push(
        invoiceId,
        businessId,
        pos,
        it.productId,
        it.description,
        quantityToDecimalString(it.quantityMilli),
        it.unitPriceMinor,
        JSON.stringify(it.taxes),
        it.lineTotalMinor,
        it.discountMinor,
        it.taxMinor,
      );
      const base = pos * cols;
      return `(${Array.from({ length: cols }, (_, k) => `$${base + k + 1}`).join(', ')})`;
    });
    await db.query(
      `INSERT INTO invoice_items (invoice_id, business_id, position, product_id, description, quantity,
         unit_price_minor, taxes, line_total_minor, discount_minor, tax_minor)
       VALUES ${rows.join(', ')}`,
      params,
    );
  }

  const invoiceCols = (w: InvoiceWrite) => [
    w.customerId,
    w.number,
    w.issueDate,
    w.dueDate,
    w.currency,
    w.taxInclusive,
    w.discountType,
    w.discountValue,
    w.feesMinor,
    w.subtotalMinor,
    w.discountTotalMinor,
    w.taxTotalMinor,
    w.totalMinor,
    w.notes,
    w.terms,
  ];

  return {
    async list(businessId, q) {
      const params: unknown[] = [businessId];
      const where: string[] = ['i.business_id = $1'];
      const add = (sql: string, value: unknown) => {
        params.push(value);
        where.push(sql.replace('?', `$${params.length}`));
      };
      if (q.customerId) add('i.customer_id = ?', q.customerId);
      if (q.from) add('i.issue_date >= ?', q.from);
      if (q.to) add('i.issue_date <= ?', q.to);
      if (q.status === 'outstanding') {
        where.push(`i.status IN ('sent', 'viewed', 'partially_paid') AND i.balance_due_minor > 0`);
      } else if (q.status) where.push(`(${DISPLAY_STATUS}) = '${q.status}'`); // enum-validated by zod
      if (q.search) {
        params.push(likePattern(q.search));
        const like = `$${params.length}`;
        let clause = `i.number ILIKE ${like} OR ${CUSTOMER_NAME} ILIKE ${like}
          OR concat_ws(' ', c.email) ILIKE ${like}`;
        if (/^\d{1,12}(\.\d{1,3})?$/.test(q.search)) {
          params.push(q.search);
          clause += ` OR i.total_minor = round($${params.length}::numeric * power(10, currency_exponent(i.currency)))`;
        }
        where.push(`(${clause})`);
      }
      const w = where.join(' AND ');
      const total = await db.query<{ n: string }>(
        `SELECT count(*) AS n ${FROM} WHERE ${w}`,
        params,
      );
      const rows = await db.query<InvoiceSummary>(
        `SELECT ${SUMMARY} ${FROM} WHERE ${w}
         ORDER BY i.issue_date DESC, i.created_at DESC, i.id LIMIT ${q.limit} OFFSET ${q.offset}`,
        params,
      );
      return { items: rows.rows, total: Number(total.rows[0]?.n ?? 0) };
    },

    async get(businessId, id) {
      const r = await db.query<InvoiceRecord>(
        `SELECT ${DETAIL} ${FROM} WHERE i.id = $1 AND i.business_id = $2`,
        [id, businessId],
      );
      const inv = r.rows[0];
      if (!inv) return null;
      const items = await db.query<Omit<InvoiceItemRecord, 'quantityMilli'> & { quantity: string }>(
        `SELECT id, product_id AS "productId", description, quantity::text AS quantity,
                unit_price_minor AS "unitPriceMinor", taxes, line_total_minor AS "lineTotalMinor",
                discount_minor AS "discountMinor", tax_minor AS "taxMinor"
         FROM invoice_items WHERE invoice_id = $1 AND business_id = $2 ORDER BY position`,
        [id, businessId],
      );
      inv.items = items.rows.map(({ quantity, ...rest }) => ({
        ...rest,
        quantityMilli: parseQuantity(quantity),
      }));
      return inv;
    },

    async lock(businessId, id) {
      const r = await db.query<{
        status: InvoiceStatus;
        amount_paid_minor: number;
        version: number;
        number: string;
      }>(
        `SELECT status, amount_paid_minor, version, number FROM invoices
         WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [id, businessId],
      );
      const row = r.rows[0];
      return row
        ? {
            status: row.status,
            amountPaidMinor: row.amount_paid_minor,
            version: row.version,
            number: row.number,
          }
        : null;
    },

    async customerUsable(businessId, customerId) {
      const r = await db.query(
        'SELECT 1 FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL',
        [customerId, businessId],
      );
      return (r.rowCount ?? 0) > 0;
    },

    async countOwnedProducts(businessId, ids) {
      if (!ids.length) return 0;
      const r = await db.query<{ n: string }>(
        'SELECT count(*) AS n FROM products WHERE business_id = $1 AND id = ANY($2::uuid[])',
        [businessId, ids],
      );
      return Number(r.rows[0]?.n ?? 0);
    },

    async allocateNumber(businessId) {
      const r = await db.query<{ n: string }>('SELECT next_document_number($1, $2) AS n', [
        businessId,
        'invoice',
      ]);
      return (r.rows[0] as { n: string }).n;
    },

    async insert(businessId, w) {
      const r = await db.query<{ id: string }>(
        `INSERT INTO invoices (business_id, customer_id, number, issue_date, due_date, currency,
           tax_inclusive, discount_type, discount_value, fees_minor, subtotal_minor,
           discount_total_minor, tax_total_minor, total_minor, notes, terms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
        [businessId, ...invoiceCols(w)],
      );
      const id = (r.rows[0] as { id: string }).id;
      await insertItems(businessId, id, w.items);
      return id;
    },

    async replace(businessId, id, w) {
      await db.query(
        `UPDATE invoices SET customer_id = $3, number = $4, issue_date = $5, due_date = $6, currency = $7,
           tax_inclusive = $8, discount_type = $9, discount_value = $10, fees_minor = $11,
           subtotal_minor = $12, discount_total_minor = $13, tax_total_minor = $14, total_minor = $15,
           notes = $16, terms = $17, version = version + 1
         WHERE id = $1 AND business_id = $2`,
        [id, businessId, ...invoiceCols(w)],
      );
      await db.query('DELETE FROM invoice_items WHERE invoice_id = $1 AND business_id = $2', [
        id,
        businessId,
      ]);
      await insertItems(businessId, id, w.items);
    },

    async setStatus(businessId, id, status) {
      await db.query(
        `UPDATE invoices SET status = $3::invoice_status, version = version + 1,
           sent_at = CASE WHEN $3::invoice_status = 'sent' THEN now() ELSE sent_at END
         WHERE id = $1 AND business_id = $2`,
        [id, businessId, status],
      );
    },

    async delete(businessId, id) {
      await db.query('DELETE FROM invoices WHERE id = $1 AND business_id = $2', [id, businessId]);
    },

    async activity(businessId, id) {
      const r = await db.query<{
        id: string;
        type: string;
        message: string | null;
        createdAt: string;
      }>(
        `SELECT id, type, message, created_at AS "createdAt" FROM invoice_activity
         WHERE invoice_id = $1 AND business_id = $2 ORDER BY created_at, id`,
        [id, businessId],
      );
      return r.rows;
    },

    async addActivity(businessId, invoiceId, type, message, metadata = {}) {
      await db.query(
        // clock_timestamp(), not now(): entries written in one transaction must keep their order.
        `INSERT INTO invoice_activity (business_id, invoice_id, type, message, metadata, created_at)
         VALUES ($1, $2, $3, $4, $5, clock_timestamp())`,
        [businessId, invoiceId, type, message, JSON.stringify(metadata)],
      );
    },

    async customerForPrint(businessId, customerId) {
      // Soft-deleted customers are included: old invoices must still render.
      const r = await db.query<CustomerPrint>(
        `SELECT coalesce(nullif(company_name, ''), nullif(trim(concat_ws(' ', first_name, last_name)), ''), 'Customer') AS name,
                email, phone, address_line1 AS "addressLine1", address_line2 AS "addressLine2", city,
                province, postal_code AS "postalCode", country
         FROM customers WHERE id = $1 AND business_id = $2`,
        [customerId, businessId],
      );
      return r.rows[0] ?? null;
    },

    async ensureShareSalt(businessId, id, newSalt) {
      const r = await db.query<{ public_token: string }>(
        `UPDATE invoices SET public_token = coalesce(public_token, $3)
         WHERE id = $1 AND business_id = $2 RETURNING public_token`,
        [id, businessId, newSalt],
      );
      return r.rows[0]?.public_token ?? null;
    },

    async clearShareSalt(businessId, id) {
      await db.query('UPDATE invoices SET public_token = NULL WHERE id = $1 AND business_id = $2', [
        id,
        businessId,
      ]);
    },

    async publicLookup(invoiceId) {
      const r = await db.query<{ business_id: string; public_token: string | null }>(
        'SELECT business_id, public_token FROM invoices WHERE id = $1',
        [invoiceId],
      );
      const row = r.rows[0];
      return row ? { businessId: row.business_id, salt: row.public_token } : null;
    },

    async markViewed(businessId, id) {
      const r = await db.query(
        `UPDATE invoices SET status = 'viewed', viewed_at = now(), version = version + 1
         WHERE id = $1 AND business_id = $2 AND status = 'sent'`,
        [id, businessId],
      );
      return (r.rowCount ?? 0) > 0;
    },

    async hasPendingPayment(businessId, id) {
      const r = await db.query(
        "SELECT 1 FROM payments WHERE invoice_id = $1 AND business_id = $2 AND status = 'pending'",
        [id, businessId],
      );
      return (r.rowCount ?? 0) > 0;
    },

    async setPaymentState(businessId, id, state) {
      await db.query(
        `UPDATE invoices SET amount_paid_minor = $3,
           status = coalesce($4::invoice_status, status),
           paid_at = CASE WHEN coalesce($4::invoice_status, status) = 'paid' THEN coalesce(paid_at, now()) ELSE NULL END,
           version = version + 1
         WHERE id = $1 AND business_id = $2`,
        [id, businessId, state.amountPaidMinor, state.status],
      );
    },

    async addAudit(e) {
      await db.query(
        `INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, ip, metadata)
         VALUES ($1, $2, $3, 'invoice', $4, $5, $6)`,
        [
          e.businessId,
          e.userId,
          e.action,
          e.entityId,
          e.ip ?? null,
          JSON.stringify(e.metadata ?? {}),
        ],
      );
    },
  };
}
