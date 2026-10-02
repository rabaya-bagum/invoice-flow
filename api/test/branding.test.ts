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
  await call('put', '/v1/business').send({
    name: 'Acme Studio',
    paymentInstructions: 'E-transfer to pay@acme.test',
  });
  const customerId = (await call('post', '/v1/customers').send({ companyName: 'Acme Ltd' })).body
    .id;
  const body = {
    customerId,
    issueDate: today(),
    currency: 'USD',
    notes: 'NOTE-MARKER',
    terms: 'TERMS-MARKER',
    items: [
      {
        description: 'Web Development',
        quantityMilli: 1000,
        unitPriceMinor: 10_000,
        taxes: [{ name: 'GST', rateBps: 500 }],
      },
    ],
  };
  const invoice = async () => {
    const inv = (
      await call('post', '/v1/invoices').send({ ...body, dueDate: addDays(today(), 14) })
    ).body;
    await call('post', `/v1/invoices/${inv.id}/transition`).send({ to: 'sent' });
    const url = (await call('post', `/v1/invoices/${inv.id}/share-link`)).body.url as string;
    return { id: inv.id as string, token: url.replace('https://api.test/pay/', '') };
  };
  const estimate = async () => {
    const e = (
      await call('post', '/v1/estimates').send({ ...body, expiryDate: addDays(today(), 14) })
    ).body;
    await call('post', `/v1/estimates/${e.id}/transition`).send({ to: 'sent' });
    const url = (await call('post', `/v1/estimates/${e.id}/share-link`)).body.url as string;
    return { id: e.id as string, token: url.replace('https://api.test/estimate/', '') };
  };
  const style = (patch: object) => call('put', '/v1/business').send(patch);
  const invoicePdf = async (id: string) =>
    (await pdfText((await call('post', `/v1/invoices/${id}/pdf`).buffer(true).parse(bin)).body))
      .text;
  return { user, call, invoice, estimate, style, invoicePdf };
}

describe('saving appearance', () => {
  it('stores and returns the template, accent colour and switches', async () => {
    const a = await account();
    const res = await a.style({
      template: 'modern',
      accentColor: '#0F766E',
      displayOptions: { showNotes: false, showLogo: true },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      template: 'modern',
      accentColor: '#0F766E',
      displayOptions: { showNotes: false, showLogo: true },
    });
    expect((await a.call('get', '/v1/business')).body.template).toBe('modern');
  });

  it('rejects unreadable colours, unknown templates and unknown switches', async () => {
    const a = await account();
    expect((await a.style({ accentColor: '#FFFF99' })).status).toBe(400);
    expect((await a.style({ accentColor: 'blue' })).status).toBe(400);
    expect((await a.style({ template: 'neon' })).status).toBe(400);
    expect((await a.style({ displayOptions: { showEverything: true } })).status).toBe(400);
    expect((await a.style({ displayOptions: { showLogo: 'yes' } })).status).toBe(400);
    expect((await a.call('get', '/v1/business')).body).toMatchObject({
      template: 'classic',
      accentColor: '#2563EB',
    });
  });

  it('replaces the switches as a set and never serves junk keys already stored', async () => {
    const a = await account();
    await ctx.db.query('UPDATE business_profiles SET display_options = $2 WHERE id = $1', [
      a.user.businessId,
      JSON.stringify({ showNotes: false, evil: true, showTerms: 'maybe' }),
    ]);
    expect((await a.call('get', '/v1/business')).body.displayOptions).toEqual({ showNotes: false });
    const res = await a.style({ displayOptions: { showTerms: false } });
    expect(res.body.displayOptions).toEqual({ showTerms: false });
  });

  it("does not change another business's appearance", async () => {
    const a = await account();
    const b = await account();
    await a.style({ template: 'minimal', accentColor: '#B91C1C' });
    expect((await b.call('get', '/v1/business')).body).toMatchObject({
      template: 'classic',
      accentColor: '#2563EB',
    });
  });
});

