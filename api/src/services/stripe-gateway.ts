import Stripe from 'stripe';

/** Minimal event shape we rely on (the SDK's full union is far larger than we need). */
export interface StripeEventLite {
  id: string;
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: { object: any };
}

export class GatewayError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export interface PaymentIntentLite {
  id: string;
  clientSecret: string;
  status: string;
}

export interface ChargeLite {
  id: string;
  receiptUrl: string | null;
  method: 'card' | 'apple_pay' | 'google_pay' | 'other';
}

/**
 * Everything the app needs from Stripe, behind one interface so the payment logic can be tested
 * without network access. Amounts here are already in Stripe's units.
 */
export interface StripeGateway {
  createExpressAccount(input: {
    email: string | null;
    name: string;
    country: string | null;
    businessId: string;
  }): Promise<{ id: string }>;
  createAccountLink(
    accountId: string,
    returnUrl: string,
    refreshUrl: string,
  ): Promise<{ url: string }>;
  retrieveAccount(accountId: string): Promise<{
    chargesEnabled: boolean;
    payoutsEnabled: boolean;
    detailsSubmitted: boolean;
    requirementsDue: string[];
  }>;
  createPaymentIntent(
    p: {
      amount: number;
      currency: string;
      destination: string;
      applicationFee: number;
      receiptEmail: string | null;
      description: string;
      metadata: Record<string, string>;
    },
    idempotencyKey: string,
  ): Promise<PaymentIntentLite>;
  retrievePaymentIntent(id: string): Promise<PaymentIntentLite>;
  cancelPaymentIntent(id: string): Promise<void>;
  retrieveCharge(id: string): Promise<ChargeLite>;
  createRefund(
    p: { paymentIntentId: string; amount: number; requestKey?: string },
    idempotencyKey: string,
  ): Promise<{ id: string; status: string }>;
  /**
   * Sum (Stripe units) of refunds on the intent that are done or still in flight, leaving out any
   * created by `excludeRequestKey` (so a retried request is not blocked by its own earlier refund).
   */
  refundedAmount(paymentIntentId: string, excludeRequestKey?: string): Promise<number>;
  /** Verifies the Stripe-Signature header against the raw body. Throws if invalid. */
  constructEvent(rawBody: Buffer, signature: string): StripeEventLite;
}

function wrap(err: unknown): never {
  const e = err as { code?: string; message?: string };
  throw new GatewayError(e.code ?? 'stripe_error', e.message ?? 'Stripe error');
}

export function createStripeGateway(secretKey: string, webhookSecret: string): StripeGateway {
  const stripe = new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 20_000 });
  const lite = (pi: Stripe.PaymentIntent): PaymentIntentLite => ({
    id: pi.id,
    clientSecret: pi.client_secret ?? '',
    status: pi.status,
  });

  return {
    async createExpressAccount(i) {
      try {
        const a = await stripe.accounts.create({
          type: 'express',
          email: i.email ?? undefined,
          country:
            i.country && /^[A-Za-z]{2}$/.test(i.country) ? i.country.toUpperCase() : undefined,
          business_profile: { name: i.name },
          capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
          metadata: { business_id: i.businessId },
        });
        return { id: a.id };
      } catch (e) {
        return wrap(e);
      }
    },

    async createAccountLink(accountId, returnUrl, refreshUrl) {
      try {
        const l = await stripe.accountLinks.create({
          account: accountId,
          type: 'account_onboarding',
          return_url: returnUrl,
          refresh_url: refreshUrl,
        });
        return { url: l.url };
      } catch (e) {
        return wrap(e);
      }
    },

    async retrieveAccount(accountId) {
      try {
        const a = await stripe.accounts.retrieve(accountId);
        return {
          chargesEnabled: Boolean(a.charges_enabled),
          payoutsEnabled: Boolean(a.payouts_enabled),
          detailsSubmitted: Boolean(a.details_submitted),
          requirementsDue: a.requirements?.currently_due ?? [],
        };
      } catch (e) {
        return wrap(e);
      }
    },

    async createPaymentIntent(p, idempotencyKey) {
      try {
        const pi = await stripe.paymentIntents.create(
          {
            amount: p.amount,
            currency: p.currency.toLowerCase(),
            automatic_payment_methods: { enabled: true },
            transfer_data: { destination: p.destination },
            on_behalf_of: p.destination,
            application_fee_amount: p.applicationFee > 0 ? p.applicationFee : undefined,
            receipt_email: p.receiptEmail ?? undefined,
            description: p.description,
            metadata: p.metadata,
          },
          { idempotencyKey },
        );
        return lite(pi);
      } catch (e) {
        return wrap(e);
      }
    },

    async retrievePaymentIntent(id) {
      try {
        return lite(await stripe.paymentIntents.retrieve(id));
      } catch (e) {
        return wrap(e);
      }
    },

    async cancelPaymentIntent(id) {
      try {
        await stripe.paymentIntents.cancel(id);
      } catch (e) {
        wrap(e);
      }
    },

    async retrieveCharge(id) {
      try {
        const c = await stripe.charges.retrieve(id);
        const d = c.payment_method_details;
        const wallet = d?.card?.wallet?.type;
        return {
          id: c.id,
          receiptUrl: c.receipt_url ?? null,
          method:
            wallet === 'apple_pay'
              ? 'apple_pay'
              : wallet === 'google_pay'
                ? 'google_pay'
                : d?.type === 'card'
                  ? 'card'
                  : 'other',
        };
      } catch (e) {
        return wrap(e);
      }
    },

    async createRefund(p, idempotencyKey) {
      try {
        const r = await stripe.refunds.create(
          {
            payment_intent: p.paymentIntentId,
            amount: p.amount,
            // Destination charge: take the money back from the freelancer's account, and refund
            // our platform fee proportionally.
            reverse_transfer: true,
            refund_application_fee: true,
            ...(p.requestKey ? { metadata: { request_key: p.requestKey } } : {}),
          },
          { idempotencyKey },
        );
        return { id: r.id, status: r.status ?? 'pending' };
      } catch (e) {
        return wrap(e);
      }
    },

    async refundedAmount(paymentIntentId, excludeRequestKey) {
      try {
        let total = 0;
        for await (const r of stripe.refunds.list({
          payment_intent: paymentIntentId,
          limit: 100,
        })) {
          if (r.status === 'failed' || r.status === 'canceled') continue;
          if (excludeRequestKey && r.metadata?.request_key === excludeRequestKey) continue;
          total += r.amount;
        }
        return total;
      } catch (e) {
        return wrap(e);
      }
    },

    constructEvent(rawBody, signature) {
      return stripe.webhooks.constructEvent(
        rawBody,
        signature,
        webhookSecret,
      ) as unknown as StripeEventLite;
    },
  };
}
