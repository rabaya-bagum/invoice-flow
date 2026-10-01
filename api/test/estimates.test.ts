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
const bin = (r: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on('data', (c: Buffer) => chunks.push(c));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function account() {
  const user = await createUser();
  const auth = await ctx.bearer(user.id);
  const call = (m: 'get' | 'post' | 'put' | 'delete', url: string) =>
    request(ctx.app)[m](url).set('Authorization', auth);
  const customerId = (
    await call('post', '/v1/customers').send({
      companyName: 'Acme Ltd',
      email: 'billing@acme.test',
    })
  ).body.id as string;
  const lines = [
    {
      description: 'Web Development',
      quantityMilli: 10_000,
      unitPriceMinor: 10_000,
      taxes: [{ name: 'GST', rateBps: 500 }],
    },
  ];
  const payload = (over: object = {}) => ({
    customerId,
    issueDate: today(),
    expiryDate: addDays(today(), 30),
    currency: 'USD',
    items: lines,
    ...over,
  });
  const estimate = async (over: object = {}) =>
    (await call('post', '/v1/estimates').send(payload(over))).body as {
      id: string;
      number: string;
      status: string;
      totalMinor: number;
    };
  const get = async (id: string) => (await call('get', `/v1/estimates/${id}`)).body;
  const move = (id: string, to: string) =>
    call('post', `/v1/estimates/${id}/transition`).send({ to });
  return { user, auth, call, customerId, lines, payload, estimate, get, move };
}

describe('creating estimates', () => {
  it('numbers EST-0001.. separately from invoices and computes totals on the server', async () => {
    const a = await account();
    const inv = (
      await a.call('post', '/v1/invoices').send({
        customerId: a.customerId,
        issueDate: today(),
        dueDate: addDays(today(), 14),
        currency: 'USD',
        items: a.lines,
      })
    ).body;
    const e1 = await a.estimate();
    const e2 = await a.estimate();
    expect(e1.number).toBe('EST-0001');
    expect(e2.number).toBe('EST-0002');
    expect(inv.number).toBe('INV-0001');
    const full = await a.get(e1.id);
    expect(full).toMatchObject({
      status: 'draft',
      displayStatus: 'draft',
      subtotalMinor: 100_000,
      taxTotalMinor: 5_000,
      totalMinor: inv.totalMinor,
      editable: true,
      convertible: true,
      convertedInvoiceId: null,
    });
    expect(full.items).toHaveLength(1);
    expect(full.taxBreakdown).toEqual([
      { name: 'GST', rateBps: 500, taxableAmount: 100_000, tax: 5_000 },
    ]);
  });

  it('ignores client-supplied totals, status and ownership', async () => {
    const a = await account();
    const other = await account();
    const e = (
      await a
        .call('post', '/v1/estimates')
        .send(a.payload({ status: 'accepted', totalMinor: 1, businessId: other.user.businessId }))
    ).body;
    expect(e).toMatchObject({ status: 'draft', totalMinor: 105_000 });
    const row = await ctx.db.query('SELECT business_id FROM estimates WHERE id = $1', [e.id]);
    expect(row.rows[0].business_id).toBe(a.user.businessId);
  });

  it('validates input', async () => {
    const a = await account();
    const post = (over: object) => a.call('post', '/v1/estimates').send(a.payload(over));
    expect((await post({ expiryDate: undefined })).status).toBe(400);
    expect((await post({ expiryDate: '2026-13-40' })).status).toBe(400);
    expect((await post({ items: [] })).status).toBe(400);
    expect((await post({ customerId: '00000000-0000-4000-8000-000000000000' })).status).toBe(422);
    expect((await post({ number: 'EST-0007' })).status).toBe(201);
    const dup = await post({ number: 'EST-0007' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('NUMBER_EXISTS');
  });
});

describe('listing and filtering', () => {
  it('filters by status, customer and search, with derived expiry', async () => {
    const a = await account();
    const draft = await a.estimate();
    const sent = await a.estimate();
    await a.move(sent.id, 'sent');
    const stale = await a.estimate({ expiryDate: addDays(today(), -3) });
    await a.move(stale.id, 'sent');
    const accepted = await a.estimate();
    await a.move(accepted.id, 'sent');
    await a.move(accepted.id, 'accepted');

    const ids = async (qs: string) =>
      ((await a.call('get', `/v1/estimates${qs}`)).body.items as { id: string }[]).map((i) => i.id);
    expect(await ids('')).toHaveLength(4);
    expect(await ids('?status=draft')).toEqual([draft.id]);
    expect(await ids('?status=sent')).toEqual([sent.id]);
    expect(await ids('?status=expired')).toEqual([stale.id]);
    expect(await ids('?status=accepted')).toEqual([accepted.id]);
    expect((await a.call('get', '/v1/estimates?search=Acme')).body.total).toBe(4);
    expect((await a.call('get', '/v1/estimates?search=nobody')).body.total).toBe(0);
    expect((await a.call('get', `/v1/estimates?search=${draft.number}`)).body.total).toBe(1);
    expect((await a.call('get', '/v1/estimates?search=1050')).body.total).toBe(4);
    expect((await a.call('get', `/v1/estimates?customerId=${a.customerId}`)).body.total).toBe(4);
    expect((await a.call('get', '/v1/estimates?limit=2&offset=3')).body.items).toHaveLength(1);
    expect((await a.call('get', '/v1/estimates?status=bogus')).status).toBe(400);
    const listed = (await a.call('get', '/v1/estimates?status=expired')).body.items[0];
    expect(listed).toMatchObject({ status: 'sent', displayStatus: 'expired' });
  });
});

describe('editing and status', () => {
  it('edits a live estimate and bumps the version, rejecting stale versions', async () => {
    const a = await account();
    const e = await a.estimate();
    const before = await a.get(e.id);
    const res = await a
      .call('put', `/v1/estimates/${e.id}`)
      .send(
        a.payload({ items: [{ ...a.lines[0], unitPriceMinor: 20_000 }], version: before.version }),
      );
    expect(res.status).toBe(200);
    expect(res.body.totalMinor).toBe(210_000);
    expect(res.body.version).toBe(before.version + 1);
    const stale = await a
      .call('put', `/v1/estimates/${e.id}`)
      .send(a.payload({ version: before.version }));
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('follows the status rules', async () => {
    const a = await account();
    const e = await a.estimate();
    expect((await a.move(e.id, 'accepted')).status).toBe(409); // not sent yet
    expect((await a.move(e.id, 'sent')).body.status).toBe('sent');
    expect((await a.move(e.id, 'sent')).status).toBe(409);
    expect((await a.move(e.id, 'viewed')).status).toBe(400); // tracked, not chosen
    expect((await a.move(e.id, 'accepted')).body.status).toBe('accepted');
    expect((await a.move(e.id, 'rejected')).status).toBe(409);
    const locked = await a.call('put', `/v1/estimates/${e.id}`).send(a.payload());
    expect(locked.status).toBe(409);
    expect(locked.body.error.code).toBe('ESTIMATE_LOCKED');
    expect((await a.get(e.id)).editable).toBe(false);
  });

  it('deletes drafts only', async () => {
    const a = await account();
    const d = await a.estimate();
    const s = await a.estimate();
    await a.move(s.id, 'sent');
    expect((await a.call('delete', `/v1/estimates/${s.id}`)).status).toBe(409);
    expect((await a.call('delete', `/v1/estimates/${d.id}`)).status).toBe(204);
    expect((await a.call('get', `/v1/estimates/${d.id}`)).status).toBe(404);
  });
});

describe('converting to an invoice', () => {
  it('creates a draft invoice with the same lines, dated today, and locks the estimate', async () => {
    const a = await account();
    await a.call('put', '/v1/business').send({ defaultPaymentTermsDays: 10 });
    const e = await a.estimate({
      discount: { type: 'percent', value: 1000 },
      feesMinor: 500,
      notes: 'Thanks',
      expiryDate: addDays(today(), 30),
    });
    await a.move(e.id, 'sent');
    await a.move(e.id, 'accepted');
    const res = await a.call('post', `/v1/estimates/${e.id}/convert`);
    expect(res.status).toBe(201);
    const { invoice, estimate } = res.body;
    expect(invoice).toMatchObject({
      status: 'draft',
      number: 'INV-0001',
      issueDate: today(),
      dueDate: addDays(today(), 10),
      notes: 'Thanks',
      feesMinor: 500,
      discountType: 'percent',
    });
    expect(invoice.totalMinor).toBe(estimate.totalMinor);
    expect(invoice.items).toHaveLength(1);
    expect(invoice.items[0]).toMatchObject({
      description: 'Web Development',
      quantityMilli: 10_000,
    });
    expect(estimate).toMatchObject({
      convertedInvoiceId: invoice.id,
      editable: false,
      convertible: false,
    });

    // Locked afterwards, and never converted twice.
    expect((await a.call('post', `/v1/estimates/${e.id}/convert`)).status).toBe(409);
    expect((await a.call('put', `/v1/estimates/${e.id}`).send(a.payload())).status).toBe(409);
    expect((await a.call('delete', `/v1/estimates/${e.id}`)).status).toBe(409);
    expect((await a.call('get', `/v1/invoices/${invoice.id}`)).status).toBe(200);
    expect((await a.call('get', '/v1/invoices')).body.total).toBe(1);
  });

  it('converts straight from draft or sent, but not from a declined estimate', async () => {
    const a = await account();
    const draft = await a.estimate();
    expect((await a.call('post', `/v1/estimates/${draft.id}/convert`)).status).toBe(201);
    const declined = await a.estimate();
    await a.move(declined.id, 'sent');
    await a.move(declined.id, 'rejected');
    const res = await a.call('post', `/v1/estimates/${declined.id}/convert`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_CONVERTIBLE');
  });

  it('creates exactly one invoice when converted twice at once', async () => {
    const a = await account();
    const e = await a.estimate();
    const results = await Promise.all([
      a.call('post', `/v1/estimates/${e.id}/convert`),
      a.call('post', `/v1/estimates/${e.id}/convert`),
      a.call('post', `/v1/estimates/${e.id}/convert`),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect((await a.call('get', '/v1/invoices')).body.total).toBe(1);
  });

  it('rolls everything back if the invoice cannot be created', async () => {
    const a = await account();
    const e = await a.estimate();
    await ctx.db.query('UPDATE customers SET deleted_at = now() WHERE id = $1', [a.customerId]);
    const res = await a.call('post', `/v1/estimates/${e.id}/convert`);
    expect(res.status).toBe(422);
    expect((await a.get(e.id)).convertedInvoiceId).toBeNull();
    expect((await a.call('get', '/v1/invoices')).body.total).toBe(0);
  });
});

describe('estimate PDF and email', () => {
  it('renders an estimate, not an invoice', async () => {
    const a = await account();
    const e = await a.estimate();
    const res = await a.call('post', `/v1/estimates/${e.id}/pdf`).buffer(true).parse(bin);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="${e.number}.pdf"`);
    const { text } = await pdfText(res.body);
    expect(text).toContain('ESTIMATE');
    expect(text).toContain('Valid until');
    expect(text).toContain(e.number);
    expect(text).toContain('$1,050.00');
    expect(text).not.toContain('Balance due');
    expect(text).not.toContain('INVOICE');
    expect(text).not.toContain('PAY ONLINE');
  });

  it('shows the decision on the PDF', async () => {
    const a = await account();
    const e = await a.estimate();
    await a.move(e.id, 'sent');
    await a.move(e.id, 'accepted');
    const res = await a.call('post', `/v1/estimates/${e.id}/pdf`).buffer(true).parse(bin);
    expect((await pdfText(res.body)).text).toContain('ACCEPTED');
  });

  it('emails the PDF with a view link (no pay link) and marks a draft as sent', async () => {
    const a = await account();
    await a.call('put', '/v1/business').send({ name: 'Acme Studio', email: 'owner@acme.test' });
    const e = await a.estimate();
    const before = ctx.email.sent.length;
    const res = await a.call('post', `/v1/estimates/${e.id}/send`).send({});
    expect(res.status).toBe(200);
    expect(res.body.sentTo).toBe('billing@acme.test');
    expect(res.body.estimate.status).toBe('sent');
    const mail = ctx.email.sent[before]!;
    expect(mail.subject).toBe(`Estimate ${e.number} from Acme Studio`);
    expect(mail.text).toContain(`attached estimate ${e.number} for $1,050.00`);
    expect(mail.text).not.toContain('/pay/');
    expect(mail.text).toContain('/estimate/');
    expect(mail.html).toContain('View estimate</a>');
    expect(mail.html).not.toContain('View invoice');
    expect(mail.html).toContain('estimate PDF is attached');
    expect(mail.attachments[0]!.filename).toBe(`${e.number}.pdf`);
    expect((await pdfText(mail.attachments[0]!.content)).text).toContain('ESTIMATE');
  });

  it('does not mark it sent when delivery fails, and needs a recipient', async () => {
    const a = await account();
    const e = await a.estimate();
    ctx.email.fail = true;
    const failed = await a.call('post', `/v1/estimates/${e.id}/send`).send({});
    ctx.email.fail = false;
    expect(failed.status).toBe(502);
    expect((await a.get(e.id)).status).toBe('draft');
    const noEmail = (await a.call('post', '/v1/customers').send({ companyName: 'No Mail' })).body
      .id;
    const e2 = await a.estimate({ customerId: noEmail });
    expect((await a.call('post', `/v1/estimates/${e2.id}/send`).send({})).status).toBe(422);
    const custom = await a.call('post', `/v1/estimates/${e2.id}/send`).send({ to: 'x@y.co' });
    expect(custom.status).toBe(200);
  });

  it('cannot send an accepted or converted estimate', async () => {
    const a = await account();
    const e = await a.estimate();
    await a.move(e.id, 'sent');
    await a.move(e.id, 'accepted');
    expect((await a.call('post', `/v1/estimates/${e.id}/send`).send({})).status).toBe(409);
  });
});

describe('isolation', () => {
  it('another business cannot see or change an estimate', async () => {
    const a = await account();
    const b = await account();
    const e = await a.estimate();
    expect((await b.call('get', `/v1/estimates/${e.id}`)).status).toBe(404);
    expect((await b.call('put', `/v1/estimates/${e.id}`).send(b.payload())).status).toBe(404);
    expect((await b.call('delete', `/v1/estimates/${e.id}`)).status).toBe(404);
    expect((await b.move(e.id, 'sent')).status).toBe(404);
    expect((await b.call('post', `/v1/estimates/${e.id}/convert`)).status).toBe(404);
    expect((await b.call('post', `/v1/estimates/${e.id}/pdf`)).status).toBe(404);
    expect((await b.call('post', `/v1/estimates/${e.id}/send`).send({ to: 'x@y.co' })).status).toBe(
      404,
    );
    expect((await b.call('get', '/v1/estimates')).body.items).toEqual([]);
    expect(
      (await b.call('post', '/v1/estimates').send(b.payload({ customerId: a.customerId }))).status,
    ).toBe(422);
    expect((await a.get(e.id)).status).toBe('draft');
  });
});
