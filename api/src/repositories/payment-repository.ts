import type { PaymentListQuery, PaymentMethod, PaymentStatus } from '@invoiceflow/shared';
import type { Queryable } from '../db';
import { likePattern } from './sql';

export interface PaymentRecord {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  amountMinor: number;
  refundedMinor: number;
  currency: string;
  status: PaymentStatus;
  method: PaymentMethod | null;
  stripePaymentIntentId: string | null;
  receiptUrl: string | null;
  failureCode: string | null;
  paidAt: string | null;
  createdAt: string;
}

const SELECT = `p.id, p.invoice_id AS "invoiceId", i.number AS "invoiceNumber",
  coalesce(nullif(c.company_name, ''), nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Customer') AS "customerName",
  p.amount_minor AS "amountMinor", p.refunded_minor AS "refundedMinor", p.currency, p.status, p.method,
  p.stripe_payment_intent_id AS "stripePaymentIntentId", p.receipt_url AS "receiptUrl",
  p.failure_code AS "failureCode", p.paid_at AS "paidAt", p.created_at AS "createdAt"`;
const FROM = `FROM payments p JOIN invoices i ON i.id = p.invoice_id JOIN customers c ON c.id = i.customer_id`;

export interface RawPayment {
  id: string;
  business_id: string;
  invoice_id: string;
  amount_minor: number;
  refunded_minor: number;
  currency: string;
  status: PaymentStatus;
  stripe_payment_intent_id: string | null;
}

export interface PaymentRepository {
  list(businessId: string, q: PaymentListQuery): Promise<{ items: PaymentRecord[]; total: number }>;
  get(businessId: string, id: string): Promise<PaymentRecord | null>;
  /** Locks the row (FOR UPDATE) so concurrent webhooks for one payment run one after the other. */
  findByIntentForUpdate(intentId: string): Promise<RawPayment | null>;
  findForUpdate(businessId: string, id: string): Promise<RawPayment | null>;
  pendingForInvoice(
    invoiceId: string,
  ): Promise<(RawPayment & { stripe_payment_intent_id: string }) | null>;
  countForInvoice(invoiceId: string): Promise<number>;
  insertPending(p: {
    businessId: string;
    invoiceId: string;
    amountMinor: number;
    currency: string;
    intentId: string;
    idempotencyKey: string;
    applicationFeeMinor: number;
  }): Promise<string>;
  markFailed(id: string, code: string): Promise<void>;
  markSuccessful(
    id: string,
    p: { amountMinor: number; method: PaymentMethod; chargeId: string; receiptUrl: string | null },
  ): Promise<void>;
  setRefunded(id: string, refundedMinor: number, status: PaymentStatus): Promise<void>;
  /** Net money received for an invoice: successful and refunded payments, minus refunds. */
  netPaid(invoiceId: string): Promise<{ net: number; anyRefund: boolean }>;
  /** Records a webhook event id. Returns false if it was already recorded (duplicate delivery). */
  recordEvent(id: string, type: string, payload: unknown): Promise<boolean>;
  markEventProcessed(id: string): Promise<void>;
  addNotification(n: {
    businessId: string;
    type: string;
    title: string;
    body: string;
    data: object;
  }): Promise<void>;
}

