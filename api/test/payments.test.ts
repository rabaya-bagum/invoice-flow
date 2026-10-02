import request from 'supertest';
import { PAY_CLIENT_JS } from '../src/public/pay-client';
import { buildDbApp, closePool, createUser } from './helpers';

type Ctx = Awaited<ReturnType<typeof buildDbApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await buildDbApp();
});
afterAll(closePool);

async function account(c: Ctx = ctx, opts: { payments?: boolean } = { payments: true }) {
  const user = await createUser();
  const auth = await c.bearer(user.id);
  const call = (m: 'get' | 'post' | 'put' | 'delete', url: string) =>
    request(c.app)[m](url).set('Authorization', auth);
  if (opts.payments !== false) {
    // Connect onboarding finished at Stripe: enable charges, then sync via the status endpoint.
    const link = (await call('post', '/v1/payments/connect/onboard')).body.url as string;
    const acct = /stripe\.test\/(acct_\d+)/.exec(link)![1]!;
    c.stripe.state.accounts.get(acct)!.chargesEnabled = true;
    await call('get', '/v1/payments/connect/status');
  }
  const customer = async (body: object = { companyName: 'Acme Ltd', email: 'billing@acme.test' }) =>
    (await call('post', '/v1/customers').send(body)).body.id as string;
  /** A sent invoice for $1,000.00 (no tax) unless overridden. */
  const invoice = async (over: object = {}, send = true) => {
    const inv = (
      await call('post', '/v1/invoices').send({
        customerId: await customer(),
        issueDate: '2026-10-01',
        dueDate: '2026-10-15',
        currency: 'USD',
        items: [{ description: 'Work', quantityMilli: 1000, unitPriceMinor: 100_000, taxes: [] }],
        ...over,
      })
    ).body as { id: string; number: string };
    if (send) await call('post', `/v1/invoices/${inv.id}/transition`).send({ to: 'sent' });
    return inv;
  };
  const intent = (invoiceId: string, amountMinor?: number) =>
    call('post', '/v1/payments/create-intent').send({
      invoiceId,
      ...(amountMinor ? { amountMinor } : {}),
    });
  const get = async (id: string) => (await call('get', `/v1/invoices/${id}`)).body;
  return { user, auth, call, customer, invoice, intent, get };
}

const hook = (c: Ctx, ev: { body: string; signature: string }) =>
  request(c.app)
    .post('/v1/payments/webhook')
    .set('stripe-signature', ev.signature)
    .set('Content-Type', 'application/json')
    .send(ev.body);

