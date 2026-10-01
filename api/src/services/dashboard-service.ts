import type { Database } from '../db';
import { createBusinessRepository } from '../repositories/business-repository';
import {
  createDashboardRepository,
  type CurrencyTotals,
  type DashboardPeriod,
} from '../repositories/dashboard-repository';
import { createInvoiceRepository } from '../repositories/invoice-repository';
import { createPaymentRepository } from '../repositories/payment-repository';
import { notFound } from '../utils/errors';

const RECENT = 5;

/** Everything the home screen needs in one round trip. */
export function createDashboardService(db: Database) {
  return {
    async get(businessId: string, period: DashboardPeriod) {
      const business = await createBusinessRepository(db).get(businessId);
      if (!business) throw notFound('Business');
      const [totals, recentInvoices, recentPayments] = await Promise.all([
        createDashboardRepository(db).totals(businessId, period),
        createInvoiceRepository(db).list(businessId, { limit: RECENT, offset: 0 }),
        createPaymentRepository(db).list(businessId, {
          status: 'successful',
          limit: RECENT,
          offset: 0,
        }),
      ]);

      // The default currency always comes first (and is present even when empty); others follow A-Z.
      const def = business.defaultCurrency.trim();
      const rest = totals
        .filter((t) => t.currency !== def)
        .sort((a, b) => a.currency.localeCompare(b.currency));
      const primary: CurrencyTotals = totals.find((t) => t.currency === def) ?? {
        currency: def,
        outstandingMinor: 0,
        outstandingCount: 0,
        overdueMinor: 0,
        overdueCount: 0,
        draftMinor: 0,
        draftCount: 0,
        paidMinor: 0,
        paidCount: 0,
      };
      return {
        businessName: business.name,
        defaultCurrency: def,
        period,
        currencies: [primary, ...rest],
        recentInvoices: recentInvoices.items,
        recentPayments: recentPayments.items,
      };
    },
  };
}
export type DashboardService = ReturnType<typeof createDashboardService>;
