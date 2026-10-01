import type { Config } from '../config';

export interface EmailMessage {
  from: string;
  to: string;
  replyTo?: string | null;
  subject: string;
  text: string;
  html: string;
  attachments: Array<{ filename: string; content: Buffer }>;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export class EmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailError';
  }
}

export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

/** Sends through Resend's HTTP API (no SDK needed). */
export function createResendSender(apiKey: string, fetchImpl: typeof fetch = fetch): EmailSender {
  return {
    async send(m) {
      let res: Response;
      try {
        res = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: m.from,
            to: [m.to],
            reply_to: m.replyTo ?? undefined,
            subject: m.subject,
            text: m.text,
            html: m.html,
            attachments: m.attachments.map((a) => ({
              filename: a.filename,
              content: a.content.toString('base64'),
            })),
          }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new EmailError('Email provider unreachable');
      }
      if (!res.ok) throw new EmailError(`Email provider rejected the message (${res.status})`);
    },
  };
}

/** Development fallback: logs that a message would be sent (never the body or attachment). */
export function createLogEmailSender(log: (msg: string) => void = console.log): EmailSender {
  return { send: async (m) => log(`[email disabled] would send "${m.subject}" to ${m.to}`) };
}

export function createEmailSender(config: Config): EmailSender {
  return config.RESEND_API_KEY ? createResendSender(config.RESEND_API_KEY) : createLogEmailSender();
}

/** Plain text + simple HTML (button to the pay page). The user's message is escaped. */
export function buildInvoiceEmail(opts: {
  message: string;
  /** Omit for documents with no public page (estimates): no button, just the attachment. */
  payUrl?: string | null;
  businessName: string;
  documentName?: 'invoice' | 'estimate';
  /** Label of the link button / text line. */
  linkLabel?: string;
}) {
  const label = opts.linkLabel ?? 'View invoice';
  const doc = opts.documentName ?? 'invoice';
  const paragraphs = opts.message
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const button = opts.payUrl
    ? `<p style="margin:24px 0"><a href="${escapeHtml(opts.payUrl)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">${escapeHtml(label)}</a></p>\n`
    : '';
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#f5f7fa;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;font-size:16px;line-height:1.5">
${paragraphs}
${button}<p style="margin:0;color:#64748b;font-size:13px">Sent by ${escapeHtml(opts.businessName)} using InvoiceFlow. The ${doc} PDF is attached.</p>
</div></body></html>`;
  const text = opts.payUrl
    ? `${opts.message}\n\n${label} online: ${opts.payUrl}\n`
    : `${opts.message}\n`;
  return { html, text };
}
