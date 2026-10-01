import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { makeToken, newSalt } from '../src/utils/public-token';
import { buildDbApp, closePool, createUser, pdfText, TINY_PNG } from './helpers';

type Ctx = Awaited<ReturnType<typeof buildDbApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await buildDbApp();
});
afterAll(closePool);

async function account(c: Ctx = ctx) {
  const user = await createUser();
  const auth = await c.bearer(user.id);
  const call = (m: 'get' | 'post' | 'put' | 'delete', url: string) =>
    request(c.app)[m](url).set('Authorization', auth);
  const customer = async (body: object = { companyName: 'Acme Ltd', email: 'billing@acme.test' }) =>
    (await call('post', '/v1/customers').send(body)).body.id as string;
  const invoice = async (over: object = {}, customerId?: string) =>
    (
      await call('post', '/v1/invoices').send({
        customerId: customerId ?? (await customer()),
        issueDate: '2026-10-01',
        dueDate: '2026-10-15',
        currency: 'USD',
        items: [
          {
            description: 'Web Development',
            quantityMilli: 10_000,
            unitPriceMinor: 10_000,
            taxes: [{ name: 'GST', rateBps: 500 }],
          },
        ],
        ...over,
      })
    ).body as { id: string; number: string; totalMinor: number };
  return { user, auth, call, customer, invoice };
}

const tokenOf = (url: string) => url.replace('https://api.test/pay/', '');

