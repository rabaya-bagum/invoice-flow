import { addDays, todayInTimezone } from '@invoiceflow/shared';
import request from 'supertest';
import { buildDbApp, closePool, createUser, pdfText } from './helpers';

type Ctx = Awaited<ReturnType<typeof buildDbApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await buildDbApp();
});
afterAll(closePool);

const today = () => todayInTimezone('UTC');
const tokenOf = (url: string) => url.replace('https://api.test/estimate/', '');

async function account(c: Ctx = ctx) {
  const user = await createUser();
  const auth = await c.bearer(user.id);
  const call = (m: 'get' | 'post' | 'put' | 'delete', url: string) =>
    request(c.app)[m](url).set('Authorization', auth);
  const customerId = (
    await call('post', '/v1/customers').send({
      companyName: 'Acme Ltd',
      email: 'billing@acme.test',
    })
  ).body.id as string;
  const estimate = async (over: object = {}) =>
    (
      await call('post', '/v1/estimates').send({
        customerId,
        issueDate: today(),
        expiryDate: addDays(today(), 30),
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
    ).body as { id: string; number: string };
  /** A sent estimate with a live link. */
  const shared = async (over: object = {}) => {
    const e = await estimate(over);
    await call('post', `/v1/estimates/${e.id}/transition`).send({ to: 'sent' });
    const { url } = (await call('post', `/v1/estimates/${e.id}/share-link`)).body;
    return { e, url: url as string, token: tokenOf(url) };
  };
  const get = async (id: string) => (await call('get', `/v1/estimates/${id}`)).body;
  const notes = async (type: string) =>
    (
      await ctx.db.query('SELECT * FROM notifications WHERE business_id = $1 AND type = $2', [
        user.businessId,
        type,
      ])
    ).rows;
  return { user, auth, call, customerId, estimate, shared, get, notes };
}

const respond = (token: string, body: object, c: Ctx = ctx) =>
  request(c.app).post(`/public/estimates/${token}/respond`).send(body);

describe('estimate share links', () => {
  it('creates a stable link and keeps drafts private', async () => {
    const a = await account();
    const e = await a.estimate();
    const first = (await a.call('post', `/v1/estimates/${e.id}/share-link`)).body.url as string;
    const second = (await a.call('post', `/v1/estimates/${e.id}/share-link`)).body.url as string;
    expect(first).toMatch(/^https:\/\/api\.test\/estimate\/[0-9a-f-]{36}\.[\w-]{43}$/);
    expect(second).toBe(first);
    // Still a draft: nothing is served, page or JSON.
    expect((await request(ctx.app).get(`/public/estimates/${tokenOf(first)}`)).status).toBe(404);
    expect((await request(ctx.app).get(`/estimate/${tokenOf(first)}`)).status).toBe(404);
    await a.call('post', `/v1/estimates/${e.id}/transition`).send({ to: 'sent' });
    expect((await request(ctx.app).get(`/public/estimates/${tokenOf(first)}`)).status).toBe(200);
  });

  it('serves a sanitised estimate', async () => {
    const a = await account();
    await a.call('put', '/v1/business').send({ name: 'Acme Studio', email: 'owner@acme.test' });
    const { token } = await a.shared({ notes: 'Thank you' });
    const res = await request(ctx.app).get(`/public/estimates/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toContain('noindex');
    expect(res.body).toMatchObject({
      status: 'sent',
      totalMinor: 105_000,
      respondable: true,
      customer: { name: 'Acme Ltd' },
      business: { name: 'Acme Studio' },
    });
    const json = JSON.stringify(res.body);
    expect(json).not.toContain('businessId');
    expect(json).not.toContain('public_token');
    expect(json).not.toContain('customerEmail');
  });

  it('rejects forged, swapped, malformed and invoice-family tokens identically', async () => {
    const a = await account();
    const b = await account();
    const one = await a.shared();
    const two = await b.shared();
    const [id, mac] = one.token.split('.') as [string, string];
    const bad = [
      'garbage',
      `${id}.${'A'.repeat(43)}`,
      `${id}.${two.token.split('.')[1]}`, // MAC from another estimate
      `${two.token.split('.')[0]}.${mac}`,
      `${id}.${mac}.extra`,
      `${id.toUpperCase().replace(/-/g, '')}.${mac}`,
    ];
    for (const t of bad) {
      const res = await request(ctx.app).get(`/public/estimates/${encodeURIComponent(t)}`);
      expect([t, res.status]).toEqual([t, 404]);
      expect((await respond(t, { decision: 'accept' })).status).toBe(404);
    }
    // An INVOICE link's MAC can never open an estimate (and the reverse).
    const inv = (
      await a.call('post', '/v1/invoices').send({
        customerId: a.customerId,
        issueDate: today(),
        dueDate: addDays(today(), 14),
        currency: 'USD',
        items: [{ description: 'x', quantityMilli: 1000, unitPriceMinor: 100, taxes: [] }],
      })
    ).body;
    await a.call('post', `/v1/invoices/${inv.id}/transition`).send({ to: 'sent' });
    const invLink = (await a.call('post', `/v1/invoices/${inv.id}/share-link`)).body.url as string;
    const invToken = invLink.replace('https://api.test/pay/', '');
    expect((await request(ctx.app).get(`/public/estimates/${invToken}`)).status).toBe(404);
    expect((await request(ctx.app).get(`/public/invoices/${one.token}`)).status).toBe(404);
  });

  it('revoking stops the link; a new link differs', async () => {
    const a = await account();
    const { e, token } = await a.shared();
    expect((await a.call('delete', `/v1/estimates/${e.id}/share-link`)).status).toBe(204);
    expect((await request(ctx.app).get(`/public/estimates/${token}`)).status).toBe(404);
    expect((await respond(token, { decision: 'accept' })).status).toBe(404);
    const fresh = tokenOf((await a.call('post', `/v1/estimates/${e.id}/share-link`)).body.url);
    expect(fresh).not.toBe(token);
    expect((await request(ctx.app).get(`/public/estimates/${fresh}`)).status).toBe(200);
  });

  it("other accounts cannot create or revoke an estimate's link", async () => {
    const a = await account();
    const b = await account();
    const { e, token } = await a.shared();
    expect((await b.call('post', `/v1/estimates/${e.id}/share-link`)).status).toBe(404);
    expect((await b.call('delete', `/v1/estimates/${e.id}/share-link`)).status).toBe(404);
    expect((await request(ctx.app).get(`/public/estimates/${token}`)).status).toBe(200);
  });

  it('serves the PDF to the customer', async () => {
    const a = await account();
    const { e, token } = await a.shared();
    const res = await request(ctx.app)
      .get(`/public/estimates/${token}/pdf`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${e.number}.pdf"`);
    expect((await pdfText(res.body)).text).toContain('ESTIMATE');
    expect((await request(ctx.app).get('/public/estimates/garbage/pdf')).status).toBe(404);
  });
});

describe('estimate page', () => {
  it('renders with a strict CSP and no inline handlers, with the response buttons', async () => {
    const a = await account();
    const { e, token } = await a.shared({ notes: 'Be nice' });
    const res = await request(ctx.app).get(`/estimate/${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    const csp = res.headers['content-security-policy'] as string;
    const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(res.text).toContain(`<script nonce="${nonce}">`);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain('stripe');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain(`Estimate ${e.number}`);
    expect(res.text).toContain('$1,050.00');
    expect(res.text).toContain('Accept estimate');
    expect(res.text).toContain('Decline');
    expect(res.text).not.toMatch(/\son(click|load|error)=/i);
    expect(res.text).not.toContain('Balance due');
    expect(res.text).not.toContain('Pay this invoice');
  });

  it('escapes hostile content', async () => {
    const a = await account();
    const evil = '<script>alert(1)</script>"><img src=x onerror=alert(2)>';
    await a.call('put', '/v1/business').send({ name: evil });
    const cust = (await a.call('post', '/v1/customers').send({ companyName: evil })).body.id;
    const { token } = await a.shared({
      customerId: cust,
      notes: evil,
      items: [{ description: evil, quantityMilli: 1000, unitPriceMinor: 100, taxes: [] }],
    });
    const res = await request(ctx.app).get(`/estimate/${token}`);
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).not.toContain('<img src=x');
    expect(res.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('shows the decision, expiry and conversion states instead of the buttons', async () => {
    const a = await account();
    const acc = await a.shared();
    await respond(acc.token, { decision: 'accept', name: 'Ann Lee' });
    const accepted = await request(ctx.app).get(`/estimate/${acc.token}`);
    expect(accepted.text).toContain('This estimate was accepted by Ann Lee');
    expect(accepted.text).not.toContain('Accept estimate');

    const exp = await a.shared({ expiryDate: addDays(today(), -2) });
    const expired = await request(ctx.app).get(`/estimate/${exp.token}`);
    expect(expired.text).toContain('This estimate expired on');
    expect(expired.text).not.toContain('Accept estimate');

    const conv = await a.shared();
    await a.call('post', `/v1/estimates/${conv.e.id}/convert`);
    const converted = await request(ctx.app).get(`/estimate/${conv.token}`);
    expect(converted.text).toContain('has turned this estimate into an invoice');
    expect(converted.text).not.toContain('Accept estimate');
  });

  it('returns a plain 404 page for a bad link', async () => {
    const res = await request(ctx.app).get('/estimate/nope');
    expect(res.status).toBe(404);
    expect(res.text).toContain('not valid');
  });
});

describe('view tracking', () => {
  it('marks sent -> viewed once, only via the view call, and notifies the owner once', async () => {
    const a = await account();
    const { e, token } = await a.shared();
    await request(ctx.app).get(`/estimate/${token}`); // fetching the page alone (a link preview) changes nothing
    expect((await a.get(e.id)).status).toBe('sent');
    expect((await request(ctx.app).post(`/public/estimates/${token}/view`)).status).toBe(204);
    expect((await request(ctx.app).post(`/public/estimates/${token}/view`)).status).toBe(204);
    const after = await a.get(e.id);
    expect(after.status).toBe('viewed');
    expect(after.viewedAt).not.toBeNull();
    const notes = await a.notes('estimate_viewed');
    expect(notes).toHaveLength(1);
    expect(notes[0].data).toEqual({ estimateId: e.id });
    expect((await request(ctx.app).post('/public/estimates/garbage/view')).status).toBe(204);
  });

  it('does not change a decided estimate', async () => {
    const a = await account();
    const { e, token } = await a.shared();
    await respond(token, { decision: 'accept' });
    await request(ctx.app).post(`/public/estimates/${token}/view`);
    expect((await a.get(e.id)).status).toBe('accepted');
  });
});

describe('customer response', () => {
  it('accepts, records who and when, and notifies the owner', async () => {
    const a = await account();
    const { e, token } = await a.shared();
    const res = await respond(token, { decision: 'accept', name: '  Ann Lee  ' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');
    const est = await a.get(e.id);
    expect(est).toMatchObject({ status: 'accepted', decidedByName: 'Ann Lee', editable: false });
    expect(est.decidedAt).not.toBeNull();
    const notes = await a.notes('estimate_accepted');
    expect(notes).toHaveLength(1);
    expect(notes[0].body).toBe(`Ann Lee accepted estimate ${e.number}.`);
    const audit = await ctx.db.query(
      "SELECT user_id, metadata FROM audit_logs WHERE entity_id = $1 AND action = 'estimate.accepted_by_customer'",
      [e.id],
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].user_id).toBeNull();
    expect(audit.rows[0].metadata).toEqual({ name: 'Ann Lee' });
    // Acceptance does not convert on its own, but the owner may now convert.
    expect(est.convertedInvoiceId).toBeNull();
    expect(est.convertible).toBe(true);
  });

  it('declines, falling back to the customer name when none is typed', async () => {
    const a = await account();
    const { e, token } = await a.shared();
    expect((await respond(token, { decision: 'decline' })).body.status).toBe('rejected');
    const est = await a.get(e.id);
    expect(est).toMatchObject({ status: 'rejected', decidedByName: null, convertible: false });
    const notes = await a.notes('estimate_declined');
    expect(notes[0].body).toBe(`Acme Ltd declined estimate ${e.number}.`);
  });

  it('works from the viewed state too', async () => {
    const a = await account();
    const { e, token } = await a.shared();
    await request(ctx.app).post(`/public/estimates/${token}/view`);
    expect((await respond(token, { decision: 'accept' })).status).toBe(200);
    expect((await a.get(e.id)).status).toBe('accepted');
  });

  it('is idempotent for the same answer and refuses the opposite one', async () => {
    const a = await account();
    const { e, token } = await a.shared();
    expect((await respond(token, { decision: 'accept', name: 'Ann' })).status).toBe(200);
    expect((await respond(token, { decision: 'accept', name: 'Someone else' })).status).toBe(200);
    const est = await a.get(e.id);
    expect(est.decidedByName).toBe('Ann'); // the first answer stands
    expect(await a.notes('estimate_accepted')).toHaveLength(1);
    const flip = await respond(token, { decision: 'decline' });
    expect(flip.status).toBe(409);
    expect(flip.body.error.code).toBe('ALREADY_DECIDED');
    expect((await a.get(e.id)).status).toBe('accepted');
  });

  it('records one answer when two arrive at once', async () => {
    const a = await account();
    const { e, token } = await a.shared();
    const out = await Promise.all([
      respond(token, { decision: 'accept' }),
      respond(token, { decision: 'decline' }),
      respond(token, { decision: 'accept' }),
    ]);
    const final = (await a.get(e.id)).status;
    expect(['accepted', 'rejected']).toContain(final);
    for (const r of out) expect([200, 409]).toContain(r.status);
    expect(out.some((r) => r.status === 200)).toBe(true);
    const notes =
      (await a.notes('estimate_accepted')).length + (await a.notes('estimate_declined')).length;
    expect(notes).toBe(1);
  });

  it('refuses an expired or converted estimate', async () => {
    const a = await account();
    const old = await a.shared({ expiryDate: addDays(today(), -1) });
    const expired = await respond(old.token, { decision: 'accept' });
    expect(expired.status).toBe(409);
    expect(expired.body.error.code).toBe('ESTIMATE_EXPIRED');
    expect((await a.get(old.e.id)).status).toBe('sent');

    const conv = await a.shared();
    await a.call('post', `/v1/estimates/${conv.e.id}/convert`);
    const res = await respond(conv.token, { decision: 'accept' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_CONVERTED');
  });

  it('respects a decision the owner already recorded', async () => {
    const a = await account();
    const { e, token } = await a.shared();
    await a.call('post', `/v1/estimates/${e.id}/transition`).send({ to: 'rejected' });
    expect((await respond(token, { decision: 'accept' })).status).toBe(409);
    expect((await a.get(e.id)).status).toBe('rejected');
  });

  it('validates the body', async () => {
    const a = await account();
    const { token } = await a.shared();
    expect((await respond(token, {})).status).toBe(400);
    expect((await respond(token, { decision: 'maybe' })).status).toBe(400);
    expect((await respond(token, { decision: 'accept', name: 'x'.repeat(101) })).status).toBe(400);
    expect((await respond(token, { decision: 'accept', name: 42 })).status).toBe(400);
    const big = await request(ctx.app)
      .post(`/public/estimates/${token}/respond`)
      .send({ decision: 'accept', name: 'x'.repeat(5000) });
    expect(big.status).toBeGreaterThanOrEqual(400);
    expect(big.status).toBeLessThan(500);
  });

  it('rate-limits answers per IP', async () => {
    const c = await buildDbApp({ RESPOND_RATE_LIMIT_PER_MINUTE: '3' });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++)
      statuses.push((await respond('garbage', { decision: 'accept' }, c)).status);
    expect(statuses).toEqual([404, 404, 404, 429, 429]);
  });
});

describe('sending with a link', () => {
  it('puts the estimate link in the email', async () => {
    const a = await account();
    const e = await a.estimate();
    const before = ctx.email.sent.length;
    await a.call('post', `/v1/estimates/${e.id}/send`).send({});
    const mail = ctx.email.sent[before]!;
    expect(mail.text).toMatch(
      /View estimate online: https:\/\/api\.test\/estimate\/[0-9a-f-]{36}\.[\w-]{43}/,
    );
    expect(mail.html).toContain('View estimate</a>');
    expect(mail.html).not.toContain('View invoice');
    const link = /https:\/\/api\.test\/estimate\/([\w.-]+)/.exec(mail.text)![1]!;
    expect((await request(ctx.app).get(`/public/estimates/${link}`)).status).toBe(200);
  });
});
