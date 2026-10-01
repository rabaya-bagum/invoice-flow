import { defaultInvoiceEmail, type SendInvoiceInput } from '@invoiceflow/shared';
import type { Config } from '../config';
import type { Database } from '../db';
import { renderInvoicePdf, type PdfInput } from '../pdf/invoice-pdf';
import type { BusinessProfile, BusinessRepository } from '../repositories/business-repository';
import { createInvoiceRepository, type CustomerPrint } from '../repositories/invoice-repository';
import { AppError, notFound } from '../utils/errors';
import { makeToken, newSalt, parseToken, verifyToken } from '../utils/public-token';
import { sniffImage, type AssetStorage } from './asset-storage';
import { buildInvoiceEmail, type EmailSender } from './email';
import type { Actor, InvoiceDto, InvoiceService } from './invoice-service';

export type AssetKind = 'logo' | 'signature';
export const MAX_ASSET_BYTES = 1_000_000;

interface Deps {
  db: Database;
  invoices: InvoiceService;
  businesses: BusinessRepository;
  assets: AssetStorage;
  email: EmailSender;
  config: Pick<Config, 'PUBLIC_APP_URL' | 'EMAIL_FROM'> & { linkSecret: string };
  renderPdf?: (input: PdfInput) => Promise<Buffer>;
}

export interface LoadedDocument {
  invoice: InvoiceDto;
  business: BusinessProfile;
  customer: CustomerPrint;
  logo: Buffer | null;
  signature: Buffer | null;
}

const SENDABLE = ['draft', 'sent', 'viewed', 'partially_paid'];
export const PAYABLE = ['sent', 'viewed', 'partially_paid'];

