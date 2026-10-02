import {
  parseQuantity,
  quantityToDecimalString,
  type EstimateListQuery,
  type EstimateStatus,
} from '@invoiceflow/shared';
import type { Queryable } from '../db';
import type { InvoiceItemRecord } from './invoice-repository';
import { likePattern } from './sql';

export interface EstimateSummary {
  id: string;
  number: string;
  status: EstimateStatus;
  displayStatus: string;
  customerId: string;
  customerName: string;
  issueDate: string;
  expiryDate: string;
  currency: string;
  totalMinor: number;
  convertedInvoiceId: string | null;
  updatedAt: string;
}

export interface EstimateRecord extends EstimateSummary {
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
  createdAt: string;
  viewedAt: string | null;
  decidedAt: string | null;
  decidedByName: string | null;
  items: InvoiceItemRecord[];
}

export interface EstimateWrite {
  customerId: string;
  number: string;
  issueDate: string;
  expiryDate: string;
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

export const ESTIMATE_NUMBER_CONSTRAINT = 'estimates_business_id_number_key';

const TODAY = `(now() AT TIME ZONE b.timezone)::date`;
const DISPLAY_STATUS = `CASE WHEN e.status IN ('sent', 'viewed') AND e.expiry_date < ${TODAY}
    THEN 'expired' ELSE e.status::text END`;
const CUSTOMER_NAME = `coalesce(nullif(c.company_name, ''),
    nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Unnamed customer')`;

const SUMMARY = `e.id, e.number, e.status, ${DISPLAY_STATUS} AS "displayStatus",
  e.customer_id AS "customerId", ${CUSTOMER_NAME} AS "customerName",
  e.issue_date AS "issueDate", e.expiry_date AS "expiryDate", e.currency,
  e.total_minor AS "totalMinor", e.converted_invoice_id AS "convertedInvoiceId",
  e.updated_at AS "updatedAt"`;

const DETAIL = `${SUMMARY}, c.email AS "customerEmail", e.tax_inclusive AS "taxInclusive",
  e.discount_type AS "discountType", e.discount_value AS "discountValue", e.fees_minor AS "feesMinor",
  e.subtotal_minor AS "subtotalMinor", e.discount_total_minor AS "discountTotalMinor",
  e.tax_total_minor AS "taxTotalMinor", e.notes, e.terms, e.version, e.created_at AS "createdAt",
  e.viewed_at AS "viewedAt", e.decided_at AS "decidedAt", e.decided_by_name AS "decidedByName"`;

const FROM = `FROM estimates e
  JOIN business_profiles b ON b.id = e.business_id
  JOIN customers c ON c.id = e.customer_id`;

export interface EstimateRepository {
  list(
    businessId: string,
    q: EstimateListQuery,
  ): Promise<{ items: EstimateSummary[]; total: number }>;
  get(businessId: string, id: string): Promise<EstimateRecord | null>;
  /** SELECT ... FOR UPDATE */
  lock(
    businessId: string,
    id: string,
  ): Promise<{
    status: EstimateStatus;
    version: number;
    number: string;
    convertedInvoiceId: string | null;
  } | null>;
  allocateNumber(businessId: string): Promise<string>;
  /** `id` is optional: offline drafts bring their own (client-generated) id. */
  insert(businessId: string, w: EstimateWrite, id?: string): Promise<string>;
  idTaken(id: string): Promise<boolean>;
  replace(businessId: string, id: string, w: EstimateWrite): Promise<void>;
  setStatus(businessId: string, id: string, status: EstimateStatus): Promise<void>;
  markConverted(businessId: string, id: string, invoiceId: string): Promise<void>;
  /** Returns the estimate's share salt, creating one if none exists. */
  ensureShareSalt(businessId: string, id: string, newSalt: string): Promise<string | null>;
  clearShareSalt(businessId: string, id: string): Promise<void>;
  /** Public access: looks up by id only. The caller must verify the signed token before use. */
  publicLookup(id: string): Promise<{ businessId: string; salt: string | null } | null>;
  /** sent -> viewed, once. Returns true if this call changed the status. */
  markViewed(businessId: string, id: string): Promise<boolean>;
  /** Records who decided (a customer's typed name, or null for the owner) and when. */
  setDecisionName(businessId: string, id: string, name: string | null): Promise<void>;
  delete(businessId: string, id: string): Promise<void>;
  addAudit(e: {
    businessId: string;
    userId: string | null;
    action: string;
    entityId: string;
    ip?: string;
    metadata?: object;
  }): Promise<void>;
}

export function createEstimateRepository(db: Queryable): EstimateRepository {
  async function insertItems(
    businessId: string,
    estimateId: string,
    items: EstimateWrite['items'],
  ) {
    const cols = 11;
    const params: unknown[] = [];
    const rows = items.map((it, pos) => {
      params.push(
        estimateId,
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
      `INSERT INTO estimate_items (estimate_id, business_id, position, product_id, description, quantity,
         unit_price_minor, taxes, line_total_minor, discount_minor, tax_minor)
       VALUES ${rows.join(', ')}`,
      params,
    );
  }

  const cols = (w: EstimateWrite) => [
    w.customerId,
    w.number,
    w.issueDate,
    w.expiryDate,
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
      const where: string[] = ['e.business_id = $1'];
      const add = (sql: string, value: unknown) => {
        params.push(value);
        where.push(sql.replace('?', `$${params.length}`));
      };
      if (q.customerId) add('e.customer_id = ?', q.customerId);
      if (q.from) add('e.issue_date >= ?', q.from);
      if (q.to) add('e.issue_date <= ?', q.to);
      if (q.status) where.push(`(${DISPLAY_STATUS}) = '${q.status}'`); // enum-validated by zod
      if (q.search) {
        params.push(likePattern(q.search));
        const like = `$${params.length}`;
        let clause = `e.number ILIKE ${like} OR ${CUSTOMER_NAME} ILIKE ${like}
          OR concat_ws(' ', c.email) ILIKE ${like}`;
        if (/^\d{1,12}(\.\d{1,3})?$/.test(q.search)) {
          params.push(q.search);
          clause += ` OR e.total_minor = round($${params.length}::numeric * power(10, currency_exponent(e.currency)))`;
        }
        where.push(`(${clause})`);
      }
      const w = where.join(' AND ');
      const total = await db.query<{ n: string }>(
        `SELECT count(*) AS n ${FROM} WHERE ${w}`,
        params,
      );
      const rows = await db.query<EstimateSummary>(
        `SELECT ${SUMMARY} ${FROM} WHERE ${w}
         ORDER BY e.issue_date DESC, e.created_at DESC, e.id LIMIT ${q.limit} OFFSET ${q.offset}`,
        params,
      );
      return { items: rows.rows, total: Number(total.rows[0]?.n ?? 0) };
    },

    async get(businessId, id) {
      const r = await db.query<EstimateRecord>(
        `SELECT ${DETAIL} ${FROM} WHERE e.id = $1 AND e.business_id = $2`,
        [id, businessId],
      );
      const est = r.rows[0];
      if (!est) return null;
      const items = await db.query<Omit<InvoiceItemRecord, 'quantityMilli'> & { quantity: string }>(
        `SELECT id, product_id AS "productId", description, quantity::text AS quantity,
                unit_price_minor AS "unitPriceMinor", taxes, line_total_minor AS "lineTotalMinor",
                discount_minor AS "discountMinor", tax_minor AS "taxMinor"
         FROM estimate_items WHERE estimate_id = $1 AND business_id = $2 ORDER BY position`,
        [id, businessId],
      );
      // pg returns timestamptz as Date; the API and page work with ISO strings.
      for (const k of ['viewedAt', 'decidedAt'] as const) {
        const v = est[k] as unknown;
        est[k] = v instanceof Date ? v.toISOString() : (v as string | null);
      }
      est.items = items.rows.map(({ quantity, ...rest }) => ({
        ...rest,
        quantityMilli: parseQuantity(quantity),
      }));
      return est;
    },

    async lock(businessId, id) {
      const r = await db.query<{
        status: EstimateStatus;
        version: number;
        number: string;
        converted_invoice_id: string | null;
      }>(
        `SELECT status, version, number, converted_invoice_id FROM estimates
         WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [id, businessId],
      );
      const row = r.rows[0];
      return row
        ? {
            status: row.status,
            version: row.version,
            number: row.number,
            convertedInvoiceId: row.converted_invoice_id,
          }
        : null;
    },

    async allocateNumber(businessId) {
      const r = await db.query<{ n: string }>('SELECT next_document_number($1, $2) AS n', [
        businessId,
        'estimate',
      ]);
      return (r.rows[0] as { n: string }).n;
    },

    async idTaken(id) {
      const r = await db.query('SELECT 1 FROM estimates WHERE id = $1', [id]);
      return (r.rowCount ?? 0) > 0;
    },

    async insert(businessId, w, clientId) {
      const r = await db.query<{ id: string }>(
        `INSERT INTO estimates (business_id, customer_id, number, issue_date, expiry_date, currency,
           tax_inclusive, discount_type, discount_value, fees_minor, subtotal_minor,
           discount_total_minor, tax_total_minor, total_minor, notes, terms, id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
                 coalesce($17::uuid, gen_random_uuid())) RETURNING id`,
        [businessId, ...cols(w), clientId ?? null],
      );
      const id = (r.rows[0] as { id: string }).id;
      await insertItems(businessId, id, w.items);
      return id;
    },

    async replace(businessId, id, w) {
      await db.query(
        `UPDATE estimates SET customer_id = $3, number = $4, issue_date = $5, expiry_date = $6, currency = $7,
           tax_inclusive = $8, discount_type = $9, discount_value = $10, fees_minor = $11,
           subtotal_minor = $12, discount_total_minor = $13, tax_total_minor = $14, total_minor = $15,
           notes = $16, terms = $17, version = version + 1
         WHERE id = $1 AND business_id = $2`,
        [id, businessId, ...cols(w)],
      );
      await db.query('DELETE FROM estimate_items WHERE estimate_id = $1 AND business_id = $2', [
        id,
        businessId,
      ]);
      await insertItems(businessId, id, w.items);
    },

    async setStatus(businessId, id, status) {
      await db.query(
        `UPDATE estimates SET status = $3::estimate_status, version = version + 1,
           decided_at = CASE WHEN $3::estimate_status IN ('accepted', 'rejected')
                             THEN coalesce(decided_at, now()) ELSE decided_at END
         WHERE id = $1 AND business_id = $2`,
        [id, businessId, status],
      );
    },

    async markConverted(businessId, id, invoiceId) {
      await db.query(
        `UPDATE estimates SET converted_invoice_id = $3, version = version + 1
         WHERE id = $1 AND business_id = $2`,
        [id, businessId, invoiceId],
      );
    },

    async ensureShareSalt(businessId, id, newSalt) {
      const r = await db.query<{ public_token: string }>(
        `UPDATE estimates SET public_token = coalesce(public_token, $3)
         WHERE id = $1 AND business_id = $2 RETURNING public_token`,
        [id, businessId, newSalt],
      );
      return r.rows[0]?.public_token ?? null;
    },

    async clearShareSalt(businessId, id) {
      await db.query(
        'UPDATE estimates SET public_token = NULL WHERE id = $1 AND business_id = $2',
        [id, businessId],
      );
    },

    async publicLookup(id) {
      const r = await db.query<{ business_id: string; public_token: string | null }>(
        'SELECT business_id, public_token FROM estimates WHERE id = $1',
        [id],
      );
      const row = r.rows[0];
      return row ? { businessId: row.business_id, salt: row.public_token } : null;
    },

    async markViewed(businessId, id) {
      const r = await db.query(
        `UPDATE estimates SET status = 'viewed', viewed_at = now(), version = version + 1
         WHERE id = $1 AND business_id = $2 AND status = 'sent'`,
        [id, businessId],
      );
      return (r.rowCount ?? 0) > 0;
    },

    async setDecisionName(businessId, id, name) {
      await db.query(
        'UPDATE estimates SET decided_by_name = $3 WHERE id = $1 AND business_id = $2',
        [id, businessId, name],
      );
    },

    async delete(businessId, id) {
      await db.query('DELETE FROM estimates WHERE id = $1 AND business_id = $2', [id, businessId]);
    },

    async addAudit(e) {
      await db.query(
        `INSERT INTO audit_logs (business_id, user_id, action, entity_type, entity_id, ip, metadata)
         VALUES ($1, $2, $3, 'estimate', $4, $5, $6)`,
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