describe('PDF honours the switches', () => {
  it('shows notes, terms, tax column and payment info by default', async () => {
    const a = await account();
    const inv = await a.invoice();
    const text = await a.invoicePdf(inv.id);
    for (const s of [
      'NOTE-MARKER',
      'TERMS-MARKER',
      'TAX',
      'PAYMENT INFORMATION',
      'E-transfer to pay@acme.test',
    ])
      expect([s, text.includes(s)]).toEqual([s, true]);
  });

  it('hides each part when switched off', async () => {
    const a = await account();
    const inv = await a.invoice();
    await a.style({
      displayOptions: {
        showNotes: false,
        showTerms: false,
        showTaxColumn: false,
        showPaymentInfo: false,
      },
    });
    const text = await a.invoicePdf(inv.id);
    expect(text).not.toContain('NOTE-MARKER');
    expect(text).not.toContain('TERMS-MARKER');
    expect(text).not.toContain('PAYMENT INFORMATION');
    expect(text).not.toMatch(/\bTAX\b/);
    expect(text).toContain('Web Development');
    expect(text).toContain('$105.00'); // the money is still all there
  });

  it('renders every template with the right content', async () => {
    const a = await account();
    const inv = await a.invoice();
    for (const template of ['classic', 'modern', 'minimal']) {
      await a.style({ template, accentColor: '#7C3AED' });
      const text = await a.invoicePdf(inv.id);
      expect([template, text.includes('INVOICE'), text.includes('$105.00')]).toEqual([
        template,
        true,
        true,
      ]);
    }
  });
});

describe('customer pages honour the appearance', () => {
  it('applies the template class and accent to the invoice page', async () => {
    const a = await account();
    const inv = await a.invoice();
    await a.style({ template: 'modern', accentColor: '#B91C1C' });
    const res = await request(ctx.app).get(`/pay/${inv.token}`);
    expect(res.text).toContain('<body class="t-modern"');
    expect(res.text).toContain('--accent:#B91C1C');
  });

  it('hides switched-off sections on the invoice page', async () => {
    const a = await account();
    const inv = await a.invoice();
    const shown = (await request(ctx.app).get(`/pay/${inv.token}`)).text;
    expect(shown).toContain('NOTE-MARKER');
    expect(shown).toContain('TERMS-MARKER');
    expect(shown).toContain('E-transfer to pay@acme.test');
    expect(shown).toContain('GST 5%');
    await a.style({
      displayOptions: {
        showNotes: false,
        showTerms: false,
        showPaymentInfo: false,
        showTaxColumn: false,
      },
    });
    const hidden = (await request(ctx.app).get(`/pay/${inv.token}`)).text;
    expect(hidden).not.toContain('NOTE-MARKER');
    expect(hidden).not.toContain('TERMS-MARKER');
    expect(hidden).not.toContain('E-transfer to pay@acme.test');
    expect(hidden).not.toContain('GST 5%');
    expect(hidden).toContain('Web Development');
    expect(hidden).toContain('$105.00');
  });

  it('does the same on the estimate page', async () => {
    const a = await account();
    const est = await a.estimate();
    await a.style({ template: 'minimal', displayOptions: { showNotes: false, showTerms: false } });
    const page = (await request(ctx.app).get(`/estimate/${est.token}`)).text;
    expect(page).toContain('<body class="t-minimal"');
    expect(page).not.toContain('NOTE-MARKER');
    expect(page).not.toContain('TERMS-MARKER');
    expect(page).toContain('Accept estimate');
  });

  it('falls back to the classic look for an unknown stored template', async () => {
    const a = await account();
    const inv = await a.invoice();
    await ctx.db
      .query("UPDATE business_profiles SET template = 'retro' WHERE id = $1", [a.user.businessId])
      .catch(() => undefined);
    const page = (await request(ctx.app).get(`/pay/${inv.token}`)).text;
    expect(page).toMatch(/<body class="t-(classic)"/);
  });
});