describe('PDF', () => {
  it('generates a PDF for the owner with the right headers and content', async () => {
    const a = await account();
    const inv = await a.invoice();
    const res = await a
      .call('post', `/v1/invoices/${inv.id}/pdf`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${inv.number}.pdf"`);
    expect(res.headers['cache-control']).toContain('no-store');
    const { text } = await pdfText(res.body);
    expect(text).toContain(inv.number);
    expect(text).toContain('Acme Ltd');
    expect(text).toContain('$1,050.00');
  });

  it('sanitises the filename of odd invoice numbers', async () => {
    const a = await account();
    const inv = await a.invoice({ number: 'A/B C.1' });
    const res = await a.call('post', `/v1/invoices/${inv.id}/pdf`);
    expect(res.headers['content-disposition']).toBe('attachment; filename="A_B_C.1.pdf"');
  });

  it('requires login and refuses other accounts', async () => {
    const a = await account();
    const b = await account();
    const inv = await a.invoice();
    expect((await request(ctx.app).post(`/v1/invoices/${inv.id}/pdf`)).status).toBe(401);
    expect((await b.call('post', `/v1/invoices/${inv.id}/pdf`)).status).toBe(404);
  });
});

describe('logo and signature', () => {
  const put = (
    a: Awaited<ReturnType<typeof account>>,
    kind: string,
    body: Buffer,
    type = 'image/png',
  ) => a.call('put', `/v1/business/${kind}`).set('Content-Type', type).send(body);

  it('uploads, serves, uses in the PDF, and removes images', async () => {
    const a = await account();
    expect((await put(a, 'logo', TINY_PNG)).status).toBe(204);
    expect((await put(a, 'signature', TINY_PNG)).status).toBe(204);
    const got = await a
      .call('get', '/v1/business/logo')
      .buffer(true)
      .parse((r, cb) => {
        const c: Buffer[] = [];
        r.on('data', (d: Buffer) => c.push(d));
        r.on('end', () => cb(null, Buffer.concat(c)));
      });
    expect(got.headers['content-type']).toBe('image/png');
    expect(Buffer.compare(got.body, TINY_PNG)).toBe(0);
    expect((await a.call('get', '/v1/business')).body.logoPath).toMatch(/\/logo$/);

    expect((await a.call('delete', '/v1/business/logo')).status).toBe(204);
    expect((await a.call('get', '/v1/business/logo')).status).toBe(404);
    expect((await a.call('get', '/v1/business')).body.logoPath).toBeNull();
  });

  it('rejects non-images, wrong types, SVG and oversize files', async () => {
    const a = await account();
    const notImage = await put(a, 'logo', Buffer.from('<html>not an image</html>'));
    expect(notImage.status).toBe(415);
    expect(notImage.body.error.code).toBe('IMAGE_TYPE');
    expect(
      (
        await put(
          a,
          'logo',
          Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
          'image/svg+xml',
        )
      ).status,
    ).toBe(415);
    expect((await put(a, 'logo', Buffer.from('{}'), 'application/json')).status).toBe(415);
    const big = Buffer.concat([TINY_PNG, Buffer.alloc(1_100_000)]);
    expect((await put(a, 'logo', big)).status).toBe(413);
    expect((await put(a, 'nonsense', TINY_PNG)).status).toBe(404);
    expect(ctx.assets.size()).toBeGreaterThanOrEqual(0);
  });

  it("keeps each business's images separate", async () => {
    const a = await account();
    const b = await account();
    await put(a, 'logo', TINY_PNG);
    expect((await b.call('get', '/v1/business/logo')).status).toBe(404);
  });
});

describe('sending', () => {
  it('emails the PDF to the customer, marks a draft as sent and records it', async () => {
    const a = await account();
    await a.call('put', '/v1/business').send({ name: 'Acme Studio', email: 'owner@acme.test' });
    const inv = await a.invoice();
    const before = ctx.email.sent.length;
    const res = await a.call('post', `/v1/invoices/${inv.id}/send`).send({});
    expect(res.status).toBe(200);
    expect(res.body.sentTo).toBe('billing@acme.test');
    expect(res.body.invoice).toMatchObject({ status: 'sent', displayStatus: 'sent' });
    expect(res.body.invoice.sentAt).not.toBeNull();

    const mail = ctx.email.sent[before]!;
    expect(mail.to).toBe('billing@acme.test');
    expect(mail.replyTo).toBe('owner@acme.test');
    expect(mail.from).toBe('Test <noreply@test.dev>');
    expect(mail.subject).toBe(`Invoice ${inv.number} from Acme Studio`);
    expect(mail.text).toContain(`Please find attached invoice ${inv.number} for $1,050.00.`);
    expect(mail.text).toContain('Payment is due on October 15, 2026.');
    expect(mail.text).toMatch(/https:\/\/api\.test\/pay\/[0-9a-f-]{36}\.[\w-]{43}/);
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0]!.filename).toBe(`${inv.number}.pdf`);
    expect(mail.attachments[0]!.content.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await pdfText(mail.attachments[0]!.content)).text).toContain(inv.number);

    const activity = (await a.call('get', `/v1/invoices/${inv.id}/activity`)).body.items;
    expect(activity.map((x: { type: string }) => x.type)).toEqual(['created', 'sent']);
    expect(activity[1].message).toBe('Sent to billing@acme.test');
    const audit = await ctx.db.query(
      "SELECT action FROM audit_logs WHERE entity_id = $1 AND action = 'invoice.send'",
      [inv.id],
    );
    expect(audit.rowCount).toBe(1);
  });

  it('uses a custom recipient, subject and message, and escapes the HTML version', async () => {
    const a = await account();
    const inv = await a.invoice();
    const before = ctx.email.sent.length;
    await a.call('post', `/v1/invoices/${inv.id}/send`).send({
      to: 'Other@Example.com',
      subject: 'Custom subject',
      message: 'Hello <script>alert(1)</script> & welcome\n\nSecond paragraph',
    });
    const mail = ctx.email.sent[before]!;
    expect(mail.to).toBe('other@example.com');
    expect(mail.subject).toBe('Custom subject');
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; welcome');
    expect(mail.html).toContain('Second paragraph');
    expect(mail.text).toContain('Hello <script>alert(1)</script> & welcome'); // plain text is literal
  });

  it('needs a recipient and a valid address', async () => {
    const a = await account();
    const cid = await a.customer({ firstName: 'No', lastName: 'Email' });
    const inv = await a.invoice({}, cid);
    const none = await a.call('post', `/v1/invoices/${inv.id}/send`).send({});
    expect(none.status).toBe(422);
    expect(none.body.error.code).toBe('NO_RECIPIENT');
    expect(
      (await a.call('post', `/v1/invoices/${inv.id}/send`).send({ to: 'not-an-email' })).status,
    ).toBe(400);
    expect((await a.call('get', `/v1/invoices/${inv.id}`)).body.status).toBe('draft');
    const ok = await a.call('post', `/v1/invoices/${inv.id}/send`).send({ to: 'manual@x.co' });
    expect(ok.status).toBe(200);
  });

  it('does NOT mark the invoice sent when email delivery fails', async () => {
    const a = await account();
    const inv = await a.invoice();
    ctx.email.fail = true;
    try {
      const res = await a.call('post', `/v1/invoices/${inv.id}/send`).send({});
      expect(res.status).toBe(502);
      expect(res.body.error).toEqual({
        code: 'EMAIL_FAILED',
        message: 'The invoice could not be sent',
      });
      expect(JSON.stringify(res.body)).not.toContain('provider down');
    } finally {
      ctx.email.fail = false;
    }
    expect((await a.call('get', `/v1/invoices/${inv.id}`)).body.status).toBe('draft');
    expect((await a.call('get', `/v1/invoices/${inv.id}/activity`)).body.items).toHaveLength(1);
  });

  it('can resend a sent invoice but not a cancelled or paid one', async () => {
    const a = await account();
    const inv = await a.invoice();
    await a.call('post', `/v1/invoices/${inv.id}/send`).send({});
    const again = await a.call('post', `/v1/invoices/${inv.id}/send`).send({});
    expect(again.status).toBe(200);
    expect(again.body.invoice.status).toBe('sent');

    const cancelled = await a.invoice();
    await a.call('post', `/v1/invoices/${cancelled.id}/transition`).send({ to: 'cancelled' });
    const res = await a.call('post', `/v1/invoices/${cancelled.id}/send`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVOICE_NOT_SENDABLE');

    const paid = await a.invoice();
    await ctx.db.query(
      "UPDATE invoices SET status = 'paid', amount_paid_minor = total_minor WHERE id = $1",
      [paid.id],
    );
    expect((await a.call('post', `/v1/invoices/${paid.id}/send`).send({})).status).toBe(409);
  });

  it("refuses another account's invoice", async () => {
    const a = await account();
    const b = await account();
    const inv = await a.invoice();
    const before = ctx.email.sent.length;
    expect((await b.call('post', `/v1/invoices/${inv.id}/send`).send({})).status).toBe(404);
    expect(ctx.email.sent.length).toBe(before);
  });

  it('rate-limits sending per user', async () => {
    const c = await buildDbApp({ SEND_RATE_LIMIT_PER_10_MIN: '2' });
    const a = await account(c);
    const inv = await a.invoice();
    const send = () => a.call('post', `/v1/invoices/${inv.id}/send`).send({});
    expect([(await send()).status, (await send()).status, (await send()).status]).toEqual([
      200, 200, 429,
    ]);
    // A different user is not affected
    const other = await account(c);
    expect(
      (await other.call('post', `/v1/invoices/${(await other.invoice()).id}/send`).send({})).status,
    ).toBe(200);
  });
});

