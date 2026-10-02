import { formatMoney, isSupportedCurrency } from '@invoiceflow/shared';
import type { Database } from '../db';
import { createInvoiceRepository } from '../repositories/invoice-repository';
import { createNotificationRepository } from '../repositories/notification-repository';

/** More than this many newly overdue invoices for one business in a batch become one summary. */
const DIGEST_ABOVE = 5;

const money = (n: number, cur: string) =>
  isSupportedCurrency(cur) ? formatMoney(n, cur) : `${n} ${cur}`;

/**
 * Finds invoices that have become overdue and notifies their owners ONCE per due date.
 *
 * "Overdue" uses the same rule as the rest of the app: live status (sent/viewed/partially paid), a
 * balance, and a due date before today in the BUSINESS's timezone. Rows are claimed with SKIP LOCKED
 * and flagged in the same statement, so overlapping sweeps (several instances, retries) can never
 * notify twice.
 */
export function createOverdueService(db: Database) {
  async function sweep(batch = 200): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await db.transaction(async (tx) => {
        const claimed = await tx.query<{
          id: string;
          business_id: string;
          number: string;
          balance_due_minor: number;
          currency: string;
          customer_id: string;
        }>(
          `WITH due AS (
             SELECT i.id FROM invoices i JOIN business_profiles b ON b.id = i.business_id
             WHERE i.status IN ('sent', 'viewed', 'partially_paid')
               AND i.balance_due_minor > 0
               AND i.due_date < (now() AT TIME ZONE b.timezone)::date
               AND i.overdue_notified_due_date IS DISTINCT FROM i.due_date
             ORDER BY i.due_date, i.id
             LIMIT $1
             FOR UPDATE OF i SKIP LOCKED
           )
           UPDATE invoices i SET overdue_notified_due_date = i.due_date
           FROM due WHERE i.id = due.id
           RETURNING i.id, i.business_id, i.number, i.balance_due_minor, i.currency, i.customer_id`,
          [batch],
        );
        const inv = createInvoiceRepository(tx);
        const notifications = createNotificationRepository(tx);
        // After downtime (or a first deploy) one business can have hundreds of invoices go overdue at
        // once. Every invoice still gets its timeline entry, but the owner gets ONE summary
        // notification instead of a flood of pushes.
        const perBusiness = new Map<string, typeof claimed.rows>();
        for (const row of claimed.rows) {
          const list = perBusiness.get(row.business_id) ?? [];
          list.push(row);
          perBusiness.set(row.business_id, list);
        }
        for (const [businessId, rows] of perBusiness) {
          for (const row of rows) {
            await inv.addActivity(
              businessId,
              row.id,
              'overdue',
              `Invoice is now overdue (${money(row.balance_due_minor, row.currency)} due)`,
            );
          }
          if (rows.length > DIGEST_ABOVE) {
            await notifications.add({
              businessId,
              type: 'invoices_overdue',
              title: 'Invoices overdue',
              body: `${rows.length} invoices are now overdue. Open Invoices and filter by Overdue to follow up.`,
              data: { count: rows.length, list: 'overdue' },
            });
            continue;
          }
          for (const row of rows) {
            const customer = await inv.customerForPrint(businessId, row.customer_id);
            await notifications.add({
              businessId,
              type: 'invoice_overdue',
              title: 'Invoice overdue',
              body: `Invoice ${row.number} for ${customer?.name ?? 'a customer'} is now overdue (${money(row.balance_due_minor, row.currency)} due).`,
              data: { invoiceId: row.id },
            });
          }
        }
        return claimed.rows.length;
      });
      total += n;
      if (n < batch) return total;
    }
  }
  return { sweep };
}
export type OverdueService = ReturnType<typeof createOverdueService>;

export interface ScheduledJob {
  name: string;
  everyMs: number;
  run: () => Promise<unknown>;
  /** Also run once shortly after start. */
  initialDelayMs?: number;
}

/** Runs jobs on intervals without overlapping themselves. Returns a stop function. */
export function startSchedulers(
  jobs: ScheduledJob[],
  log: (m: string) => void = console.error,
): () => void {
  const timers: NodeJS.Timeout[] = [];
  for (const job of jobs) {
    let running = false;
    const tick = () => {
      if (running) return;
      running = true;
      job
        .run()
        .catch((e: Error) => log(`job ${job.name} failed: ${e.message}`))
        .finally(() => (running = false));
    };
    timers.push(setInterval(tick, job.everyMs).unref());
    if (job.initialDelayMs !== undefined) timers.push(setTimeout(tick, job.initialDelayMs).unref());
  }
  return () => timers.forEach((t) => (clearInterval(t), clearTimeout(t)));
}
