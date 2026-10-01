import { randomBytes } from 'node:crypto';
import { sendInvoiceInputSchema } from '@invoiceflow/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { renderEstimatePage } from '../public/estimate-page';
import { payPageCsp, renderPayPage } from '../public/pay-page';
import type { AssetKind, DocumentService } from '../services/document-service';
import type { PaymentService } from '../services/payment-service';
import { AppError, notFound } from '../utils/errors';
import { businessId, idParam } from '../utils/http';

const safeName = (n: string) => n.replace(/[^A-Za-z0-9._-]+/g, '_');

function actor(req: Request) {
  return { businessId: businessId(req), userId: req.user?.id as string, ip: req.ip };
}

function sendPdf(res: Response, number: string, bytes: Buffer) {
  res
    .status(200)
    .set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${safeName(number)}.pdf"`,
      'Cache-Control': 'private, no-store',
    })
    .end(bytes);
}

export function createDocumentController(svc: DocumentService) {
  const kindOf = (req: Request): AssetKind => {
    if (req.params.kind !== 'logo' && req.params.kind !== 'signature') throw notFound();
    return req.params.kind;
  };
  return {
    async pdf(req: Request, res: Response) {
      const { number, bytes } = await svc.pdf(businessId(req), idParam(req));
      sendPdf(res, number, bytes);
    },
    async estimatePdf(req: Request, res: Response) {
      const { number, bytes } = await svc.estimatePdf(businessId(req), idParam(req));
      sendPdf(res, number, bytes);
    },
    estimateShareLink: async (req: Request, res: Response) =>
      void res.json(await svc.estimateShareLink(businessId(req), idParam(req))),
    async estimateRevokeShareLink(req: Request, res: Response) {
      await svc.estimateRevokeShareLink(actor(req), idParam(req));
      res.status(204).end();
    },
    async estimateSend(req: Request, res: Response) {
      res.json(
        await svc.estimateSend(
          actor(req),
          idParam(req),
          sendInvoiceInputSchema.parse(req.body ?? {}),
        ),
      );
    },
    async send(req: Request, res: Response) {
      res.json(
        await svc.send(actor(req), idParam(req), sendInvoiceInputSchema.parse(req.body ?? {})),
      );
    },
    shareLink: async (req: Request, res: Response) =>
      void res.json(await svc.shareLink(businessId(req), idParam(req))),
    async revokeShareLink(req: Request, res: Response) {
      await svc.revokeShareLink(actor(req), idParam(req));
      res.status(204).end();
    },

    async putAsset(req: Request, res: Response) {
      if (!Buffer.isBuffer(req.body))
        throw new AppError(415, 'IMAGE_TYPE', 'Use a PNG or JPEG image');
      await svc.putAsset(actor(req), kindOf(req), req.body);
      res.status(204).end();
    },
    async getAsset(req: Request, res: Response) {
      const a = await svc.getAsset(businessId(req), kindOf(req));
      res.set({ 'Content-Type': a.contentType, 'Cache-Control': 'private, no-store' }).end(a.bytes);
    },
    async removeAsset(req: Request, res: Response) {
      await svc.removeAsset(actor(req), kindOf(req));
      res.status(204).end();
    },
  };
}

/** Unauthenticated, token-gated customer access. Every failure is an identical 404. */
export function createPublicController(svc: DocumentService, payments: PaymentService) {
  const noStore = (res: Response) =>
    res.set({
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    });
  const token = (req: Request) => String(req.params.token ?? '');

  return {
    async json(req: Request, res: Response) {
      const v = await svc.publicView(token(req));
      if (!v) throw notFound();
      const { invoice: inv, business: b, customer: c } = v;
      noStore(res).json({
        number: inv.number,
        status: inv.status,
        displayStatus: inv.displayStatus,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        currency: inv.currency,
        taxInclusive: inv.taxInclusive,
        notes: inv.notes,
        terms: inv.terms,
        subtotalMinor: inv.subtotalMinor,
        discountTotalMinor: inv.discountTotalMinor,
        taxBreakdown: inv.taxBreakdown,
        feesMinor: inv.feesMinor,
        totalMinor: inv.totalMinor,
        amountPaidMinor: inv.amountPaidMinor,
        balanceDueMinor: inv.balanceDueMinor,
        payable: v.payable,
        onlinePayments:
          v.payable &&
          Boolean(payments.publishableKey()) &&
          (await payments.onlinePaymentsEnabled(b.id)),
        items: inv.items.map((i) => ({
          description: i.description,
          quantityMilli: i.quantityMilli,
          unitPriceMinor: i.unitPriceMinor,
          taxes: i.taxes,
          lineTotalMinor: i.lineTotalMinor,
        })),
        business: {
          name: b.name,
          email: b.email,
          phone: b.phone,
          website: b.website,
          taxNumber: b.taxNumber,
          accentColor: b.accentColor,
          paymentInstructions: b.paymentInstructions,
        },
        customer: { name: c.name },
      });
    },

    async pdf(req: Request, res: Response) {
      const out = await svc.publicPdf(token(req));
      if (!out) throw notFound();
      noStore(res);
      sendPdf(res, out.number, out.bytes);
    },

    async view(req: Request, res: Response) {
      await svc.recordView(token(req));
      noStore(res).status(204).end(); // same response whether or not the token was valid
    },

    async page(req: Request, res: Response) {
      const v = await svc.publicView(token(req));
      if (!v) {
        noStore(res)
          .status(404)
          .type('html')
          .send(
            '<!doctype html><meta charset="utf-8"><title>Not found</title><p style="font-family:sans-serif;padding:24px">This invoice link is not valid.</p>',
          );
        return;
      }
      const nonce = randomBytes(16).toString('base64');
      const logo = v.logo
        ? `data:${v.logo[0] === 0x89 ? 'image/png' : 'image/jpeg'};base64,${v.logo.toString('base64')}`
        : null;
      const key = payments.publishableKey();
      const stripe =
        v.payable && key && (await payments.onlinePaymentsEnabled(v.business.id))
          ? { publishableKey: key }
          : null;
      noStore(res)
        .set('Content-Security-Policy', payPageCsp(nonce, Boolean(stripe)))
        .type('html')
        .send(renderPayPage(v, { token: token(req), nonce, logoDataUri: logo, stripe }));
    },
  };
}