describe('share links and the public invoice', () => {
  it('creates a stable link, serves a sanitised invoice, and keeps drafts private', async () => {
    const a = await account();
    const inv = await a.invoice();
    const l1 = (await a.call('post', `/v1/invoices/${inv.id}/share-link`)).body.url as string;
    const l2 = (await a.call('post', `/v1/invoices/${inv.id}/share-link`)).body.url as string;
    expect(l1).toBe(l2);
    expect(l1).toMatch(/^https:\/\/api\.test\/pay\/[0-9a-f-]{36}\.[\w-]{43}$/);
    const token = tokenOf(l1);

    // Drafts are never public, even with a valid link.
    expect((await request(ctx.app).get(`/public/invoices/${token}`)).status).toBe(404);
    expect((await request(ctx.app).get(`/pay/${token}`)).status).toBe(404);

    await a.call('post', `/v1/invoices/${inv.id}/transition`).send({ to: 'sent' });
    const res = await request(ctx.app).get(`/public/invoices/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.body).toMatchObject({
      number: inv.number,
      totalMinor: 105_000,
      payable: true,
      customer: { name: 'Acme Ltd' },
    });
    // Nothing internal leaks
    const json = JSON.stringify(res.body);
    for (const secret of [
      inv.id,
      'billing@acme.test',
      'customerId',
      'businessId',
      'business_id',
      a.user.id,
    ]) {
      expect(json).not.toContain(secret);
    }
  });

  it('rejects forged, tampered, swapped and malformed tokens identically', async () => {
    const a = await account();
    const inv = await a.invoice();
    const other = await a.invoice();
    await a.call('post', `/v1/invoices/${inv.id}/transition`).send({ to: 'sent' });
    await a.call('post', `/v1/invoices/${other.id}/transition`).send({ to: 'sent' });
    const good = tokenOf((await a.call('post', `/v1/invoices/${inv.id}/share-link`)).body.url);
    const otherTok = tokenOf(
      (await a.call('post', `/v1/invoices/${other.id}/share-link`)).body.url,
    );
    const [id, mac] = good.split('.') as [string, string];
    const flipped = mac.slice(0, -1) + (mac.endsWith('A') ? 'B' : 'A');
    const forgedWithWrongSecret = makeToken('x'.repeat(32), inv.id, 'whatever');
    const candidates = [
      `${id}.${flipped}`, // tampered MAC
      `${id}.${otherTok.split('.')[1]}`, // MAC from another invoice
      forgedWithWrongSecret,
      `${randomUUID()}.${mac}`, // unknown invoice
      `${id}.`,
      id,
      'garbage',
      `${id}.${mac}.extra`,
      `${id.toUpperCase()}.${mac}x`,
    ];
    for (const t of candidates) {
      const r = await request(ctx.app).get(`/public/invoices/${encodeURIComponent(t)}`);
      expect(r.status).toBe(404);
      expect(r.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
    }
    expect((await request(ctx.app).get(`/public/invoices/${good}`)).status).toBe(200);
  });

  it('a link with a salt that has not been issued does not work', async () => {
    const a = await account();
    const inv = await a.invoice();
    await a.call('post', `/v1/invoices/${inv.id}/transition`).send({ to: 'sent' });
    // Valid HMAC for a salt we never stored
    const forged = makeToken('test-secret-test-secret-test-secret-1234', inv.id, newSalt());
    expect((await request(ctx.app).get(`/public/invoices/${forged}`)).status).toBe(404);
  });

  it('revoking invalidates the link, and a new link is different', async () => {
    const a = await account();
    const inv = await a.invoice();
    await a.call('post', `/v1/invoices/${inv.id}/transition`).send({ to: 'sent' });
    const old = tokenOf((await a.call('post', `/v1/invoices/${inv.id}/share-link`)).body.url);
    expect((await request(ctx.app).get(`/public/invoices/${old}`)).status).toBe(200);
    expect((await a.call('delete', `/v1/invoices/${inv.id}/share-link`)).status).toBe(204);
    expect((await request(ctx.app).get(`/public/invoices/${old}`)).status).toBe(404);
    const fresh = tokenOf((await a.call('post', `/v1/invoices/${inv.id}/share-link`)).body.url);
    expect(fresh).not.toBe(old);
    expect((await request(ctx.app).get(`/public/invoices/${fresh}`)).status).toBe(200);
    expect((await request(ctx.app).get(`/public/invoices/${old}`)).status).toBe(404);
  });

  it("other accounts cannot create or revoke an invoice's link", async () => {
    const a = await account();
    const b = await account();
    const inv = await a.invoice();
    expect((await b.call('post', `/v1/invoices/${inv.id}/share-link`)).status).toBe(404);
    expect((await b.call('delete', `/v1/invoices/${inv.id}/share-link`)).status).toBe(404);
  });

  it('serves the PDF to the customer', async () => {
    const a = await account();
    const inv = await a.invoice();
    await a.call('post', `/v1/invoices/${inv.id}/send`).send({});
    const token = tokenOf((await a.call('post', `/v1/invoices/${inv.id}/share-link`)).body.url);
    const res = await request(ctx.app)
      .get(`/public/invoices/${token}/pdf`)
      .buffer(true)
      .parse((r, cb) => {
        const c: Buffer[] = [];
        r.on('data', (d: Buffer) => c.push(d));
        r.on('end', () => cb(null, Buffer.concat(c)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect((await pdfText(res.body)).text).toContain(inv.number);
  });

  it('rate-limits the public routes per IP', async () => {
    const c = await buildDbApp({ PUBLIC_RATE_LIMIT_PER_MINUTE: '3' });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++)
      statuses.push((await request(c.app).get('/public/invoices/garbage')).status);
    expect(statuses).toEqual([404, 404, 404, 429, 429]);
  });
});

describe('view tracking', () => {
  it('marks sent -> viewed once, only via the view call (not by fetching the page)', async () => {
    const a = await account();
    const inv = await a.invoice();
    await a.call('post', `/v1/invoices/${inv.id}/send`).send({});
    const token = tokenOf((await a.call('post', `/v1/invoices/${inv.id}/share-link`)).body.url);

    // Link-preview crawlers / prefetchers only GET: that must not count as a view.
    await request(ctx.app).get(`/pay/${token}`);
    await request(ctx.app).get(`/public/invoices/${token}`);
    expect((await a.call('get', `/v1/invoices/${inv.id}`)).body.status).toBe('sent');

    expect((await request(ctx.app).post(`/public/invoices/${token}/view`)).status).toBe(204);
    expect((await request(ctx.app).post(`/public/invoices/${token}/view`)).status).toBe(204);
    const after = (await a.call('get', `/v1/invoices/${inv.id}`)).body;
    expect(after.status).toBe('viewed');
    const types = (await a.call('get', `/v1/invoices/${inv.id}/activity`)).body.items.map(
      (x: { type: string }) => x.type,
    );
    expect(types).toEqual(['created', 'sent', 'viewed']); // exactly one "viewed"
  });

  it('does not change other statuses and ignores bad tokens', async () => {
    const a = await account();
    const inv = await a.invoice();
    await a.call('post', `/v1/invoices/${inv.id}/send`).send({});
    await ctx.db.query(
      "UPDATE invoices SET status = 'paid', amount_paid_minor = total_minor WHERE id = $1",
      [inv.id],
    );
    const token = tokenOf((await a.call('post', `/v1/invoices/${inv.id}/share-link`)).body.url);
    await request(ctx.app).post(`/public/invoices/${token}/view`);
    expect((await a.call('get', `/v1/invoices/${inv.id}`)).body.status).toBe('paid');
    const bad = await request(ctx.app).post('/public/invoices/not-a-token/view');
    expect(bad.status).toBe(204); // same answer: no oracle for valid tokens
  });
});

describe('pay page', () => {
  async function sentInvoice(a: Awaited<ReturnType<typeof account>>, over: object = {}) {
    const inv = await a.invoice(over);
    await a.call('post', `/v1/invoices/${inv.id}/send`).send({});
    const token = tokenOf((await a.call('post', `/v1/invoices/${inv.id}/share-link`)).body.url);
    return { inv, token };
  }

  it('renders the invoice with a strict nonce-based CSP', async () => {
    const a = await account();
    await a
      .call('put', '/v1/business')
      .send({ name: 'Acme Studio', paymentInstructions: 'E-transfer to pay@acme.test' });
    const { inv, token } = await sentInvoice(a);
    const res = await request(ctx.app).get(`/pay/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const csp = res.headers['content-security-policy'] as string;
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(res.text).toContain(`<script nonce="${nonce}">`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    for (const s of [
      `Invoice ${inv.number}`,
      'Acme Studio',
      'Web Development',
      '$1,050.00',
      'GST (5%)',
      'E-transfer to pay@acme.test',
      'Download PDF',
      'Awaiting payment',
    ]) {
      expect(res.text).toContain(s);
    }
    // No inline event handlers anywhere
    expect(res.text).not.toMatch(/\son\w+=/i);
    // A fresh nonce on every response
    const again = await request(ctx.app).get(`/pay/${token}`);
    expect(/nonce-([^']+)'/.exec(again.headers['content-security-policy'] as string)?.[1]).not.toBe(
      nonce,
    );
  });

  it('escapes hostile content from every user-controlled field', async () => {
    const a = await account();
    const xss = '<img src=x onerror=alert(1)>';
    await a
      .call('put', '/v1/business')
      .send({ name: `"><script>alert(1)</script>${xss}`, accentColor: '#112233' });
    const cid = await a.customer({ companyName: xss, email: 'x@y.co' });
    const { token } = await sentInvoice(a, {
      customerId: cid,
      notes: `${xss}<b>`,
      terms: '</p><script>alert(2)</script>',
      items: [
        {
          description: xss,
          quantityMilli: 1000,
          unitPriceMinor: 100,
          taxes: [{ name: '<b>GST</b>', rateBps: 500 }],
        },
      ],
    });
    const res = await request(ctx.app).get(`/pay/${token}`);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<script>alert');
    expect(res.text).not.toContain('<img src=x');
    expect(res.text).not.toContain('<b>GST</b>');
    expect(res.text).toContain('&lt;img src=x onerror=alert(1)&gt;');
    // The only script tag is ours
    expect((res.text.match(/<script/g) ?? []).length).toBe(1);
  });

  it('shows status correctly: no pay section once paid, cancelled labelled', async () => {
    const a = await account();
    const paid = await sentInvoice(a);
    await ctx.db.query(
      "UPDATE invoices SET status = 'paid', amount_paid_minor = total_minor WHERE id = $1",
      [paid.inv.id],
    );
    const p = await request(ctx.app).get(`/pay/${paid.token}`);
    expect(p.text).toContain('Paid');
    expect(p.text).not.toContain('Pay this invoice');

    const cancelled = await sentInvoice(a);
    await a.call('post', `/v1/invoices/${cancelled.inv.id}/transition`).send({ to: 'cancelled' });
    const c = await request(ctx.app).get(`/pay/${cancelled.token}`);
    expect(c.text).toContain('Cancelled');
    expect(c.text).not.toContain('Pay this invoice');
  });

  it('returns a plain 404 page for a bad link, and embeds the logo as a data URI', async () => {
    const bad = await request(ctx.app).get('/pay/nope');
    expect(bad.status).toBe(404);
    expect(bad.text).toContain('not valid');
    const a = await account();
    await a.call('put', '/v1/business/logo').set('Content-Type', 'image/png').send(TINY_PNG);
    const { token } = await sentInvoice(a);
    const res = await request(ctx.app).get(`/pay/${token}`);
    expect(res.text).toContain('src="data:image/png;base64,');
  });
});