export function createDocumentService(deps: Deps) {
  const { db, invoices, businesses, assets, email, config } = deps;
  const render = deps.renderPdf ?? renderInvoicePdf;
  const repo = (q: Pick<Database, 'query'> = db) => createInvoiceRepository(q);
  const assetKey = (businessId: string, kind: AssetKind) => `${businessId}/${kind}`;
  const payUrl = (token: string) => `${config.PUBLIC_APP_URL.replace(/\/$/, '')}/pay/${token}`;

  async function loadAsset(business: BusinessProfile, kind: AssetKind) {
    const path = kind === 'logo' ? business.logoPath : business.signaturePath;
    if (!path) return null;
    try {
      return (await assets.get(path))?.bytes ?? null;
    } catch {
      return null; // a storage hiccup must not stop an invoice from rendering
    }
  }

  async function loadForBusiness(businessId: string, id: string): Promise<LoadedDocument> {
    const invoice = await invoices.get(businessId, id);
    const business = await businesses.get(businessId);
    const customer = await repo().customerForPrint(businessId, invoice.customerId);
    if (!business || !customer) throw notFound('Invoice');
    const [logo, signature] = await Promise.all([
      loadAsset(business, 'logo'),
      loadAsset(business, 'signature'),
    ]);
    return { invoice, business, customer, logo, signature };
  }

  const toPdfInput = (d: LoadedDocument, url: string | null): PdfInput => ({
    invoice: d.invoice,
    business: d.business,
    customer: d.customer,
    logo: d.logo,
    signature: d.signature,
    payUrl: url,
  });

  async function shareToken(businessId: string, id: string) {
    const salt = await repo().ensureShareSalt(businessId, id, newSalt());
    if (!salt) throw notFound('Invoice');
    return makeToken(config.linkSecret, id, salt);
  }

  return {
    load: loadForBusiness,

    // ---------------------------------------------------------------- owner actions
    async pdf(businessId: string, id: string) {
      const doc = await loadForBusiness(businessId, id);
      const sharing = PAYABLE.includes(doc.invoice.status)
        ? payUrl(await shareToken(businessId, id))
        : null;
      try {
        return { number: doc.invoice.number, bytes: await render(toPdfInput(doc, sharing)) };
      } catch {
        throw new AppError(500, 'PDF_FAILED', 'The PDF could not be generated');
      }
    },

    async shareLink(businessId: string, id: string) {
      await invoices.get(businessId, id); // 404 if not theirs
      const token = await shareToken(businessId, id);
      return { url: payUrl(token) };
    },

    async revokeShareLink(actor: Actor, id: string) {
      await invoices.get(actor.businessId, id);
      await repo().clearShareSalt(actor.businessId, id);
      await repo().addAudit({
        businessId: actor.businessId,
        userId: actor.userId,
        action: 'invoice.share_revoked',
        entityId: id,
        ip: actor.ip,
      });
    },

    async send(actor: Actor, id: string, input: SendInvoiceInput) {
      const doc = await loadForBusiness(actor.businessId, id);
      const inv = doc.invoice;
      if (!SENDABLE.includes(inv.status)) {
        throw new AppError(
          409,
          'INVOICE_NOT_SENDABLE',
          `A ${inv.status.replace('_', ' ')} invoice cannot be sent`,
        );
      }
      const to = input.to ?? inv.customerEmail;
      if (!to)
        throw new AppError(
          422,
          'NO_RECIPIENT',
          'Add an email address for this customer or enter one to send to',
        );

      const url = payUrl(await shareToken(actor.businessId, id));
      const defaults = defaultInvoiceEmail({
        businessName: doc.business.name,
        customerName: doc.customer.name,
        invoiceNumber: inv.number,
        totalMinor: inv.totalMinor,
        currency: inv.currency,
        dueDate: inv.dueDate,
      });
      const subject = input.subject ?? defaults.subject;
      const message = input.message ?? defaults.message;

      let bytes: Buffer;
      try {
        bytes = await render(toPdfInput(doc, url));
      } catch {
        throw new AppError(500, 'PDF_FAILED', 'The PDF could not be generated');
      }
      const { html, text } = buildInvoiceEmail({
        message,
        payUrl: url,
        businessName: doc.business.name,
      });
      try {
        await email.send({
          from: config.EMAIL_FROM,
          to,
          replyTo: doc.business.email,
          subject,
          text,
          html,
          attachments: [{ filename: `${inv.number}.pdf`, content: bytes }],
        });
      } catch {
        // The invoice is NOT marked as sent when delivery failed.
        throw new AppError(502, 'EMAIL_FAILED', 'The invoice could not be sent');
      }

      await db.transaction(async (tx) => {
        const r = repo(tx);
        const current = await r.lock(actor.businessId, id);
        if (current?.status === 'draft') await r.setStatus(actor.businessId, id, 'sent');
        await r.addActivity(actor.businessId, id, 'sent', `Sent to ${to}`, { to });
        await r.addAudit({
          businessId: actor.businessId,
          userId: actor.userId,
          action: 'invoice.send',
          entityId: id,
          ip: actor.ip,
          metadata: { to },
        });
      });
      return { invoice: await invoices.get(actor.businessId, id), sentTo: to };
    },

    // ---------------------------------------------------------------- logo / signature
    async putAsset(actor: Actor, kind: AssetKind, bytes: Buffer) {
      if (bytes.length === 0 || bytes.length > MAX_ASSET_BYTES) {
        throw new AppError(413, 'IMAGE_TOO_LARGE', 'Choose an image under 1 MB');
      }
      const type = sniffImage(bytes);
      if (!type) throw new AppError(415, 'IMAGE_TYPE', 'Use a PNG or JPEG image');
      const key = assetKey(actor.businessId, kind);
      await assets.put(key, bytes, type);
      await businesses.setAssetPath(actor.businessId, kind, key);
    },

    async getAsset(businessId: string, kind: AssetKind) {
      const business = await businesses.get(businessId);
      const path = kind === 'logo' ? business?.logoPath : business?.signaturePath;
      const asset = path ? await assets.get(path) : null;
      if (!asset) throw notFound('Image');
      return asset;
    },

    async removeAsset(actor: Actor, kind: AssetKind) {
      const key = assetKey(actor.businessId, kind);
      await businesses.setAssetPath(actor.businessId, kind, null);
      await assets.remove(key).catch(() => undefined);
    },

    // ---------------------------------------------------------------- public (token) access
    /** Verifies a share token. Any problem is the same "not found" so links can't be probed. */
    async resolve(token: string): Promise<{ businessId: string; invoiceId: string } | null> {
      const parsed = parseToken(token);
      if (!parsed) return null;
      const found = await repo().publicLookup(parsed.invoiceId);
      if (!found?.salt || !verifyToken(config.linkSecret, parsed.invoiceId, found.salt, parsed.mac))
        return null;
      return { businessId: found.businessId, invoiceId: parsed.invoiceId };
    },

    async publicView(token: string) {
      const ref = await this.resolve(token);
      if (!ref) return null;
      const doc = await loadForBusiness(ref.businessId, ref.invoiceId);
      if (doc.invoice.status === 'draft') return null; // drafts are never public
      return {
        ...doc,
        payable: PAYABLE.includes(doc.invoice.status) && doc.invoice.balanceDueMinor > 0,
      };
    },

    async publicPdf(token: string) {
      const view = await this.publicView(token);
      if (!view) return null;
      try {
        return {
          number: view.invoice.number,
          bytes: await render(toPdfInput(view, view.payable ? payUrl(token) : null)),
        };
      } catch {
        throw new AppError(500, 'PDF_FAILED', 'The PDF could not be generated');
      }
    },

    /** Called by the pay page's script after it renders (link-preview crawlers don't run it). */
    async recordView(token: string): Promise<boolean> {
      const ref = await this.resolve(token);
      if (!ref) return false;
      return db.transaction(async (tx) => {
        const r = repo(tx);
        const changed = await r.markViewed(ref.businessId, ref.invoiceId);
        if (changed)
          await r.addActivity(
            ref.businessId,
            ref.invoiceId,
            'viewed',
            'Invoice viewed by customer',
          );
        return changed;
      });
    },
  };
}
export type DocumentService = ReturnType<typeof createDocumentService>;