export function createPaymentRepository(db: Queryable): PaymentRepository {
  const RAW =
    'id, business_id, invoice_id, amount_minor, refunded_minor, currency, status, stripe_payment_intent_id';
  return {
    async list(businessId, q) {
      const params: unknown[] = [businessId];
      const where = ['p.business_id = $1'];
      if (q.status) {
        params.push(q.status);
        where.push(`p.status = $${params.length}`);
      }
      if (q.search) {
        params.push(likePattern(q.search));
        const like = `$${params.length}`;
        where.push(`(i.number ILIKE ${like} OR p.stripe_payment_intent_id ILIKE ${like} OR p.id::text ILIKE ${like}
          OR concat_ws(' ', c.company_name, c.first_name, c.last_name) ILIKE ${like})`);
      }
      const w = where.join(' AND ');
      const total = await db.query<{ n: string }>(
        `SELECT count(*) AS n ${FROM} WHERE ${w}`,
        params,
      );
      const rows = await db.query<PaymentRecord>(
        `SELECT ${SELECT} ${FROM} WHERE ${w} ORDER BY p.created_at DESC, p.id LIMIT ${q.limit} OFFSET ${q.offset}`,
        params,
      );
      return { items: rows.rows, total: Number(total.rows[0]?.n ?? 0) };
    },

    async get(businessId, id) {
      const r = await db.query<PaymentRecord>(
        `SELECT ${SELECT} ${FROM} WHERE p.id = $1 AND p.business_id = $2`,
        [id, businessId],
      );
      return r.rows[0] ?? null;
    },

    async findByIntentForUpdate(intentId) {
      const r = await db.query<RawPayment>(
        `SELECT ${RAW} FROM payments WHERE stripe_payment_intent_id = $1 FOR UPDATE`,
        [intentId],
      );
      return r.rows[0] ?? null;
    },

    async findForUpdate(businessId, id) {
      const r = await db.query<RawPayment>(
        `SELECT ${RAW} FROM payments WHERE id = $1 AND business_id = $2 FOR UPDATE`,
        [id, businessId],
      );
      return r.rows[0] ?? null;
    },

    async pendingForInvoice(invoiceId) {
      const r = await db.query<RawPayment & { stripe_payment_intent_id: string }>(
        `SELECT ${RAW} FROM payments WHERE invoice_id = $1 AND status = 'pending'`,
        [invoiceId],
      );
      return r.rows[0] ?? null;
    },

    async countForInvoice(invoiceId) {
      const r = await db.query<{ n: string }>(
        'SELECT count(*) AS n FROM payments WHERE invoice_id = $1',
        [invoiceId],
      );
      return Number(r.rows[0]?.n ?? 0);
    },

    async insertPending(p) {
      const r = await db.query<{ id: string }>(
        `INSERT INTO payments (business_id, invoice_id, amount_minor, currency, status, stripe_payment_intent_id,
           idempotency_key, application_fee_minor)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7) RETURNING id`,
        [
          p.businessId,
          p.invoiceId,
          p.amountMinor,
          p.currency,
          p.intentId,
          p.idempotencyKey,
          p.applicationFeeMinor,
        ],
      );
      return (r.rows[0] as { id: string }).id;
    },

    async markFailed(id, code) {
      await db.query(
        "UPDATE payments SET status = 'failed', failure_code = $2 WHERE id = $1 AND status = 'pending'",
        [id, code],
      );
    },

    async markSuccessful(id, p) {
      await db.query(
        `UPDATE payments SET status = 'successful', amount_minor = $2, method = $3, stripe_charge_id = $4,
           receipt_url = $5, paid_at = now(), failure_code = NULL WHERE id = $1`,
        [id, p.amountMinor, p.method, p.chargeId, p.receiptUrl],
      );
    },

    async setRefunded(id, refundedMinor, status) {
      await db.query(
        'UPDATE payments SET refunded_minor = $2, status = $3::payment_status WHERE id = $1',
        [id, refundedMinor, status],
      );
    },

    async netPaid(invoiceId) {
      const r = await db.query<{ net: string | null; refunds: string | null }>(
        `SELECT sum(amount_minor - refunded_minor) AS net, sum(refunded_minor) AS refunds
         FROM payments WHERE invoice_id = $1 AND status IN ('successful', 'refunded')`,
        [invoiceId],
      );
      return { net: Number(r.rows[0]?.net ?? 0), anyRefund: Number(r.rows[0]?.refunds ?? 0) > 0 };
    },

    async recordEvent(id, type, payload) {
      const r = await db.query(
        'INSERT INTO webhook_events (id, type, payload) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
        [id, type, JSON.stringify(payload)],
      );
      return (r.rowCount ?? 0) > 0;
    },

    async markEventProcessed(id) {
      await db.query('UPDATE webhook_events SET processed_at = now() WHERE id = $1', [id]);
    },

    async addNotification(n) {
      await db.query(
        'INSERT INTO notifications (business_id, type, title, body, data, created_at) VALUES ($1, $2, $3, $4, $5, clock_timestamp())',
        [n.businessId, n.type, n.title, n.body, JSON.stringify(n.data)],
      );
    },
  };
}
