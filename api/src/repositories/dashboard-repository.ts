import type { Queryable } from '../db';

export type DashboardPeriod = 'all' | 'this_month' | 'this_year';

export interface CurrencyTotals {
  currency: string;
  /** Balance still owed on live invoices (sent, viewed, partially paid), overdue ones included. */
  outstandingMinor: number;
  outstandingCount: number;
  /** The part of outstanding whose due date has passed (business timezone). */
  overdueMinor: number;
  overdueCount: number;
  draftMinor: number;
  draftCount: number;
  /** Money actually received (successful payments minus refunds) in the period. */
  paidMinor: number;
  paidCount: number;
}

const LIVE = `i.status IN ('sent', 'viewed', 'partially_paid') AND i.balance_due_minor > 0`;
// Same rule as the invoice list's "overdue" filter (a test keeps them in step).
const OVERDUE = `${LIVE} AND i.due_date < (now() AT TIME ZONE b.timezone)::date`;

const PERIOD_START: Record<DashboardPeriod, string | null> = {
  all: null,
  this_month: `(date_trunc('month', now() AT TIME ZONE b.timezone) AT TIME ZONE b.timezone)`,
  this_year: `(date_trunc('year', now() AT TIME ZONE b.timezone) AT TIME ZONE b.timezone)`,
};

export interface DashboardRepository {
  totals(businessId: string, period: DashboardPeriod): Promise<CurrencyTotals[]>;
}

export function createDashboardRepository(db: Queryable): DashboardRepository {
  return {
    async totals(businessId, period) {
      const inv = await db.query<{
        currency: string;
        outstanding: number;
        outstanding_count: string;
        overdue: number;
        overdue_count: string;
        draft: number;
        draft_count: string;
      }>(
        `SELECT i.currency,
           coalesce(sum(i.balance_due_minor) FILTER (WHERE ${LIVE}), 0)::bigint AS outstanding,
           count(*) FILTER (WHERE ${LIVE}) AS outstanding_count,
           coalesce(sum(i.balance_due_minor) FILTER (WHERE ${OVERDUE}), 0)::bigint AS overdue,
           count(*) FILTER (WHERE ${OVERDUE}) AS overdue_count,
           coalesce(sum(i.total_minor) FILTER (WHERE i.status = 'draft'), 0)::bigint AS draft,
           count(*) FILTER (WHERE i.status = 'draft') AS draft_count
         FROM invoices i JOIN business_profiles b ON b.id = i.business_id
         WHERE i.business_id = $1 GROUP BY i.currency`,
        [businessId],
      );
      const start = PERIOD_START[period];
      const paid = await db.query<{ currency: string; paid: number; n: string }>(
        `SELECT p.currency, coalesce(sum(p.amount_minor - p.refunded_minor), 0)::bigint AS paid,
                count(DISTINCT p.invoice_id) AS n
         FROM payments p JOIN business_profiles b ON b.id = p.business_id
         WHERE p.business_id = $1 AND p.status IN ('successful', 'refunded')
           ${start ? `AND p.paid_at >= ${start}` : ''}
         GROUP BY p.currency`,
        [businessId],
      );

      const byCurrency = new Map<string, CurrencyTotals>();
      const row = (currency: string): CurrencyTotals => {
        let t = byCurrency.get(currency);
        if (!t) {
          t = {
            currency,
            outstandingMinor: 0,
            outstandingCount: 0,
            overdueMinor: 0,
            overdueCount: 0,
            draftMinor: 0,
            draftCount: 0,
            paidMinor: 0,
            paidCount: 0,
          };
          byCurrency.set(currency, t);
        }
        return t;
      };
      for (const r of inv.rows) {
        const t = row(r.currency.trim());
        t.outstandingMinor = r.outstanding;
        t.outstandingCount = Number(r.outstanding_count);
        t.overdueMinor = r.overdue;
        t.overdueCount = Number(r.overdue_count);
        t.draftMinor = r.draft;
        t.draftCount = Number(r.draft_count);
      }
      for (const r of paid.rows) {
        const t = row(r.currency.trim());
        t.paidMinor = r.paid;
        t.paidCount = Number(r.n);
      }
      return [...byCurrency.values()];
    },
  };
}
