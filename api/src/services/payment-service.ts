import {
  formatMoney,
  fromStripeAmount,
  isSupportedCurrency,
  MoneyError,
  platformFee,
  toStripeAmount,
  type CurrencyCode,
  type InvoiceStatus,
  type PaymentListQuery,
  type PaymentStatus,
} from '@invoiceflow/shared';
import type { Config } from '../config';
import type { Database, Queryable } from '../db';
import type { BusinessRepository } from '../repositories/business-repository';
import { createInvoiceRepository } from '../repositories/invoice-repository';
import { createPaymentRepository } from '../repositories/payment-repository';
import { AppError, notFound } from '../utils/errors';
import type { Actor, InvoiceService } from './invoice-service';
import {
  GatewayError,
  type ChargeLite,
  type StripeEventLite,
  type StripeGateway,
} from './stripe-gateway';

type PaymentConfig = Pick<Config, 'PUBLIC_APP_URL' | 'PLATFORM_FEE_BPS' | 'STRIPE_PUBLISHABLE_KEY'>;

interface Deps {
  db: Database;
  invoices: InvoiceService;
  businesses: BusinessRepository;
  /** Null when Stripe is not configured: online payments are then simply unavailable. */
  gateway: StripeGateway | null;
  config: PaymentConfig;
}

const PAYABLE: InvoiceStatus[] = ['sent', 'viewed', 'partially_paid'];
const REUSABLE_INTENT = ['requires_payment_method', 'requires_confirmation', 'requires_action'];

const money = (n: number, cur: string) =>
  isSupportedCurrency(cur) ? formatMoney(n, cur) : `${n} ${cur}`;

/** Invoice status implied by what has actually been received (null = leave unchanged). */
export function statusFromPayments(
  total: number,
  net: number,
  anyRefund: boolean,
): InvoiceStatus | null {
  if (net >= total && net > 0) return 'paid';
  if (net > 0) return 'partially_paid';
  return anyRefund ? 'refunded' : null;
}

