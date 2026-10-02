import {
  formatMoney,
  isSupportedCurrency,
  paymentIntentInputSchema,
  paymentListQuerySchema,
  refundInputSchema,
} from '@invoiceflow/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { PaymentService } from '../services/payment-service';
import { businessId, idParam } from '../utils/http';

function actor(req: Request) {
  return { businessId: businessId(req), userId: req.user?.id as string, ip: req.ip };
}

const ownerIntentBody = paymentIntentInputSchema.extend({ invoiceId: z.string().uuid() });

export function createPaymentController(svc: PaymentService) {
  return {
    async list(req: Request, res: Response) {
      const { items, total } = await svc.list(
        businessId(req),
        paymentListQuerySchema.parse(req.query),
      );
      res.json({ items, total });
    },
    get: async (req: Request, res: Response) =>
      void res.json(await svc.get(businessId(req), idParam(req))),

    async refund(req: Request, res: Response) {
      const { amountMinor } = refundInputSchema.parse(req.body ?? {});
      // Optional client key: the app reuses it when retrying a refund that may have gone through.
      const key = req.get('Idempotency-Key');
      const requestKey = key && /^[A-Za-z0-9_-]{8,64}$/.test(key) ? key : undefined;
      res.status(202).json(await svc.refund(actor(req), idParam(req), amountMinor, requestKey));
    },

    /** POST /v1/payments/create-intent: for the signed-in owner (e.g. collecting in person). */
    async createIntent(req: Request, res: Response) {
      const body = ownerIntentBody.parse(req.body);
      const r = await svc.createIntent({
        businessId: businessId(req),
        invoiceId: body.invoiceId,
        amountMinor: body.amountMinor,
      });
      res.status(201).json({ ...r, publishableKey: svc.publishableKey() });
    },

    connectStatus: async (req: Request, res: Response) =>
      void res.json(await svc.connectStatus(businessId(req))),
    connectOnboard: async (req: Request, res: Response) =>
      void res.json(await svc.connectOnboard(actor(req))),
  };
}

/** Stripe -> us. Needs the RAW body for signature verification (mounted before express.json). */
export function createWebhookHandler(
  svc: PaymentService,
  afterCommit: () => void = () => undefined,
) {
  return async (req: Request, res: Response) => {
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const out = await svc.handleWebhook(raw, req.header('stripe-signature'));
    if (!out.duplicate) afterCommit(); // push the owner notification right away
    res.json({ received: true, duplicate: out.duplicate });
  };
}

/** Public (token-gated) payment start for the customer pay page. */
export function createPublicPaymentHandler(
  resolve: (token: string) => Promise<{ businessId: string; invoiceId: string } | null>,
  svc: PaymentService,
) {
  return async (req: Request, res: Response) => {
    const token = String(req.params.token ?? '');
    const ref = await resolve(token);
    if (!ref) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
      return;
    }
    const { amountMinor } = paymentIntentInputSchema.parse(req.body ?? {});
    const r = await svc.createIntent({
      businessId: ref.businessId,
      invoiceId: ref.invoiceId,
      amountMinor,
    });
    res.set('Cache-Control', 'no-store').json({
      clientSecret: r.clientSecret,
      amountMinor: r.amountMinor,
      currency: r.currency,
      amountLabel: isSupportedCurrency(r.currency)
        ? formatMoney(r.amountMinor, r.currency)
        : String(r.amountMinor),
    });
  };
}

const returnPage = (
  title: string,
  deepLink: string,
) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="refresh" content="0; url=${deepLink}">
<title>${title}</title></head><body style="font-family:system-ui,sans-serif;padding:24px">
<p>${title}</p><p><a href="${deepLink}">Return to InvoiceFlow</a></p></body></html>`;

/** Landing pages Stripe redirects to after onboarding; they hand control back to the app. */
export const stripeReturnHandlers = {
  done: (_req: Request, res: Response) => {
    res
      .set({ 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'" })
      .type('html')
      .send(returnPage('Payout setup updated.', 'invoiceflow://stripe/return'));
  },
  refresh: (_req: Request, res: Response) => {
    res
      .set({ 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'" })
      .type('html')
      .send(returnPage('That setup link expired.', 'invoiceflow://stripe/refresh'));
  },
};