/** True if a separate connection can lock the row right now (no transaction is holding it). */
const unlockedRow = async (table: 'invoices' | 'payments', id: string) => {
  const client = await ctx.db.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT 1 FROM ${table} WHERE id = $1 FOR UPDATE NOWAIT`, [id]);
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === '55P03') return false; // lock_not_available
    throw e;
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
};

const dbPayments = async (invoiceId: string) =>
  (
    await ctx.db.query('SELECT * FROM payments WHERE invoice_id = $1 ORDER BY created_at', [
      invoiceId,
    ])
  ).rows;

describe('Stripe Connect onboarding', () => {
  it('creates the account once and returns an onboarding link with return URLs', async () => {
    const a = await account(ctx, { payments: false });
    const before = ctx.stripe.state.counts.createAccount;
    const first = await a.call('post', '/v1/payments/connect/onboard');
    const second = await a.call('post', '/v1/payments/connect/onboard');
    expect(first.status).toBe(200);
    expect(first.body.url).toContain('connect.stripe.test/acct_');
    expect(decodeURIComponent(first.body.url)).toContain('https://api.test/stripe/connect/return');
    expect(ctx.stripe.state.counts.createAccount - before).toBe(1);
    expect(/acct_\d+/.exec(first.body.url)![0]).toBe(/acct_\d+/.exec(second.body.url)![0]);
  });

  it('reports status and syncs the charges-enabled flag from Stripe', async () => {
    const a = await account(ctx, { payments: false });
    expect((await a.call('get', '/v1/payments/connect/status')).body).toMatchObject({
      connected: false,
      chargesEnabled: false,
      configured: true,
    });
    const acct = /acct_\d+/.exec(
      (await a.call('post', '/v1/payments/connect/onboard')).body.url,
    )![0];
    const pending = await a.call('get', '/v1/payments/connect/status');
    expect(pending.body).toMatchObject({
      connected: true,
      chargesEnabled: false,
      requirementsDue: ['external_account'],
    });
    ctx.stripe.state.accounts.get(acct)!.chargesEnabled = true;
    expect((await a.call('get', '/v1/payments/connect/status')).body.chargesEnabled).toBe(true);
    expect((await a.call('get', '/v1/business')).body.stripeChargesEnabled).toBe(true);
  });

  it('requires login, and says so when Stripe is not configured', async () => {
    expect((await request(ctx.app).get('/v1/payments/connect/status')).status).toBe(401);
    const off = await buildDbApp({}, { stripe: false });
    const a = await account(off, { payments: false });
    expect((await a.call('get', '/v1/payments/connect/status')).body).toMatchObject({
      configured: false,
      connected: false,
    });
    const res = await a.call('post', '/v1/payments/connect/onboard');
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('PAYMENTS_UNAVAILABLE');
  });

  it('serves the landing pages that return to the app', async () => {
    const done = await request(ctx.app).get('/stripe/connect/return');
    expect(done.text).toContain('invoiceflow://stripe/return');
    const refresh = await request(ctx.app).get('/stripe/connect/refresh');
    expect(refresh.text).toContain('invoiceflow://stripe/refresh');
  });
});

describe('creating a payment', () => {
  it('starts a destination charge with the platform fee and receipt email', async () => {
    const a = await account();
    const inv = await a.invoice();
    const res = await a.intent(inv.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      amountMinor: 100_000,
      currency: 'USD',
      publishableKey: 'pk_test_123',
      reused: false,
    });
    expect(res.body.clientSecret).toMatch(/_secret_/);
    const pi = [...ctx.stripe.state.intents.values()].find(
      (p) => p.params.metadata.invoice_id === inv.id,
    )!;
    expect(pi.amount).toBe(100_000);
    expect(pi.params).toMatchObject({
      applicationFee: 2_500, // 2.5% of $1,000.00
      receiptEmail: 'billing@acme.test',
      description: `Invoice ${inv.number}`,
    });
    expect(pi.params.destination).toMatch(/^acct_/);
    const rows = await dbPayments(inv.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'pending',
      amount_minor: 100_000,
      application_fee_minor: 2_500,
      stripe_payment_intent_id: pi.id,
    });
  });

  it('allows a partial amount but never more than the balance', async () => {
    const a = await account();
    const inv = await a.invoice();
    expect((await a.intent(inv.id, 40_000)).body.amountMinor).toBe(40_000);
    const over = await a.intent(inv.id, 100_001);
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('AMOUNT_TOO_HIGH');
  });

  it.each([[0], [-5], [10.5], ['100']])('rejects the amount %p', async (amount) => {
    const a = await account();
    const inv = await a.invoice();
    const res = await a
      .call('post', '/v1/payments/create-intent')
      .send({ invoiceId: inv.id, amountMinor: amount });
    expect(res.status).toBe(400);
  });

  it('refuses invoices that cannot be paid, and businesses without payouts set up', async () => {
    const a = await account();
    const draft = await a.invoice({}, false);
    expect((await a.intent(draft.id)).body.error.code).toBe('INVOICE_NOT_PAYABLE');
    const cancelled = await a.invoice();
    await a.call('post', `/v1/invoices/${cancelled.id}/transition`).send({ to: 'cancelled' });
    expect((await a.intent(cancelled.id)).status).toBe(409);
    const paid = await a.invoice();
    await ctx.db.query(
      "UPDATE invoices SET status = 'paid', amount_paid_minor = total_minor WHERE id = $1",
      [paid.id],
    );
    expect((await a.intent(paid.id)).status).toBe(409);

    const b = await account(ctx, { payments: false });
    const inv = await b.invoice();
    const res = await b.intent(inv.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENTS_NOT_ENABLED');
  });

  it("does not let another account start a payment for someone else's invoice", async () => {
    const a = await account();
    const b = await account();
    const inv = await a.invoice();
    expect((await b.intent(inv.id)).status).toBe(404);
  });

  it('reuses the open intent for the same amount instead of creating another', async () => {
    const a = await account();
    const inv = await a.invoice();
    const before = ctx.stripe.state.counts.createPaymentIntent;
    const first = await a.intent(inv.id);
    const second = await a.intent(inv.id);
    expect(second.body).toMatchObject({
      reused: true,
      clientSecret: first.body.clientSecret,
      paymentId: first.body.paymentId,
    });
    expect(ctx.stripe.state.counts.createPaymentIntent - before).toBe(1);
    expect(await dbPayments(inv.id)).toHaveLength(1);
  });

  it('replaces the open intent when the amount changes (one live attempt per invoice)', async () => {
    const a = await account();
    const inv = await a.invoice();
    const first = await a.intent(inv.id, 40_000);
    const cancelsBefore = ctx.stripe.state.counts.cancel;
    const second = await a.intent(inv.id, 60_000);
    expect(second.body.paymentId).not.toBe(first.body.paymentId);
    expect(ctx.stripe.state.counts.cancel - cancelsBefore).toBe(1);
    const rows = await dbPayments(inv.id);
    expect(rows.map((r) => [r.status, r.amount_minor])).toEqual([
      ['failed', 40_000],
      ['pending', 60_000],
    ]);
    expect(rows[0].failure_code).toBe('replaced');
  });

  it('keeps the open intent if Stripe will not cancel it, instead of starting a second one', async () => {
    const a = await account();
    const inv = await a.invoice();
    const first = await a.intent(inv.id, 40_000);
    const createdBefore = ctx.stripe.state.counts.createPaymentIntent;
    ctx.stripe.state.failCancel = true;
    try {
      const res = await a.intent(inv.id, 60_000);
      expect(res.status).toBe(502);
      expect(res.body.error.code).toBe('PAYMENT_PROVIDER_ERROR');
    } finally {
      ctx.stripe.state.failCancel = false;
    }
    // The old client secret may still be live in another tab, so it must stay the one attempt.
    expect(ctx.stripe.state.counts.createPaymentIntent).toBe(createdBefore);
    expect((await dbPayments(inv.id)).map((r) => [r.status, r.amount_minor])).toEqual([
      ['pending', 40_000],
    ]);
    // Once Stripe answers again the change goes through normally.
    const retry = await a.intent(inv.id, 60_000);
    expect(retry.status).toBe(201);
    expect(retry.body.paymentId).not.toBe(first.body.paymentId);
  });

  it('never holds the invoice lock (or a transaction) while waiting on Stripe', async () => {
    const a = await account();
    const inv = await a.invoice();
    let free: boolean | null = null;
    ctx.stripe.state.duringCreateIntent = async () => {
      free = await unlockedRow('invoices', inv.id);
    };
    try {
      expect((await a.intent(inv.id)).status).toBe(201);
    } finally {
      ctx.stripe.state.duringCreateIntent = null;
    }
    expect(free).toBe(true);
  });

  it('does not hand out an intent if the invoice changed while Stripe was creating it', async () => {
    const a = await account();
    const inv = await a.invoice();
    const cancelsBefore = ctx.stripe.state.counts.cancel;
    ctx.stripe.state.duringCreateIntent = async () => {
      await ctx.db.query("UPDATE invoices SET status = 'cancelled' WHERE id = $1", [inv.id]);
    };
    let res;
    try {
      res = await a.intent(inv.id);
    } finally {
      ctx.stripe.state.duringCreateIntent = null;
    }
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVOICE_NOT_PAYABLE');
    expect(res.body.clientSecret).toBeUndefined();
    // Recorded (so the next attempt gets a fresh idempotency key) and cancelled at Stripe.
    expect((await dbPayments(inv.id)).map((r) => [r.status, r.failure_code])).toEqual([
      ['failed', 'superseded'],
    ]);
    expect(ctx.stripe.state.counts.cancel - cancelsBefore).toBe(1);
  });

  it('gives way to another attempt recorded while Stripe was creating this one', async () => {
    const a = await account();
    const inv = await a.invoice();
    const row = (await ctx.db.query('SELECT business_id FROM invoices WHERE id = $1', [inv.id]))
      .rows[0];
    ctx.stripe.state.duringCreateIntent = async () => {
      await ctx.db.query(
        `INSERT INTO payments (business_id, invoice_id, amount_minor, currency, status, stripe_payment_intent_id, idempotency_key)
         VALUES ($1, $2, 100000, 'USD', 'pending', $3, 'other-attempt')`,
        [row.business_id, inv.id, `pi_other_${inv.id}`],
      );
    };
    let res;
    try {
      res = await a.intent(inv.id);
    } finally {
      ctx.stripe.state.duringCreateIntent = null;
    }
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_IN_PROGRESS');
    const rows = await dbPayments(inv.id);
    expect(rows.map((r) => r.status).sort()).toEqual(['failed', 'pending']);
    expect(rows.find((r) => r.status === 'pending')!.stripe_payment_intent_id).toBe(
      `pi_other_${inv.id}`,
    );
  });

  it('never starts a second attempt while a payment is processing or has succeeded at Stripe', async () => {
    const a = await account();
    const inv = await a.invoice();
    await a.intent(inv.id);
    const pi = [...ctx.stripe.state.intents.values()].find(
      (p) => p.params.metadata.invoice_id === inv.id,
    )!;
    pi.status = 'processing';
    const res = await a.intent(inv.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_IN_PROGRESS');
    pi.status = 'succeeded'; // webhook not processed yet
    expect((await a.intent(inv.id, 500)).status).toBe(409);
    expect(await dbPayments(inv.id)).toHaveLength(1);
  });

  it('survives many simultaneous requests: exactly one intent and one pending payment', async () => {
    const a = await account();
    const inv = await a.invoice();
    const before = ctx.stripe.state.counts.createPaymentIntent;
    const results = await Promise.all(Array.from({ length: 6 }, () => a.intent(inv.id)));
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.clientSecret)).size).toBe(1);
    expect(ctx.stripe.state.counts.createPaymentIntent - before).toBe(1);
    expect(await dbPayments(inv.id)).toHaveLength(1);
  });

  it('the database itself refuses a second pending payment', async () => {
    const a = await account();
    const inv = await a.invoice();
    await a.intent(inv.id);
    const row = (await dbPayments(inv.id))[0];
    await expect(
      ctx.db.query(
        "INSERT INTO payments (business_id, invoice_id, amount_minor, currency, status) VALUES ($1, $2, 100, 'USD', 'pending')",
        [row.business_id, inv.id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('converts amounts for special currencies and refuses unsupported ones', async () => {
    const a = await account();
    const jpy = await a.invoice({
      currency: 'JPY',
      items: [{ description: 'x', quantityMilli: 1000, unitPriceMinor: 5_000, taxes: [] }],
    });
    await a.intent(jpy.id);
    expect(
      [...ctx.stripe.state.intents.values()].find((p) => p.params.metadata.invoice_id === jpy.id)!
        .amount,
    ).toBe(5_000);
    const isk = await a.invoice({
      currency: 'ISK',
      items: [{ description: 'x', quantityMilli: 1000, unitPriceMinor: 5_000, taxes: [] }],
    });
    await a.intent(isk.id);
    expect(
      [...ctx.stripe.state.intents.values()].find((p) => p.params.metadata.invoice_id === isk.id)!
        .amount,
    ).toBe(500_000); // Stripe wants x100
    const kwd = await a.invoice({
      currency: 'KWD',
      items: [{ description: 'x', quantityMilli: 1000, unitPriceMinor: 1_234, taxes: [] }],
    });
    const res = await a.intent(kwd.id);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('AMOUNT_UNSUPPORTED');
  });

  it('maps Stripe failures to safe errors', async () => {
    const a = await account();
    const inv = await a.invoice();
    ctx.stripe.state.failIntentCreate = 'amount_too_small';
    try {
      const small = await a.intent(inv.id);
      expect(small.status).toBe(422);
      expect(small.body.error.code).toBe('AMOUNT_TOO_SMALL');
      ctx.stripe.state.failIntentCreate = 'api_connection_error';
      const down = await a.intent(inv.id);
      expect(down.status).toBe(502);
      expect(JSON.stringify(down.body)).not.toContain('stripe says no');
    } finally {
      ctx.stripe.state.failIntentCreate = null;
    }
    expect(await dbPayments(inv.id)).toHaveLength(0);
  });

  it('freezes the invoice while a payment is underway, and frees it after a failure', async () => {
    const a = await account();
    const inv = await a.invoice();
    const created = await a.intent(inv.id);
    // The customer is in a 3-D Secure check: money may move, so the invoice must not change.
    [...ctx.stripe.state.intents.values()].find(
      (p) => p.params.metadata.invoice_id === inv.id,
    )!.status = 'requires_action';
    const body = {
      customerId: (await a.get(inv.id)).customerId,
      issueDate: '2026-10-01',
      dueDate: '2026-10-15',
      currency: 'USD',
      items: [{ description: 'Cheaper', quantityMilli: 1000, unitPriceMinor: 1, taxes: [] }],
    };
    const edit = await a.call('put', `/v1/invoices/${inv.id}`).send(body);
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('PAYMENT_IN_PROGRESS');
    expect(
      (await a.call('post', `/v1/invoices/${inv.id}/transition`).send({ to: 'cancelled' })).body
        .error.code,
    ).toBe('PAYMENT_IN_PROGRESS');

    const pi = [...ctx.stripe.state.intents.values()].find(
      (p) => p.params.metadata.invoice_id === inv.id,
    )!;
    await hook(ctx, ctx.stripe.failedEvent(pi.id));
    expect(created.status).toBe(201);
    expect((await a.call('put', `/v1/invoices/${inv.id}`).send(body)).status).toBe(200);
  });

  /** Opens the payment form for an invoice, then walks away (intent left untouched at Stripe). */
  async function abandoned(a: Awaited<ReturnType<typeof account>>) {
    const inv = await a.invoice();
    await a.intent(inv.id);
    const pi = [...ctx.stripe.state.intents.values()].find(
      (p) => p.params.metadata.invoice_id === inv.id,
    )!;
    const body = {
      customerId: (await a.get(inv.id)).customerId,
      issueDate: '2026-10-01',
      dueDate: '2026-10-15',
      currency: 'USD',
      items: [{ description: 'Revised', quantityMilli: 1000, unitPriceMinor: 90_000, taxes: [] }],
    };
    return { inv, pi, body };
  }

  it('an abandoned payment form does not lock the invoice: editing cancels it at Stripe', async () => {
    const a = await account();
    const { inv, pi, body } = await abandoned(a);
    const res = await a.call('put', `/v1/invoices/${inv.id}`).send(body);
    expect(res.status).toBe(200);
    expect(pi.status).toBe('canceled');
    expect((await dbPayments(inv.id)).map((r) => [r.status, r.failure_code])).toEqual([
      ['failed', 'abandoned'],
    ]);
    // Stripe's own cancellation webhook arriving later changes nothing.
    await hook(ctx, ctx.stripe.signed('payment_intent.canceled', { id: pi.id }));
    expect((await dbPayments(inv.id))[0].failure_code).toBe('abandoned');
  });

  it('an abandoned payment form does not stop the owner cancelling the invoice', async () => {
    const a = await account();
    const { inv } = await abandoned(a);
    const res = await a.call('post', `/v1/invoices/${inv.id}/transition`).send({ to: 'cancelled' });
    expect(res.status).toBe(200);
    expect((await a.get(inv.id)).status).toBe('cancelled');
  });

  it('keeps the invoice locked if the abandoned intent cannot be cancelled at Stripe', async () => {
    const a = await account();
    const { inv, pi, body } = await abandoned(a);
    ctx.stripe.state.failCancel = true;
    try {
      const res = await a.call('put', `/v1/invoices/${inv.id}`).send(body);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PAYMENT_IN_PROGRESS');
    } finally {
      ctx.stripe.state.failCancel = false;
    }
    expect(pi.status).toBe('requires_payment_method');
    expect((await dbPayments(inv.id)).map((r) => r.status)).toEqual(['pending']);
  });
});

describe('webhook security', () => {
  it('rejects missing, malformed, tampered and wrongly signed requests', async () => {
    const ev = ctx.stripe.signed('payment_intent.succeeded', { id: 'pi_x' });
    expect(
      (
        await request(ctx.app)
          .post('/v1/payments/webhook')
          .set('Content-Type', 'application/json')
          .send(ev.body)
      ).status,
    ).toBe(400);
    expect(
      (
        await request(ctx.app)
          .post('/v1/payments/webhook')
          .set('stripe-signature', 'garbage')
          .set('Content-Type', 'application/json')
          .send(ev.body)
      ).status,
    ).toBe(400);
    expect(
      (await hook(ctx, { body: ev.body.replace('pi_x', 'pi_y'), signature: ev.signature })).status,
    ).toBe(400); // body changed after signing
    const other = new (await import('stripe')).default('sk_test_x');
    const wrong = other.webhooks.generateTestHeaderString({
      payload: ev.body,
      secret: 'whsec_wrong',
    });
    const res = await hook(ctx, { body: ev.body, signature: wrong });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_SIGNATURE');
    expect((await hook(ctx, ev)).status).toBe(200); // the properly signed one passes
  });

  it('records nothing for a rejected request', async () => {
    const ev = ctx.stripe.signed(
      'payment_intent.succeeded',
      { id: 'pi_rejected' },
      'evt_rejected_1',
    );
    await hook(ctx, { body: ev.body, signature: 'v1=bad' });
    expect(
      (await ctx.db.query("SELECT 1 FROM webhook_events WHERE id = 'evt_rejected_1'")).rowCount,
    ).toBe(0);
  });
});

describe('successful payments', () => {
  async function paid(a: Awaited<ReturnType<typeof account>>, amount?: number, over: object = {}) {
    const existing = (over as { id?: string }).id;
    const inv: { id: string; number?: string } = existing
      ? { id: existing }
      : await a.invoice(over);
    const created = await a.intent(inv.id, amount);
    const piId = [...ctx.stripe.state.intents.entries()].find(
      ([, p]) => p.clientSecret === created.body.clientSecret,
    )![0];
    return { inv, piId, created };
  }

  it('marks the invoice paid, records the method and receipt, and notifies the owner', async () => {
    const a = await account();
    ctx.stripe.state.method = 'card';
    const { inv, piId, created } = await paid(a);
    const res = await hook(ctx, ctx.stripe.succeededEvent(piId));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true, duplicate: false });

    const payment = (await dbPayments(inv.id))[0];
    expect(payment).toMatchObject({
      id: created.body.paymentId,
      status: 'successful',
      method: 'card',
      amount_minor: 100_000,
      stripe_charge_id: `ch_${piId}`,
    });
    expect(payment.receipt_url).toBe(`https://receipt.test/ch_${piId}`);
    expect(payment.paid_at).not.toBeNull();
    const invoice = await a.get(inv.id);
    expect(invoice).toMatchObject({
      status: 'paid',
      displayStatus: 'paid',
      amountPaidMinor: 100_000,
      balanceDueMinor: 0,
      editable: false,
    });
    expect(
      invoice.paidAt ??
        (await ctx.db.query('SELECT paid_at FROM invoices WHERE id=$1', [inv.id])).rows[0].paid_at,
    ).not.toBeNull();

    const types = (await a.call('get', `/v1/invoices/${inv.id}/activity`)).body.items.map(
      (x: { type: string }) => x.type,
    );
    expect(types).toEqual(['created', 'sent', 'payment_received', 'paid']);
    const notes = await ctx.db.query(
      'SELECT type, title, body FROM notifications WHERE business_id = (SELECT business_id FROM invoices WHERE id = $1)',
      [inv.id],
    );
    expect(notes.rows).toEqual([
      {
        type: 'invoice_paid',
        title: 'Invoice paid',
        body: `Payment of $1,000.00 received for ${inv.number}.`,
      },
    ]);
  });

  it.each([
    ['apple_pay', '(Apple Pay)'],
    ['google_pay', '(Google Pay)'],
  ] as const)('records %s payments', async (method, label) => {
    const a = await account();
    ctx.stripe.state.method = method;
    const { inv, piId } = await paid(a);
    await hook(ctx, ctx.stripe.succeededEvent(piId));
    ctx.stripe.state.method = 'card';
    expect((await dbPayments(inv.id))[0].method).toBe(method);
    const msgs = (await a.call('get', `/v1/invoices/${inv.id}/activity`)).body.items.map(
      (x: { message: string }) => x.message,
    );
    expect(msgs.some((m: string) => m.includes(label))).toBe(true);
  });

  it('handles partial payments: $400, then the remaining $600', async () => {
    const a = await account();
    const first = await paid(a, 40_000);
    await hook(ctx, ctx.stripe.succeededEvent(first.piId));
    const mid = await a.get(first.inv.id);
    expect(mid).toMatchObject({
      status: 'partially_paid',
      amountPaidMinor: 40_000,
      balanceDueMinor: 60_000,
      totalMinor: 100_000,
    });
    expect(mid.editable).toBe(false);

    // The customer can now only pay what is left.
    expect((await a.intent(first.inv.id, 60_001)).body.error.code).toBe('AMOUNT_TOO_HIGH');
    const second = await paid(a, undefined, { id: first.inv.id });
    expect(second.created.body.amountMinor).toBe(60_000);
    await hook(ctx, ctx.stripe.succeededEvent(second.piId));
    const done = await a.get(first.inv.id);
    expect(done).toMatchObject({ status: 'paid', amountPaidMinor: 100_000, balanceDueMinor: 0 });
    const notes = (
      await ctx.db.query(
        "SELECT type FROM notifications WHERE data->>'invoiceId' = $1 ORDER BY created_at",
        [first.inv.id],
      )
    ).rows.map((r) => r.type);
    expect(notes).toEqual(['partial_payment', 'invoice_paid']);
  });

  it('is idempotent: the same event delivered again changes nothing', async () => {
    const a = await account();
    const { inv, piId } = await paid(a, 40_000);
    const ev = ctx.stripe.succeededEvent(piId);
    expect((await hook(ctx, ev)).body.duplicate).toBe(false);
    const again = await hook(ctx, ev);
    expect(again.status).toBe(200);
    expect(again.body.duplicate).toBe(true);
    expect((await a.get(inv.id)).amountPaidMinor).toBe(40_000);
    expect(
      (
        await ctx.db.query(
          "SELECT count(*) AS n FROM notifications WHERE data->>'invoiceId' = $1",
          [inv.id],
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('is idempotent across different event ids for the same payment', async () => {
    const a = await account();
    const { inv, piId } = await paid(a, 40_000);
    await hook(ctx, ctx.stripe.succeededEvent(piId));
    await hook(ctx, ctx.stripe.succeededEvent(piId)); // new event id, same intent
    expect((await a.get(inv.id)).amountPaidMinor).toBe(40_000);
  });

  it('applies a payment once even when the same event arrives concurrently', async () => {
    const a = await account();
    const { inv, piId } = await paid(a, 40_000);
    const ev = ctx.stripe.succeededEvent(piId);
    const results = await Promise.all(Array.from({ length: 5 }, () => hook(ctx, ev)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    expect((await a.get(inv.id)).amountPaidMinor).toBe(40_000);
  });

  it('looks up the charge before locking anything', async () => {
    const a = await account();
    const inv = await a.invoice();
    const created = await a.intent(inv.id);
    const piId = [...ctx.stripe.state.intents.entries()].find(
      ([, p]) => p.clientSecret === created.body.clientSecret,
    )![0];
    let free: boolean | null = null;
    ctx.stripe.state.duringChargeLookup = async () => {
      free =
        (await unlockedRow('payments', created.body.paymentId)) &&
        (await unlockedRow('invoices', inv.id));
    };
    try {
      expect((await hook(ctx, ctx.stripe.succeededEvent(piId))).status).toBe(200);
    } finally {
      ctx.stripe.state.duringChargeLookup = null;
    }
    expect(free).toBe(true);
    expect((await a.get(inv.id)).status).toBe('paid');
  });

  it('rolls back and lets Stripe retry when processing fails midway', async () => {
    const a = await account();
    const { inv, piId } = await paid(a);
    const ev = ctx.stripe.succeededEvent(piId);
    ctx.stripe.state.failChargeLookup = 1;
    const failed = await hook(ctx, ev);
    expect(failed.status).toBe(500);
    expect((await a.get(inv.id)).status).toBe('sent'); // nothing half-applied
    expect(
      (await ctx.db.query('SELECT 1 FROM webhook_events WHERE id = $1', [ev.id])).rowCount,
    ).toBe(0);
    const retry = await hook(ctx, ev); // Stripe retries the SAME event
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(false);
    expect((await a.get(inv.id)).status).toBe('paid');
  });

  it('trusts the amount Stripe actually collected and flags a mismatch', async () => {
    const a = await account();
    const { inv, piId } = await paid(a, 40_000);
    await hook(ctx, ctx.stripe.succeededEvent(piId, { amount_received: 30_000 }));
    expect((await dbPayments(inv.id))[0].amount_minor).toBe(30_000);
    expect(await a.get(inv.id)).toMatchObject({
      status: 'partially_paid',
      amountPaidMinor: 30_000,
    });
    const audit = await ctx.db.query(
      "SELECT metadata FROM audit_logs WHERE entity_id = $1 AND action = 'payment.amount_mismatch'",
      [inv.id],
    );
    expect(audit.rows[0].metadata).toEqual({ expected: 40_000, received: 30_000 });
  });

  it('ignores events for payments we do not know about', async () => {
    const res = await hook(
      ctx,
      ctx.stripe.signed('payment_intent.succeeded', {
        id: 'pi_not_ours',
        amount: 100,
        latest_charge: 'ch_x',
      }),
    );
    expect(res.status).toBe(200);
  });
});

describe('failed and cancelled payments', () => {
  it('marks the payment failed, leaves the invoice alone, notifies, and allows a retry', async () => {
    const a = await account();
    const inv = await a.invoice();
    await a.intent(inv.id);
    const piId = [...ctx.stripe.state.intents.entries()].find(
      ([, p]) => p.params.metadata.invoice_id === inv.id,
    )![0];
    await hook(ctx, ctx.stripe.failedEvent(piId, 'card_declined'));
    const row = (await dbPayments(inv.id))[0];
    expect(row).toMatchObject({ status: 'failed', failure_code: 'card_declined' });
    expect(await a.get(inv.id)).toMatchObject({ status: 'sent', amountPaidMinor: 0 });
    const notes = await ctx.db.query(
      "SELECT type FROM notifications WHERE data->>'invoiceId' = $1",
      [inv.id],
    );
    expect(notes.rows).toEqual([{ type: 'payment_failed' }]);
    expect((await a.intent(inv.id)).status).toBe(201); // a new attempt is possible
  });

  it('a late failure never undoes a success', async () => {
    const a = await account();
    const inv = await a.invoice();
    await a.intent(inv.id);
    const piId = [...ctx.stripe.state.intents.entries()].find(
      ([, p]) => p.params.metadata.invoice_id === inv.id,
    )![0];
    await hook(ctx, ctx.stripe.succeededEvent(piId));
    await hook(ctx, ctx.stripe.failedEvent(piId));
    expect((await dbPayments(inv.id))[0].status).toBe('successful');
    expect((await a.get(inv.id)).status).toBe('paid');
  });

  it('a cancelled intent frees the invoice without a failure notification', async () => {
    const a = await account();
    const inv = await a.invoice();
    await a.intent(inv.id);
    const piId = [...ctx.stripe.state.intents.entries()].find(
      ([, p]) => p.params.metadata.invoice_id === inv.id,
    )![0];
    await hook(ctx, ctx.stripe.signed('payment_intent.canceled', { id: piId }));
    expect((await dbPayments(inv.id))[0]).toMatchObject({
      status: 'failed',
      failure_code: 'canceled',
    });
    expect(
      (await ctx.db.query("SELECT 1 FROM notifications WHERE data->>'invoiceId' = $1", [inv.id]))
        .rowCount,
    ).toBe(0);
  });
});

describe('refunds', () => {
  async function paidInvoice(a: Awaited<ReturnType<typeof account>>, amount?: number) {
    const inv = await a.invoice();
    const created = await a.intent(inv.id, amount);
    const piId = [...ctx.stripe.state.intents.entries()].find(
      ([, p]) => p.clientSecret === created.body.clientSecret,
    )![0];
    await hook(ctx, ctx.stripe.succeededEvent(piId));
    return { inv, piId, paymentId: created.body.paymentId as string };
  }

  it('refunds in full: asks Stripe, then updates payment and invoice when Stripe confirms', async () => {
    const a = await account();
    const { inv, piId, paymentId } = await paidInvoice(a);
    const before = ctx.stripe.state.refunds.length;
    const res = await a.call('post', `/v1/payments/${paymentId}/refund`).send({});
    expect(res.status).toBe(202);
    expect(res.body.requested).toBe(100_000);
    expect(ctx.stripe.state.refunds.at(-1)).toMatchObject({
      paymentIntentId: piId,
      amount: 100_000,
    });
    expect(ctx.stripe.state.refunds.length - before).toBe(1);
    // Nothing changes until the webhook says so.
    expect((await a.get(inv.id)).status).toBe('paid');

    await hook(ctx, ctx.stripe.refundedEvent(piId, 100_000));
    expect((await dbPayments(inv.id))[0]).toMatchObject({
      status: 'refunded',
      refunded_minor: 100_000,
    });
    expect(await a.get(inv.id)).toMatchObject({ status: 'refunded', amountPaidMinor: 0 });
    await hook(ctx, ctx.stripe.refundedEvent(piId, 100_000)); // duplicate state, new event id
    expect((await a.get(inv.id)).status).toBe('refunded');
    const types = (await a.call('get', `/v1/invoices/${inv.id}/activity`)).body.items.map(
      (x: { type: string }) => x.type,
    );
    expect(types.filter((t: string) => t === 'refund')).toHaveLength(1);
  });

  it('handles partial refunds: paid becomes partially paid, then refunded', async () => {
    const a = await account();
    const { inv, piId, paymentId } = await paidInvoice(a);
    await a.call('post', `/v1/payments/${paymentId}/refund`).send({ amountMinor: 25_000 });
    await hook(ctx, ctx.stripe.refundedEvent(piId, 25_000));
    expect((await dbPayments(inv.id))[0]).toMatchObject({
      status: 'successful',
      refunded_minor: 25_000,
    });
    expect(await a.get(inv.id)).toMatchObject({
      status: 'partially_paid',
      amountPaidMinor: 75_000,
      balanceDueMinor: 25_000,
    });

    await a.call('post', `/v1/payments/${paymentId}/refund`).send({});
    expect(ctx.stripe.state.refunds.at(-1)!.amount).toBe(75_000); // only what remains
    await hook(ctx, ctx.stripe.refundedEvent(piId, 100_000));
    expect(await a.get(inv.id)).toMatchObject({ status: 'refunded', amountPaidMinor: 0 });
  });

  it('refuses over-refunds, non-successful payments, and other accounts', async () => {
    const a = await account();
    const b = await account();
    const { paymentId } = await paidInvoice(a);
    const over = await a
      .call('post', `/v1/payments/${paymentId}/refund`)
      .send({ amountMinor: 100_001 });
    expect(over.status).toBe(422);
    expect(over.body.error.code).toBe('AMOUNT_TOO_HIGH');
    expect((await b.call('post', `/v1/payments/${paymentId}/refund`).send({})).status).toBe(404);

    const inv = await a.invoice();
    const pending = (await a.intent(inv.id)).body.paymentId;
    const res = await a.call('post', `/v1/payments/${pending}/refund`).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_REFUNDABLE');
  });

  const refundWithKey = (
    a: Awaited<ReturnType<typeof account>>,
    paymentId: string,
    key: string,
    body: object = {},
  ) => a.call('post', `/v1/payments/${paymentId}/refund`).set('Idempotency-Key', key).send(body);

  it('a retried refund request (same Idempotency-Key) is sent to Stripe once', async () => {
    const a = await account();
    const { paymentId } = await paidInvoice(a);
    const before = ctx.stripe.state.refunds.length;
    const first = await refundWithKey(a, paymentId, 'retry-key-0001', { amountMinor: 10_000 });
    const retry = await refundWithKey(a, paymentId, 'retry-key-0001', { amountMinor: 10_000 });
    expect([first.status, retry.status]).toEqual([202, 202]);
    expect(ctx.stripe.state.refunds.length - before).toBe(1);
  });

  it('a retried full refund that already went through succeeds instead of failing', async () => {
    const a = await account();
    const { paymentId } = await paidInvoice(a);
    const before = ctx.stripe.state.refunds.length;
    expect((await refundWithKey(a, paymentId, 'full-key-0001')).status).toBe(202);
    const retry = await refundWithKey(a, paymentId, 'full-key-0001');
    expect(retry.status).toBe(202);
    expect(retry.body.requested).toBe(100_000);
    expect(ctx.stripe.state.refunds.length - before).toBe(1);
  });

  it('refuses a changed amount under a key whose earlier refund already went through', async () => {
    const a = await account();
    const { paymentId } = await paidInvoice(a);
    const before = ctx.stripe.state.refunds.length;
    // The first response was lost (the client saw an error), then the amount was edited.
    expect(
      (await refundWithKey(a, paymentId, 'lost-key-0001', { amountMinor: 1_000 })).status,
    ).toBe(202);
    const changed = await refundWithKey(a, paymentId, 'lost-key-0001', { amountMinor: 2_000 });
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe('REFUND_ALREADY_ISSUED');
    const full = await refundWithKey(a, paymentId, 'lost-key-0001');
    expect(full.status).toBe(409);
    expect(ctx.stripe.state.refunds.length - before).toBe(1);
    // A new key is a new refund, and the earlier one counts toward what remains.
    const next = await refundWithKey(a, paymentId, 'next-key-0001');
    expect(next.status).toBe(202);
    expect(next.body.requested).toBe(99_000);
  });

  it('issues two deliberate refunds of the same amount before the first webhook lands', async () => {
    const a = await account();
    const { paymentId } = await paidInvoice(a);
    const before = ctx.stripe.state.refunds.length;
    await refundWithKey(a, paymentId, 'first-key-0001', { amountMinor: 10_000 });
    await refundWithKey(a, paymentId, 'second-key-001', { amountMinor: 10_000 });
    expect(ctx.stripe.state.refunds.length - before).toBe(2);
    // Without a client key, a second request is also a new refund once Stripe holds the first.
    await a.call('post', `/v1/payments/${paymentId}/refund`).send({ amountMinor: 10_000 });
    expect(ctx.stripe.state.refunds.length - before).toBe(3);
  });

  it('counts refunds still in flight at Stripe toward what can be refunded', async () => {
    const a = await account();
    const { paymentId } = await paidInvoice(a);
    expect(
      (await a.call('post', `/v1/payments/${paymentId}/refund`).send({ amountMinor: 60_000 }))
        .status,
    ).toBe(202);
    // No webhook yet: our own refunded total is still 0, but Stripe already holds $600.
    const second = await a
      .call('post', `/v1/payments/${paymentId}/refund`)
      .send({ amountMinor: 60_000 });
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('AMOUNT_TOO_HIGH');
  });

  it('ignores a malformed Idempotency-Key rather than trusting it', async () => {
    const a = await account();
    const { paymentId } = await paidInvoice(a);
    const before = ctx.stripe.state.refunds.length;
    await refundWithKey(a, paymentId, 'bad key!', { amountMinor: 1_000 });
    expect(ctx.stripe.state.refunds.at(-1)!.requestKey).toBeUndefined();
    expect(ctx.stripe.state.refunds.length - before).toBe(1);
  });

  it('audits refund requests', async () => {
    const a = await account();
    const { inv, paymentId } = await paidInvoice(a);
    await a.call('post', `/v1/payments/${paymentId}/refund`).send({ amountMinor: 500 });
    const audit = await ctx.db.query(
      "SELECT user_id, metadata FROM audit_logs WHERE entity_id = $1 AND action = 'payment.refund_requested'",
      [inv.id],
    );
    expect(audit.rows[0].user_id).toBe(a.user.id);
    expect(audit.rows[0].metadata).toMatchObject({ amount: 500 });
  });
});

describe('payment history', () => {
  it('lists payments with invoice, customer and status; filters and searches', async () => {
    const a = await account();
    const paidInv = await a.invoice();
    const pa = await a.intent(paidInv.id);
    const piA = [...ctx.stripe.state.intents.entries()].find(
      ([, p]) => p.clientSecret === pa.body.clientSecret,
    )![0];
    await hook(ctx, ctx.stripe.succeededEvent(piA));
    const failedInv = await a.invoice();
    await a.intent(failedInv.id);
    const piB = [...ctx.stripe.state.intents.entries()].find(
      ([, p]) => p.params.metadata.invoice_id === failedInv.id,
    )![0];
    await hook(ctx, ctx.stripe.failedEvent(piB));
    await a.invoice().then((i) => a.intent(i.id)); // pending

    const all = await a.call('get', '/v1/payments');
    expect(all.body.total).toBe(3);
    expect(all.body.items.map((p: { status: string }) => p.status).sort()).toEqual([
      'failed',
      'pending',
      'successful',
    ]);
    const ok = all.body.items.find((p: { status: string }) => p.status === 'successful');
    expect(ok).toMatchObject({
      invoiceNumber: paidInv.number,
      customerName: 'Acme Ltd',
      amountMinor: 100_000,
      currency: 'USD',
      method: 'card',
      stripePaymentIntentId: piA,
    });
    expect((await a.call('get', '/v1/payments?status=failed')).body.total).toBe(1);
    expect((await a.call('get', `/v1/payments?search=${paidInv.number}`)).body.total).toBe(1);
    expect((await a.call('get', '/v1/payments?search=acme')).body.total).toBe(3);
    expect((await a.call('get', '/v1/payments?search=%25')).body.total).toBe(0);
    expect((await a.call('get', '/v1/payments?status=bogus')).status).toBe(400);
    expect((await a.call('get', '/v1/payments?limit=1&offset=1')).body.items).toHaveLength(1);
  });

  it("never shows or exposes another account's payments", async () => {
    const a = await account();
    const b = await account();
    const inv = await a.invoice();
    const created = await a.intent(inv.id);
    expect((await b.call('get', '/v1/payments')).body.total).toBe(0);
    expect((await b.call('get', `/v1/payments/${created.body.paymentId}`)).status).toBe(404);
    expect((await a.call('get', `/v1/payments/${created.body.paymentId}`)).status).toBe(200);
    expect((await request(ctx.app).get('/v1/payments')).status).toBe(401);
  });
});

describe('customer pay page and public payment start', () => {
  const tokenOf = async (a: Awaited<ReturnType<typeof account>>, id: string) =>
    ((await a.call('post', `/v1/invoices/${id}/share-link`)).body.url as string).replace(
      'https://api.test/pay/',
      '',
    );

  it('starts a payment from the public link, including a partial amount', async () => {
    const a = await account();
    const inv = await a.invoice();
    const token = await tokenOf(a, inv.id);
    const res = await request(ctx.app)
      .post(`/public/invoices/${token}/payment-intent`)
      .send({ amountMinor: 25_000 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      amountMinor: 25_000,
      currency: 'USD',
      amountLabel: '$250.00',
    });
    expect(res.body.clientSecret).toMatch(/_secret_/);
    expect(res.headers['cache-control']).toBe('no-store');
    const over = await request(ctx.app)
      .post(`/public/invoices/${token}/payment-intent`)
      .send({ amountMinor: 100_001 });
    expect(over.body.error.code).toBe('AMOUNT_TOO_HIGH');
  });

  it('rejects unknown tokens, drafts and businesses without payouts', async () => {
    const a = await account();
    expect(
      (await request(ctx.app).post('/public/invoices/garbage/payment-intent').send({})).status,
    ).toBe(404);
    const draft = await a.invoice({}, false);
    const t = await tokenOf(a, draft.id);
    expect(
      (await request(ctx.app).post(`/public/invoices/${t}/payment-intent`).send({})).status,
    ).toBe(409);
    const b = await account(ctx, { payments: false });
    const inv = await b.invoice();
    const bt = await tokenOf(b, inv.id);
    expect(
      (await request(ctx.app).post(`/public/invoices/${bt}/payment-intent`).send({})).body.error
        .code,
    ).toBe('PAYMENTS_NOT_ENABLED');
  });

  it('rate-limits starting payments', async () => {
    const c = await buildDbApp({ PAYMENT_INTENT_RATE_LIMIT_PER_MINUTE: '2' });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++)
      statuses.push(
        (await request(c.app).post('/public/invoices/garbage/payment-intent').send({})).status,
      );
    expect(statuses).toEqual([404, 404, 429, 429]);
  });

  it('shows the Stripe payment UI under a CSP that allows only Stripe', async () => {
    const a = await account();
    const inv = await a.invoice();
    const token = await tokenOf(a, inv.id);
    const res = await request(ctx.app).get(`/pay/${token}`);
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("script-src 'nonce-");
    expect(csp).toContain('https://js.stripe.com');
    expect(csp).toContain('frame-src https://js.stripe.com');
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("script-src 'unsafe-inline'");
    expect(res.text).toContain('<script src="https://js.stripe.com/v3/"></script>');
    expect(res.text).toContain('id="pay-start"');
    expect(res.text).toContain('Pay a different amount');
    const cfg = JSON.parse(
      /<script type="application\/json" id="pay-config">(.*?)<\/script>/s.exec(res.text)![1]!,
    );
    expect(cfg).toMatchObject({
      publishableKey: 'pk_test_123',
      exponent: 2,
      balanceMinor: 100_000,
      paidMinor: 0,
      token,
    });
    // Exactly the scripts we expect: config (non-executable), Stripe.js, our nonce'd client, the view ping.
    expect((res.text.match(/<script/g) ?? []).length).toBe(4);
    const nonce = /nonce-([^']+)'/.exec(csp)![1];
    expect(res.text.split(`nonce="${nonce}"`).length - 1).toBe(2);
    expect(res.text).not.toMatch(/\son\w+=/i);
  });

  it('stays strict (no Stripe, instructions only) when the business cannot take cards', async () => {
    const b = await account(ctx, { payments: false });
    await b.call('put', '/v1/business').send({ paymentInstructions: 'E-transfer to pay@b.test' });
    const inv = await b.invoice();
    const res = await request(ctx.app).get(`/pay/${await tokenOf(b, inv.id)}`);
    expect(res.headers['content-security-policy']).not.toContain('stripe');
    expect(res.text).not.toContain('js.stripe.com');
    expect(res.text).toContain('E-transfer to pay@b.test');
    expect(res.text).not.toContain('id="pay-start"');
    const json = await request(ctx.app).get(`/public/invoices/${await tokenOf(b, inv.id)}`);
    expect(json.body.onlinePayments).toBe(false);
  });

  it('shows no payment UI once the invoice is paid, and reports online payments for payable ones', async () => {
    const a = await account();
    const inv = await a.invoice();
    const token = await tokenOf(a, inv.id);
    expect((await request(ctx.app).get(`/public/invoices/${token}`)).body.onlinePayments).toBe(
      true,
    );
    await a.intent(inv.id);
    const piId = [...ctx.stripe.state.intents.entries()].find(
      ([, p]) => p.params.metadata.invoice_id === inv.id,
    )![0];
    await hook(ctx, ctx.stripe.succeededEvent(piId));
    const page = await request(ctx.app).get(`/pay/${token}`);
    expect(page.text).toContain('Paid');
    expect(page.text).not.toContain('id="pay-start"');
    expect(page.headers['content-security-policy']).not.toContain('stripe');
    expect((await request(ctx.app).get(`/public/invoices/${token}`)).body).toMatchObject({
      payable: false,
      onlinePayments: false,
      amountPaidMinor: 100_000,
    });
  });

  it('the page script is valid JavaScript and handles money without floats', () => {
    expect(() => new Function(PAY_CLIENT_JS)).not.toThrow();
    expect(PAY_CLIENT_JS).not.toMatch(/parseFloat|toFixed|Math\.round/);
  });

  it('serves the Apple Pay domain file only when configured', async () => {
    expect(
      (await request(ctx.app).get('/.well-known/apple-developer-merchantid-domain-association'))
        .status,
    ).toBe(404);
    const c = await buildDbApp({ APPLE_PAY_DOMAIN_ASSOCIATION: 'abc123-association' });
    const res = await request(c.app).get(
      '/.well-known/apple-developer-merchantid-domain-association',
    );
    expect(res.status).toBe(200);
    expect(res.text).toBe('abc123-association');
  });
});
