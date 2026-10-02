import { sniffImage } from '../src/services/asset-storage';
import {
  buildInvoiceEmail,
  createResendSender,
  EmailError,
  escapeHtml,
} from '../src/services/email';
import { redactRequest, redactTokenUrl } from '../src/utils/log-redaction';
import { makeToken, newSalt, parseToken, verifyToken } from '../src/utils/public-token';
import { TINY_PNG } from './helpers';

const SECRET = 's'.repeat(40);
const ID = '11111111-1111-4111-8111-111111111111';

describe('public tokens', () => {
  it('round-trips and verifies', () => {
    const salt = newSalt();
    const token = makeToken(SECRET, ID, salt);
    const parsed = parseToken(token)!;
    expect(parsed.invoiceId).toBe(ID);
    expect(verifyToken(SECRET, parsed.invoiceId, salt, parsed.mac)).toBe(true);
  });
  it('fails with a different secret, salt, or invoice id', () => {
    const salt = newSalt();
    const { mac } = parseToken(makeToken(SECRET, ID, salt))!;
    expect(verifyToken('t'.repeat(40), ID, salt, mac)).toBe(false);
    expect(verifyToken(SECRET, ID, newSalt(), mac)).toBe(false);
    expect(verifyToken(SECRET, '22222222-2222-4222-8222-222222222222', salt, mac)).toBe(false);
    expect(verifyToken(SECRET, ID, salt, 'short')).toBe(false);
  });
  it('rejects malformed tokens', () => {
    for (const t of [
      '',
      'x',
      `${ID}`,
      `${ID}.`,
      `${ID}.short`,
      `not-a-uuid.${'A'.repeat(43)}`,
      `${ID}.${'A'.repeat(43)}.x`,
      `${ID}.${'!'.repeat(43)}`,
    ]) {
      expect(parseToken(t)).toBeNull();
    }
  });
  it('produces unique salts and tokens', () => {
    expect(newSalt()).not.toBe(newSalt());
    expect(makeToken(SECRET, ID, 'a')).not.toBe(makeToken(SECRET, ID, 'b'));
  });
});

describe('resend sender', () => {
  const msg = {
    from: 'A <a@x.co>',
    to: 'b@y.co',
    replyTo: 'r@x.co',
    subject: 'Hi',
    text: 't',
    html: '<p>t</p>',
    attachments: [{ filename: 'INV-1.pdf', content: Buffer.from('%PDF-1.4 hello') }],
  };
  it('posts the message with a base64 attachment and bearer auth', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const sender = createResendSender('re_key', (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return { ok: true, status: 200 } as Response;
    }) as unknown as typeof fetch);
    await sender.send(msg);
    expect(seen!.url).toBe('https://api.resend.com/emails');
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe('Bearer re_key');
    const body = JSON.parse(seen!.init.body as string);
    expect(body).toMatchObject({
      from: 'A <a@x.co>',
      to: ['b@y.co'],
      reply_to: 'r@x.co',
      subject: 'Hi',
    });
    expect(Buffer.from(body.attachments[0].content, 'base64').toString()).toBe('%PDF-1.4 hello');
  });
  it('maps provider errors and network failures to EmailError without leaking details', async () => {
    const rejected = createResendSender(
      'k',
      (async () => ({ ok: false, status: 422 }) as Response) as unknown as typeof fetch,
    );
    await expect(rejected.send(msg)).rejects.toBeInstanceOf(EmailError);
    const down = createResendSender('k', (async () => {
      throw new Error('ECONNRESET secret-host');
    }) as unknown as typeof fetch);
    await expect(down.send(msg)).rejects.toThrow('Email provider unreachable');
  });
});

describe('email body', () => {
  it('escapes the message and link in HTML', () => {
    const { html, text } = buildInvoiceEmail({
      message: 'a <b>x</b>\n\nsecond',
      payUrl: 'https://x.co/pay/a?b=1&c="2"',
      businessName: 'A&B <Co>',
    });
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('a &lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('A&amp;B &lt;Co&gt;');
    expect(html).toContain('href="https://x.co/pay/a?b=1&amp;c=&quot;2&quot;"');
    expect(text).toContain('View invoice online: https://x.co/pay/a?b=1&c="2"');
  });
  it('escapes all five dangerous characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

describe('image sniffing', () => {
  it('recognises PNG and JPEG by content, not name', () => {
    expect(sniffImage(TINY_PNG)).toBe('image/png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
  });
  it('rejects everything else', () => {
    expect(sniffImage(Buffer.from('<svg/>'))).toBeNull();
    expect(sniffImage(Buffer.from('GIF89a......'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
    expect(sniffImage(Buffer.from('%PDF-1.4'))).toBeNull();
  });
});

describe('database pool', () => {
  it('bounds how long a query, a transaction and a connection wait can last', async () => {
    const { createPool } = await import('../src/db');
    const pool = createPool('postgresql://u:p@localhost:5432/x');
    const o = pool.options as unknown as Record<string, unknown>;
    expect(o.statement_timeout).toBe(20_000);
    expect(o.idle_in_transaction_session_timeout).toBe(30_000);
    expect(o.connectionTimeoutMillis).toBe(5_000);
    await pool.end();
  });
});

describe('request log redaction', () => {
  it.each([
    ['/pay/abc.def', '/pay/[redacted]'],
    ['/public/invoices/abc.def', '/public/invoices/[redacted]'],
    ['/public/invoices/abc.def/pdf?download=1', '/public/invoices/[redacted]/pdf?download=1'],
    ['/public/invoices/abc.def/view', '/public/invoices/[redacted]/view'],
    ['/estimate/abc.def', '/estimate/[redacted]'],
    ['/public/estimates/abc.def/pdf', '/public/estimates/[redacted]/pdf'],
    // Express matches routes case-insensitively, so these reach the token handlers too.
    ['/PAY/abc.def', '/PAY/[redacted]'],
    ['/Public/Invoices/abc.def/pdf', '/Public/Invoices/[redacted]/pdf'],
  ])('masks the share token in %s', (url, expected) => {
    expect(redactTokenUrl(url)).toBe(expected);
  });

  it('leaves other routes alone', () => {
    for (const url of ['/v1/invoices/123', '/health', '/stripe/connect/return', '/payments/x'])
      expect(redactTokenUrl(url)).toBe(url);
  });

  it('masks url and params.token on the logged request', () => {
    const out = redactRequest({ url: '/pay/abc.def', params: { token: 'abc.def' }, method: 'GET' });
    expect(out).toEqual({ url: '/pay/[redacted]', params: { token: '[redacted]' }, method: 'GET' });
    expect(JSON.stringify(out)).not.toContain('abc.def');
  });
});
