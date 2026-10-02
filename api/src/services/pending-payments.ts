import type { Database } from '../db';
import { createPaymentRepository } from '../repositories/payment-repository';
import type { StripeGateway } from './stripe-gateway';

/**
 * Intent states in which the customer has not handed over a card yet, so cancelling cannot lose
 * money. `requires_action` (3-D Secure in progress), `processing`, `requires_capture` and
 * `succeeded` are deliberately absent: money may be moving.
 */
const ABANDONABLE = ['requires_payment_method', 'requires_confirmation'];

export type ReleasePendingPayment = (businessId: string, invoiceId: string) => Promise<void>;

/**
 * A pending payment row is created as soon as a customer opens the payment form, and only leaves
 * `pending` via a Stripe webhook. If the customer walks away it would block invoice edits forever, so
 * before an owner changes an invoice this cancels an untouched intent at Stripe and marks the row
 * `failed` ('abandoned'). Anything uncertain (Stripe unreachable, cancel refused, money moving) leaves
 * the row pending, and the caller's PAYMENT_IN_PROGRESS check still applies.
 */
export function createPendingPaymentReleaser(
  db: Database,
  gateway: StripeGateway | null,
): ReleasePendingPayment {
  return async (businessId, invoiceId) => {
    if (!gateway) return; // no Stripe: nothing can be verified, keep blocking
    const pending = await createPaymentRepository(db).pendingForInvoice(invoiceId);
    if (!pending || pending.business_id !== businessId) return;
    const intentId = pending.stripe_payment_intent_id;
    try {
      const pi = await gateway.retrievePaymentIntent(intentId);
      if (pi.status !== 'canceled') {
        if (!ABANDONABLE.includes(pi.status)) return;
        await gateway.cancelPaymentIntent(intentId);
      }
    } catch {
      return;
    }
    await db.transaction(async (tx) => {
      const pay = createPaymentRepository(tx);
      const row = await pay.findByIntentForUpdate(intentId);
      if (row?.status === 'pending') await pay.markFailed(row.id, 'abandoned');
    });
  };
}
