import { randomBytes } from 'node:crypto';
import { sendInvoiceInputSchema } from '@invoiceflow/shared';
import type { Request, Response } from 'express';
import { renderPayPage } from '../public/pay-page';
import type { AssetKind, DocumentService } from '../services/document-service';
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
export function createPublicController(svc: DocumentService) {
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
      noStore(res)
        .set(
          'Content-Security-Policy',
          `default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`,
        )
        .type('html')
        .send(renderPayPage(v, { token: token(req), nonce, logoDataUri: logo }));
    },
  };
}