const respondSchema = z.object({
  decision: z.enum(['accept', 'decline']),
  name: z
    .string()
    .trim()
    .max(100)
    .optional()
    .transform((v) => v || null),
});

/** Unauthenticated, token-gated estimate access. Every bad link is an identical 404. */
export function createPublicEstimateController(svc: DocumentService) {
  const noStore = (res: Response) =>
    res.set({
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    });
  const token = (req: Request) => String(req.params.token ?? '');
  return {
    async json(req: Request, res: Response) {
      const v = await svc.estimatePublicView(token(req));
      if (!v) throw notFound();
      const { estimate: e, business: b, customer: c } = v;
      noStore(res).json({
        number: e.number,
        status: e.status,
        displayStatus: e.displayStatus,
        issueDate: e.issueDate,
        expiryDate: e.expiryDate,
        currency: e.currency,
        taxInclusive: e.taxInclusive,
        notes: e.notes,
        terms: e.terms,
        subtotalMinor: e.subtotalMinor,
        discountTotalMinor: e.discountTotalMinor,
        taxBreakdown: e.taxBreakdown,
        feesMinor: e.feesMinor,
        totalMinor: e.totalMinor,
        respondable: v.respondable,
        decidedAt: e.decidedAt,
        items: e.items.map((i) => ({
          description: i.description,
          quantityMilli: i.quantityMilli,
          unitPriceMinor: i.unitPriceMinor,
          taxes: i.taxes,
          lineTotalMinor: i.lineTotalMinor,
        })),
        business: {
          name: b.name,
          email: b.email,
          phone: b.phone,
          website: b.website,
          accentColor: b.accentColor,
        },
        customer: { name: c.name },
      });
    },
    async pdf(req: Request, res: Response) {
      const out = await svc.estimatePublicPdf(token(req));
      if (!out) throw notFound();
      noStore(res);
      sendPdf(res, out.number, out.bytes);
    },
    async view(req: Request, res: Response) {
      await svc.estimateRecordView(token(req));
      noStore(res).status(204).end(); // same response whether or not the token was valid
    },
    async respond(req: Request, res: Response) {
      const body = respondSchema.parse(req.body ?? {});
      const out = await svc.estimateRespond(
        token(req),
        body.decision === 'accept' ? 'accepted' : 'rejected',
        body.name,
        req.ip,
      );
      if (!out) throw notFound();
      noStore(res).json({ status: out.status, decidedAt: out.decidedAt });
    },
    async page(req: Request, res: Response) {
      const v = await svc.estimatePublicView(token(req));
      if (!v) {
        noStore(res)
          .status(404)
          .type('html')
          .send(
            '<!doctype html><meta charset="utf-8"><title>Not found</title><p style="font-family:sans-serif;padding:24px">This estimate link is not valid.</p>',
          );
        return;
      }
      const nonce = randomBytes(16).toString('base64');
      const logo = v.logo
        ? `data:${v.logo[0] === 0x89 ? 'image/png' : 'image/jpeg'};base64,${v.logo.toString('base64')}`
        : null;
      noStore(res)
        .set('Content-Security-Policy', payPageCsp(nonce, false))
        .type('html')
        .send(renderEstimatePage(v, { token: token(req), nonce, logoDataUri: logo }));
    },
  };
}