export function createPaymentService(deps: Deps) {
  const { db, invoices, businesses, config } = deps;
  const gateway = (): StripeGateway => {
    if (!deps.gateway)
      throw new AppError(
        503,
        'PAYMENTS_UNAVAILABLE',
        'Online payments are not available right now',
      );
    return deps.gateway;
  };
  const repos = (q: Queryable) => ({
    pay: createPaymentRepository(q),
    inv: createInvoiceRepository(q),
  });

  // ------------------------------------------------------------------ Stripe Connect onboarding
  async function connectStatus(businessId: string) {
    const acct = await businesses.getStripeAccount(businessId);
    if (!acct?.accountId) {
      return {
        configured: Boolean(deps.gateway),
        connected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
        requirementsDue: [] as string[],
      };
    }
    const s = await gateway()
      .retrieveAccount(acct.accountId)
      .catch(() => {
        throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'Could not reach the payment provider');
      });
    if (s.chargesEnabled !== acct.chargesEnabled)
      await businesses.setChargesEnabled(businessId, s.chargesEnabled);
    return { configured: true, connected: true, ...s };
  }

  async function connectOnboard(actor: Actor) {
    const g = gateway();
    const business = await businesses.get(actor.businessId);
    if (!business) throw notFound('Business');
    let acct = await businesses.getStripeAccount(actor.businessId);
    try {
      if (!acct?.accountId) {
        const created = await g.createExpressAccount({
          email: business.email,
          name: business.name,
          country: business.country,
          businessId: actor.businessId,
        });
        await businesses.setStripeAccount(actor.businessId, created.id);
        acct = { accountId: created.id, chargesEnabled: false };
      }
      const base = config.PUBLIC_APP_URL.replace(/\/$/, '');
      const link = await g.createAccountLink(
        acct.accountId as string,
        `${base}/stripe/connect/return`,
        `${base}/stripe/connect/refresh`,
      );
      return { url: link.url };
    } catch (e) {
      // Only Stripe failures are "provider errors"; anything else (e.g. our database) must surface as itself.
      if (e instanceof GatewayError)
        throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'Could not reach the payment provider');
      throw e;
    }
  }

  // ------------------------------------------------------------------ creating a payment attempt
  const providerError = (message = 'Could not reach the payment provider') =>
    new AppError(502, 'PAYMENT_PROVIDER_ERROR', message);
  const inProgress = () =>
    new AppError(
      409,
      'PAYMENT_IN_PROGRESS',
      'A payment for this invoice is already being processed',
    );

  /** Locks the invoice and checks it can take `amountMinor` (default: the balance). Call inside a transaction. */
  async function payableInvoice(
    tx: Queryable,
    businessId: string,
    invoiceId: string,
    amountMinor?: number,
  ) {
    const { inv } = repos(tx);
    // The invoice row lock serialises the database side of every payment attempt for this invoice.
    if (!(await inv.lock(businessId, invoiceId))) throw notFound('Invoice');
    const record = await inv.get(businessId, invoiceId);
    if (!record) throw notFound('Invoice');
    const invoice = invoices.toDto(record);
    if (!PAYABLE.includes(invoice.status) || invoice.balanceDueMinor <= 0) {
      throw new AppError(409, 'INVOICE_NOT_PAYABLE', 'This invoice cannot be paid right now');
    }
    const amount = amountMinor ?? invoice.balanceDueMinor;
    if (amount > invoice.balanceDueMinor) {
      throw new AppError(422, 'AMOUNT_TOO_HIGH', 'That is more than the amount due');
    }
    if (!isSupportedCurrency(invoice.currency))
      throw new AppError(422, 'AMOUNT_UNSUPPORTED', 'Unsupported currency');
    return { invoice, amount, currency: invoice.currency as CurrencyCode };
  }

  /**
   * Creates (or safely reuses) the single in-flight PaymentIntent for an invoice.
   *
   * Stripe is never called while a transaction is open (that would hold a pooled connection and the
   * invoice lock for up to a minute of network retries). Instead: (1) a short transaction validates
   * and reads the current attempt, (2) Stripe calls run outside any transaction, (3) a second short
   * transaction re-checks under the lock and records the result. If the state moved in between, the
   * new intent is recorded as failed and cancelled; its client secret never left the server.
   */
  async function createIntent(input: {
    businessId: string;
    invoiceId: string;
    amountMinor?: number;
  }) {
    const g = gateway();
    const acct = await businesses.getStripeAccount(input.businessId);
    if (!acct?.accountId || !acct.chargesEnabled) {
      throw new AppError(
        409,
        'PAYMENTS_NOT_ENABLED',
        'This business has not set up online payments',
      );
    }

    // (1) Validate and read the current attempt.
    const plan = await db.transaction(async (tx) => {
      const { pay, inv } = repos(tx);
      const { invoice, amount, currency } = await payableInvoice(
        tx,
        input.businessId,
        input.invoiceId,
        input.amountMinor,
      );
      let stripeAmount: number;
      try {
        stripeAmount = toStripeAmount(amount, currency);
      } catch (e) {
        if (e instanceof MoneyError) throw new AppError(422, 'AMOUNT_UNSUPPORTED', e.message);
        throw e;
      }
      return {
        invoice,
        amount,
        currency,
        stripeAmount,
        existing: await pay.pendingForInvoice(invoice.id),
        customer: await inv.customerForPrint(input.businessId, invoice.customerId),
        attempt: await pay.countForInvoice(invoice.id),
      };
    });
    const { invoice, amount, currency, stripeAmount, existing } = plan;

    // (2) Stripe, outside any transaction.
    if (existing) {
      const pi = await g.retrievePaymentIntent(existing.stripe_payment_intent_id).catch(() => {
        throw providerError();
      });
      // Money may already be moving: never start a second attempt.
      if (
        pi.status === 'processing' ||
        pi.status === 'succeeded' ||
        pi.status === 'requires_capture'
      )
        throw inProgress();
      if (existing.amount_minor === amount && REUSABLE_INTENT.includes(pi.status)) {
        return {
          paymentId: existing.id,
          clientSecret: pi.clientSecret,
          amountMinor: amount,
          currency,
          reused: true,
        };
      }
      if (pi.status !== 'canceled') {
        // If the old intent is not provably cancelled, its client secret may still be live in
        // another tab: replacing it could let the customer pay twice. Keep it and ask for a retry.
        await g.cancelPaymentIntent(existing.stripe_payment_intent_id).catch(() => {
          throw providerError('Could not start the payment. Please try again.');
        });
      }
    }

    // Unique per recorded attempt, so a replaced (cancelled) intent is never handed back by Stripe's
    // idempotency, while simultaneous identical requests share one intent.
    const key = `pi:${invoice.id}:${amount}:${plan.attempt}`;
    const fee = platformFee(stripeAmount, config.PLATFORM_FEE_BPS);
    let pi;
    try {
      pi = await g.createPaymentIntent(
        {
          amount: stripeAmount,
          currency,
          destination: acct.accountId as string,
          applicationFee: fee,
          receiptEmail: plan.customer?.email ?? null,
          description: `Invoice ${invoice.number}`,
          metadata: {
            invoice_id: invoice.id,
            business_id: input.businessId,
            invoice_number: invoice.number,
          },
        },
        key,
      );
    } catch (e) {
      if (e instanceof GatewayError && e.code === 'amount_too_small') {
        throw new AppError(
          422,
          'AMOUNT_TOO_SMALL',
          'That amount is below the minimum for card payments',
        );
      }
      throw providerError('Could not start the payment. Please try again.');
    }
    const created = pi;

    // (3) Re-check under the lock and record.
    const outcome = await db.transaction(async (tx) => {
      const { pay } = repos(tx);
      const fresh = await payableInvoice(
        tx,
        input.businessId,
        input.invoiceId,
        input.amountMinor,
      ).catch((e: unknown) => ({ error: e }));
      const known = await pay.findByIntentForUpdate(created.id);
      if (known) {
        // A simultaneous identical request recorded this same intent first.
        if (known.status === 'pending' && !('error' in fresh))
          return { paymentId: known.id, reused: true, orphan: false };
        throw 'error' in fresh ? fresh.error : inProgress();
      }
      const pending = await pay.pendingForInvoice(invoice.id);
      const stale =
        'error' in fresh ||
        fresh.amount !== amount ||
        (pending !== null && pending.id !== existing?.id);
      if (!stale && pending) await pay.markFailed(pending.id, 'replaced');
      const paymentId = await pay.insertPending({
        businessId: input.businessId,
        invoiceId: invoice.id,
        amountMinor: amount,
        currency,
        intentId: created.id,
        idempotencyKey: key,
        applicationFeeMinor: fee,
        // Recorded either way (so the next attempt gets a new key), but a stale one is never handed out.
        ...(stale ? { failureCode: 'superseded' } : {}),
      });
      if (!stale) return { paymentId, reused: false, orphan: false };
      return {
        paymentId,
        reused: false,
        orphan: true,
        error: 'error' in fresh ? fresh.error : null,
      };
    });

    if (outcome.orphan) {
      await g.cancelPaymentIntent(created.id).catch(() => undefined); // its secret was never shared
      throw outcome.error ?? inProgress();
    }
    return {
      paymentId: outcome.paymentId,
      clientSecret: created.clientSecret,
      amountMinor: amount,
      currency,
      reused: outcome.reused,
    };
  }

  // ------------------------------------------------------------------ webhooks
  /** Recomputes invoice paid amount and status from the payments table (idempotent). */
  async function syncInvoice(tx: Queryable, businessId: string, invoiceId: string) {
    const { pay, inv } = repos(tx);
    const { net, anyRefund } = await pay.netPaid(invoiceId);
    const invoice = await inv.get(businessId, invoiceId);
    if (!invoice) return null;
    const next = statusFromPayments(invoice.totalMinor, net, anyRefund);
    // Only move live invoices; a cancelled one that somehow received money keeps its status.
    const apply =
      next && (['sent', 'viewed', 'partially_paid', 'paid'] as string[]).includes(invoice.status)
        ? next
        : null;
    await inv.setPaymentState(businessId, invoiceId, { amountPaidMinor: net, status: apply });
    return { invoice, net, status: apply ?? invoice.status, previous: invoice.status };
  }

  async function onSucceeded(
    tx: Queryable,
    pi: { id: string; amount_received?: number; amount: number; latest_charge?: string | null },
    charge: ChargeLite,
  ) {
    const { pay, inv } = repos(tx);
    const payment = await pay.findByIntentForUpdate(pi.id);
    if (!payment || payment.status === 'successful' || payment.status === 'refunded') return; // unknown or already applied
    await inv.lock(payment.business_id, payment.invoice_id);

    const currency = payment.currency as CurrencyCode;
    const received = fromStripeAmount(pi.amount_received ?? pi.amount, currency);
    await pay.markSuccessful(payment.id, {
      amountMinor: received,
      method: charge.method,
      chargeId: charge.id,
      receiptUrl: charge.receiptUrl,
    });
    if (received !== payment.amount_minor) {
      await inv.addAudit({
        businessId: payment.business_id,
        userId: null, // system action: no signed-in user
        action: 'payment.amount_mismatch',
        entityId: payment.invoice_id,
        metadata: { expected: payment.amount_minor, received },
      });
    }

    const synced = await syncInvoice(tx, payment.business_id, payment.invoice_id);
    if (!synced) return;
    const label =
      charge.method === 'apple_pay'
        ? ' (Apple Pay)'
        : charge.method === 'google_pay'
          ? ' (Google Pay)'
          : '';
    const amt = money(received, payment.currency);
    await inv.addActivity(
      payment.business_id,
      payment.invoice_id,
      'payment_received',
      `Payment of ${amt} received${label}`,
      { paymentId: payment.id },
    );
    if (synced.status === 'paid' && synced.previous !== 'paid') {
      await inv.addActivity(
        payment.business_id,
        payment.invoice_id,
        'paid',
        'Invoice marked as paid',
      );
    }
    await pay.addNotification({
      businessId: payment.business_id,
      type: synced.status === 'paid' ? 'invoice_paid' : 'partial_payment',
      title: synced.status === 'paid' ? 'Invoice paid' : 'Partial payment received',
      body: `Payment of ${amt} received for ${synced.invoice.number}.`,
      data: { invoiceId: payment.invoice_id, paymentId: payment.id },
    });
  }

  async function onFailed(
    tx: Queryable,
    pi: { id: string; last_payment_error?: { code?: string } | null },
    canceled: boolean,
  ) {
    const { pay, inv } = repos(tx);
    const payment = await pay.findByIntentForUpdate(pi.id);
    if (!payment || payment.status !== 'pending') return; // a late failure never overrides a success
    const code = canceled ? 'canceled' : (pi.last_payment_error?.code ?? 'payment_failed');
    await pay.markFailed(payment.id, code);
    if (canceled) return;
    const invoice = await inv.get(payment.business_id, payment.invoice_id);
    const amt = money(payment.amount_minor, payment.currency);
    await inv.addActivity(
      payment.business_id,
      payment.invoice_id,
      'payment_failed',
      `Payment of ${amt} failed`,
      { paymentId: payment.id, code },
    );
    await pay.addNotification({
      businessId: payment.business_id,
      type: 'payment_failed',
      title: 'Payment failed',
      body: `Payment of ${amt} failed for ${invoice?.number ?? 'an invoice'}.`,
      data: { invoiceId: payment.invoice_id, paymentId: payment.id },
    });
  }

  async function onRefunded(
    tx: Queryable,
    charge: { payment_intent?: string | null; amount_refunded: number },
  ) {
    const { pay, inv } = repos(tx);
    if (!charge.payment_intent) return;
    const payment = await pay.findByIntentForUpdate(charge.payment_intent);
    if (!payment || (payment.status !== 'successful' && payment.status !== 'refunded')) return;
    await inv.lock(payment.business_id, payment.invoice_id);
    const refunded = Math.min(
      payment.amount_minor,
      fromStripeAmount(charge.amount_refunded, payment.currency as CurrencyCode),
    );
    if (refunded <= payment.refunded_minor) return; // duplicate or older state: refunds only grow
    const status: PaymentStatus = refunded >= payment.amount_minor ? 'refunded' : 'successful';
    await pay.setRefunded(payment.id, refunded, status);
    const synced = await syncInvoice(tx, payment.business_id, payment.invoice_id);
    const delta = refunded - payment.refunded_minor;
    await inv.addActivity(
      payment.business_id,
      payment.invoice_id,
      'refund',
      `Refund of ${money(delta, payment.currency)} issued`,
      { paymentId: payment.id },
    );
    if (synced) {
      await pay.addNotification({
        businessId: payment.business_id,
        type: 'refund',
        title: 'Refund issued',
        body: `Refund of ${money(delta, payment.currency)} for ${synced.invoice.number}.`,
        data: { invoiceId: payment.invoice_id, paymentId: payment.id },
      });
    }
  }

  /**
   * Stripe webhook entry point. The signature is verified against the raw body; each event id is
   * processed at most once (the dedupe row commits together with its effects, so a failure rolls
   * both back and Stripe's retry runs it again).
   */
  async function handleWebhook(rawBody: Buffer, signature: string | undefined) {
    const g = gateway();
    if (!signature) throw new AppError(400, 'INVALID_SIGNATURE', 'Invalid signature');
    let event: StripeEventLite;
    try {
      event = g.constructEvent(rawBody, signature);
    } catch {
      throw new AppError(400, 'INVALID_SIGNATURE', 'Invalid signature');
    }
    // Stripe is called before the transaction opens, never inside it. If this lookup fails, nothing
    // is recorded and Stripe's retry runs the whole event again.
    const obj = event.data.object;
    const charge: ChargeLite | null =
      event.type !== 'payment_intent.succeeded'
        ? null
        : obj.latest_charge
          ? await g.retrieveCharge(obj.latest_charge)
          : { id: '', receiptUrl: null, method: 'card' };
    return db.transaction(async (tx) => {
      const { pay } = repos(tx);
      if (!(await pay.recordEvent(event.id, event.type, event.data.object)))
        return { duplicate: true };
      switch (event.type) {
        case 'payment_intent.succeeded':
          await onSucceeded(tx, obj, charge as ChargeLite);
          break;
        case 'payment_intent.payment_failed':
          await onFailed(tx, obj, false);
          break;
        case 'payment_intent.canceled':
          await onFailed(tx, obj, true);
          break;
        case 'charge.refunded':
          await onRefunded(tx, obj);
          break;
        default:
          break; // recorded, nothing to do
      }
      await pay.markEventProcessed(event.id);
      return { duplicate: false };
    });
  }

  // ------------------------------------------------------------------ refunds
  async function refund(
    actor: Actor,
    paymentId: string,
    amountMinor?: number,
    requestKey?: string,
  ) {
    const g = gateway();
    const payment = await createPaymentRepository(db).get(actor.businessId, paymentId);
    if (!payment) throw notFound('Payment');
    if (payment.status !== 'successful' || !payment.stripePaymentIntentId) {
      throw new AppError(409, 'NOT_REFUNDABLE', 'Only successful payments can be refunded');
    }
    if (!isSupportedCurrency(payment.currency))
      throw new AppError(422, 'AMOUNT_UNSUPPORTED', 'Unsupported currency');
    // Ask Stripe what is already refunded or in flight: our refunded_minor only moves when the
    // charge.refunded webhook lands, so it misses refunds requested moments ago.
    const atStripe = await g.refundedAmount(payment.stripePaymentIntentId, requestKey).catch(() => {
      throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'Could not reach the payment provider');
    });
    const refunded = Math.max(
      payment.refundedMinor,
      fromStripeAmount(atStripe.others, payment.currency),
    );
    const remaining = payment.amountMinor - refunded;
    const amount = amountMinor ?? remaining;
    if (amount <= 0 || amount > remaining)
      throw new AppError(422, 'AMOUNT_TOO_HIGH', 'That is more than can be refunded');
    let stripeAmount: number;
    try {
      stripeAmount = toStripeAmount(amount, payment.currency);
    } catch (e) {
      if (e instanceof MoneyError) throw new AppError(422, 'AMOUNT_UNSUPPORTED', e.message);
      throw e;
    }
    // This request key already produced a refund (its response was lost). Only an exact retry may
    // replay it; a changed amount would otherwise be a second refund on top of the first.
    if (atStripe.mine !== null && atStripe.mine !== stripeAmount) {
      throw new AppError(
        409,
        'REFUND_ALREADY_ISSUED',
        `An earlier refund of ${money(fromStripeAmount(atStripe.mine, payment.currency), payment.currency)} from this request already went through`,
      );
    }
    try {
      // With a client key, a retry of the same request returns Stripe's original refund even if it
      // already went through. Without one, duplicates that see the same Stripe total share a key; a
      // later, deliberate refund sees the earlier one in that total and gets a new key.
      await g.createRefund(
        { paymentIntentId: payment.stripePaymentIntentId, amount: stripeAmount, requestKey },
        requestKey
          ? `refund:${payment.id}:${amount}:${requestKey}`
          : `refund:${payment.id}:${atStripe.others}:${amount}`,
      );
    } catch {
      throw new AppError(
        502,
        'PAYMENT_PROVIDER_ERROR',
        'The refund could not be issued. Please try again.',
      );
    }
    await createInvoiceRepository(db).addAudit({
      businessId: actor.businessId,
      userId: actor.userId,
      action: 'payment.refund_requested',
      entityId: payment.invoiceId,
      ip: actor.ip,
      metadata: { paymentId, amount },
    });
    // The payment and invoice update when Stripe confirms via the charge.refunded webhook.
    return { requested: amount };
  }

  return {
    connectStatus,
    connectOnboard,
    createIntent,
    handleWebhook,
    refund,
    list: (businessId: string, q: PaymentListQuery) =>
      createPaymentRepository(db).list(businessId, q),
    async get(businessId: string, id: string) {
      return (
        (await createPaymentRepository(db).get(businessId, id)) ??
        Promise.reject(notFound('Payment'))
      );
    },
    /** True if this business can currently take online payments (used by the pay page). */
    async onlinePaymentsEnabled(businessId: string) {
      if (!deps.gateway) return false;
      const acct = await businesses.getStripeAccount(businessId);
      return Boolean(acct?.accountId && acct.chargesEnabled);
    },
    publishableKey: () => config.STRIPE_PUBLISHABLE_KEY ?? null,
  };
}
export type PaymentService = ReturnType<typeof createPaymentService>;
