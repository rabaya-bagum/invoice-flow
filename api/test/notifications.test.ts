import { randomUUID } from 'node:crypto';
import { addDays, todayInTimezone } from '@invoiceflow/shared';
import request from 'supertest';
import { buildDbApp, closePool, createUser } from './helpers';

type Ctx = Awaited<ReturnType<typeof buildDbApp>>;
let ctx: Ctx;
beforeAll(async () => {
  ctx = await buildDbApp();
});
afterAll(closePool);

const newToken = () => `ExponentPushToken[${randomUUID().replace(/-/g, '').slice(0, 22)}]`;

async function account(opts: { device?: boolean; timezone?: string } = { device: true }) {
  const user = await createUser();
  const auth = await ctx.bearer(user.id);
  const call = (m: 'get' | 'post' | 'put' | 'delete', url: string) =>
    request(ctx.app)[m](url).set('Authorization', auth);
  const token = newToken();
  if (opts.device !== false) await call('post', '/v1/push-tokens').send({ token, platform: 'ios' });
  if (opts.timezone) await call('put', '/v1/business').send({ timezone: opts.timezone });
  const customer = async (body: object = { companyName: 'Acme Ltd', email: 'billing@acme.test' }) =>
    (await call('post', '/v1/customers').send(body)).body.id as string;
  const invoice = async (over: object = {}, status: string | null = 'sent') => {
    const inv = (
      await call('post', '/v1/invoices').send({
        customerId: await customer(),
        issueDate: '2026-01-01',
        dueDate: '2026-12-31',
        currency: 'USD',
        items: [{ description: 'Work', quantityMilli: 1000, unitPriceMinor: 100_000, taxes: [] }],
        ...over,
      })
    ).body as { id: string; number: string };
    if (status === 'sent')
      await call('post', `/v1/invoices/${inv.id}/transition`).send({ to: 'sent' });
    return inv;
  };
  const notifications = async () => (await call('get', '/v1/notifications')).body;
  /** Delivered push messages for THIS account's device. */
  const pushed = () => ctx.push.batches.flat().filter((m) => m.to === token);
  return { user, auth, call, token, customer, invoice, notifications, pushed };
}

const dispatchAll = () => ctx.notifications.dispatchPending(10_000);

describe('push token registration', () => {
  it('registers a device and is idempotent', async () => {
    const a = await account({ device: false });
    const token = newToken();
    expect(
      (await a.call('post', '/v1/push-tokens').send({ token, platform: 'android' })).status,
    ).toBe(204);
    expect((await a.call('post', '/v1/push-tokens').send({ token, platform: 'ios' })).status).toBe(
      204,
    );
    const rows = await ctx.db.query('SELECT user_id, platform FROM push_tokens WHERE token = $1', [
      token,
    ]);
    expect(rows.rows).toEqual([{ user_id: a.user.id, platform: 'ios' }]);
  });

  it('moves a device to whoever signed in last', async () => {
    const a = await account({ device: false });
    const b = await account({ device: false });
    const token = newToken();
    await a.call('post', '/v1/push-tokens').send({ token, platform: 'ios' });
    await b.call('post', '/v1/push-tokens').send({ token, platform: 'ios' });
    expect(
      (await ctx.db.query('SELECT user_id FROM push_tokens WHERE token = $1', [token])).rows[0]
        .user_id,
    ).toBe(b.user.id);
  });

  it.each([
    ['not an expo token', { token: 'abcdefghijklmnop', platform: 'ios' }],
    ['script in token', { token: 'ExponentPushToken[<script>]', platform: 'ios' }],
    ['bad platform', { token: newToken(), platform: 'windows' }],
    ['missing token', { platform: 'ios' }],
  ])('rejects %s', async (_n, body) => {
    const a = await account({ device: false });
    expect((await a.call('post', '/v1/push-tokens').send(body)).status).toBe(400);
  });

  it("removes only the caller's own token and requires login", async () => {
    const a = await account();
    const b = await account();
    expect((await a.call('delete', '/v1/push-tokens').send({ token: b.token })).status).toBe(204); // not theirs: no effect
    expect(
      (await ctx.db.query('SELECT 1 FROM push_tokens WHERE token = $1', [b.token])).rowCount,
    ).toBe(1);
    expect((await a.call('delete', '/v1/push-tokens').send({ token: a.token })).status).toBe(204);
    expect(
      (await ctx.db.query('SELECT 1 FROM push_tokens WHERE token = $1', [a.token])).rowCount,
    ).toBe(0);
    expect(
      (await request(ctx.app).post('/v1/push-tokens').send({ token: newToken(), platform: 'ios' }))
        .status,
    ).toBe(401);
  });
});

describe('notifications for invoice events', () => {
  it('invoice sent', async () => {
    const a = await account();
    const inv = await a.invoice({}, null);
    await a.call('post', `/v1/invoices/${inv.id}/send`).send({});
    await dispatchAll();
    expect(a.pushed()).toEqual([
      expect.objectContaining({
        title: 'Invoice sent',
        body: `Invoice ${inv.number} was sent to Acme Ltd.`,
        data: expect.objectContaining({ invoiceId: inv.id }),
      }),
    ]);
  });

  it('invoice viewed, exactly once', async () => {
    const a = await account();
    const inv = await a.invoice({}, null);
    await a.call('post', `/v1/invoices/${inv.id}/send`).send({});
    const url = (await a.call('post', `/v1/invoices/${inv.id}/share-link`)).body.url as string;
    const token = url.replace('https://api.test/pay/', '');
    await request(ctx.app).post(`/public/invoices/${token}/view`);
    await request(ctx.app).post(`/public/invoices/${token}/view`);
    await dispatchAll();
    const viewed = a.pushed().filter((m) => m.title === 'Invoice viewed');
    expect(viewed).toHaveLength(1);
    expect(viewed[0]!.body).toBe(`Invoice ${inv.number} has been viewed by Acme Ltd.`);
  });

  it('is stored in the notification centre with the push payload data', async () => {
    const a = await account();
    const inv = await a.invoice({}, null);
    await a.call('post', `/v1/invoices/${inv.id}/send`).send({});
    const list = await a.notifications();
    expect(list.items[0]).toMatchObject({
      type: 'invoice_sent',
      title: 'Invoice sent',
      readAt: null,
      data: { invoiceId: inv.id },
    });
  });
});

describe('notifications for payments', () => {
  async function payable(a: Awaited<ReturnType<typeof account>>) {
    const onboard = await a.call('post', '/v1/payments/connect/onboard');
    if (!onboard.body.url)
      throw new Error(`onboarding failed: ${onboard.status} ${JSON.stringify(onboard.body)}`);
    const acct = /acct_\d+/.exec(onboard.body.url)![0];
    ctx.stripe.state.accounts.get(acct)!.chargesEnabled = true;
    await a.call('get', '/v1/payments/connect/status');
    return a.invoice();
  }
  const hook = (ev: { body: string; signature: string }) =>
    request(ctx.app)
      .post('/v1/payments/webhook')
      .set('stripe-signature', ev.signature)
      .set('Content-Type', 'application/json')
      .send(ev.body);
  const piFor = async (
    a: Awaited<ReturnType<typeof account>>,
    invoiceId: string,
    amount?: number,
  ) => {
    const res = await a
      .call('post', '/v1/payments/create-intent')
      .send({ invoiceId, ...(amount ? { amountMinor: amount } : {}) });
    return [...ctx.stripe.state.intents.entries()].find(
      ([, p]) => p.clientSecret === res.body.clientSecret,
    )![0];
  };

  it('payment received and invoice paid', async () => {
    const a = await account();
    const inv = await payable(a);
    await hook(ctx.stripe.succeededEvent(await piFor(a, inv.id)));
    await dispatchAll();
    expect(a.pushed()).toEqual([
      expect.objectContaining({
        title: 'Invoice paid',
        body: `Payment of $1,000.00 received for ${inv.number}.`,
      }),
    ]);
  });

  it('partial payment received', async () => {
    const a = await account();
    const inv = await payable(a);
    await hook(ctx.stripe.succeededEvent(await piFor(a, inv.id, 40_000)));
    await dispatchAll();
    expect(a.pushed()).toEqual([
      expect.objectContaining({
        title: 'Partial payment received',
        body: `Payment of $400.00 received for ${inv.number}.`,
      }),
    ]);
  });

  it('payment failed', async () => {
    const a = await account();
    const inv = await payable(a);
    await hook(ctx.stripe.failedEvent(await piFor(a, inv.id)));
    await dispatchAll();
    expect(a.pushed()).toEqual([
      expect.objectContaining({
        title: 'Payment failed',
        body: `Payment of $1,000.00 failed for ${inv.number}.`,
      }),
    ]);
  });
});

describe('overdue sweep', () => {
  const dueMakers = async (a: Awaited<ReturnType<typeof account>>, today: string) => {
    const make = async (dueDate: string, status: string | null, patch = '') => {
      const inv = await a.invoice({ dueDate }, status === 'draft' ? null : 'sent');
      if (status && status !== 'draft' && status !== 'sent')
        await ctx.db.query(`UPDATE invoices SET status = '${status}' ${patch} WHERE id = $1`, [
          inv.id,
        ]);
      return inv;
    };
    return { make, yesterday: addDays(today, -1), today };
  };

  it('notifies once per invoice, with activity, in the business timezone', async () => {
    const tz = 'Pacific/Kiritimati';
    const a = await account({ timezone: tz });
    const { make, yesterday } = await dueMakers(a, todayInTimezone(tz));
    const late = await make(yesterday, 'sent');
    expect(await ctx.overdue.sweep()).toBeGreaterThanOrEqual(1);
    const n = (await a.notifications()).items.filter(
      (x: { type: string }) => x.type === 'invoice_overdue',
    );
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({
      title: 'Invoice overdue',
      body: `Invoice ${late.number} for Acme Ltd is now overdue ($1,000.00 due).`,
      data: { invoiceId: late.id },
    });
    const types = (await a.call('get', `/v1/invoices/${late.id}/activity`)).body.items.map(
      (x: { type: string }) => x.type,
    );
    expect(types).toEqual(['created', 'sent', 'overdue']);
    await ctx.overdue.sweep(); // nothing new
    expect(
      (await a.notifications()).items.filter((x: { type: string }) => x.type === 'invoice_overdue'),
    ).toHaveLength(1);
    await dispatchAll();
    expect(a.pushed().filter((m) => m.title === 'Invoice overdue')).toHaveLength(1);
  });

  it('skips drafts, cancelled, paid, due-today and future invoices; includes viewed and partially paid', async () => {
    const tz = 'UTC';
    const a = await account({ timezone: tz });
    const { make, yesterday, today } = await dueMakers(a, todayInTimezone(tz));
    const skip = [
      await make(yesterday, 'draft'),
      await make(yesterday, 'cancelled'),
      await make(yesterday, 'paid', ', amount_paid_minor = total_minor'),
      await make(today, 'sent'),
      await make(addDays(today, 5), 'sent'),
    ];
    const include = [
      await make(yesterday, 'viewed'),
      await make(yesterday, 'partially_paid', ', amount_paid_minor = 5000'),
    ];
    await ctx.overdue.sweep();
    const flagged = (
      await ctx.db.query(
        'SELECT id FROM invoices WHERE business_id = (SELECT business_id FROM invoices WHERE id = $1) AND overdue_notified_due_date IS NOT NULL',
        [include[0]!.id],
      )
    ).rows.map((r) => r.id);
    expect(flagged.sort()).toEqual(include.map((i) => i.id).sort());
    for (const s of skip) expect(flagged).not.toContain(s.id);
    const partial = (await a.notifications()).items.find(
      (x: { data: { invoiceId: string } }) => x.data.invoiceId === include[1]!.id,
    );
    expect(partial.body).toContain('($950.00 due)'); // the remaining balance, not the total
  });

  it("uses each business's own timezone", async () => {
    const ahead = await account({ timezone: 'Pacific/Kiritimati' }); // UTC+14
    const behind = await account({ timezone: 'Etc/GMT+12' }); // UTC-12
    const dueDate = addDays(todayInTimezone('Pacific/Kiritimati'), -1); // overdue only where it is already "tomorrow"
    const a1 = await ahead.invoice({ dueDate });
    const b1 = await behind.invoice({ dueDate });
    await ctx.overdue.sweep();
    const flagged = async (id: string) =>
      (
        await ctx.db.query('SELECT overdue_notified_due_date AS d FROM invoices WHERE id = $1', [
          id,
        ])
      ).rows[0].d;
    expect(await flagged(a1.id)).toBe(dueDate);
    expect(await flagged(b1.id)).toBeNull();
  });

  it('notifies again if the due date changes and the invoice goes overdue again', async () => {
    const a = await account({ timezone: 'UTC' });
    const today = todayInTimezone('UTC');
    const inv = await a.invoice({ dueDate: addDays(today, -3) });
    await ctx.overdue.sweep();
    await ctx.db.query('UPDATE invoices SET due_date = $2 WHERE id = $1', [
      inv.id,
      addDays(today, -1),
    ]); // extended, but still past
    await ctx.overdue.sweep();
    expect(
      (await a.notifications()).items.filter((x: { type: string }) => x.type === 'invoice_overdue'),
    ).toHaveLength(2);
  });

  it('does not double-notify when sweeps run at the same time', async () => {
    const a = await account({ timezone: 'UTC' });
    const inv = await a.invoice({ dueDate: addDays(todayInTimezone('UTC'), -2) });
    await Promise.all(Array.from({ length: 5 }, () => ctx.overdue.sweep()));
    const n = (await a.notifications()).items.filter(
      (x: { data: { invoiceId?: string } }) => x.data.invoiceId === inv.id,
    );
    expect(n.filter((x: { type: string }) => x.type === 'invoice_overdue')).toHaveLength(1);
  });

  it('works through large backlogs in batches', async () => {
    const a = await account({ timezone: 'UTC' });
    const ids = [];
    for (let i = 0; i < 5; i++)
      ids.push((await a.invoice({ dueDate: addDays(todayInTimezone('UTC'), -2) })).id);
    expect(await ctx.overdue.sweep(2)).toBeGreaterThanOrEqual(5);
    const flagged = await ctx.db.query(
      'SELECT count(*) AS n FROM invoices WHERE id = ANY($1::uuid[]) AND overdue_notified_due_date IS NOT NULL',
      [ids],
    );
    expect(flagged.rows[0].n).toBe(5);
  });
});

describe('push delivery', () => {
  const send = async (a: Awaited<ReturnType<typeof account>>) => {
    const inv = await a.invoice({}, null);
    await a.call('post', `/v1/invoices/${inv.id}/send`).send({});
    return inv;
  };
  const rowFor = async (a: Awaited<ReturnType<typeof account>>) =>
    (
      await ctx.db.query(
        'SELECT push_sent_at, push_attempts, push_error FROM notifications WHERE business_id = (SELECT id FROM business_profiles WHERE owner_id = $1) ORDER BY created_at DESC LIMIT 1',
        [a.user.id],
      )
    ).rows[0];

  it('marks notifications with no registered device as done without calling the provider', async () => {
    const a = await account({ device: false });
    const inv = await send(a);
    await dispatchAll();
    // Nothing is sent for this invoice: the owner has no registered device.
    expect(
      ctx.push.batches.flat().some((m) => (m.data as { invoiceId?: string }).invoiceId === inv.id),
    ).toBe(false);
    expect(await rowFor(a)).toMatchObject({ push_error: 'no_devices' });
    expect((await rowFor(a)).push_sent_at).not.toBeNull();
  });

  it('sends to every device of the owner and only to the owner', async () => {
    const a = await account();
    const other = await account(); // someone else's device must never receive it
    const second = newToken();
    await a.call('post', '/v1/push-tokens').send({ token: second, platform: 'android' });
    await send(a);
    await dispatchAll();
    const batch = ctx.push.batches.find((b) => b.some((m) => m.to === a.token))!;
    expect(batch.map((m) => m.to).sort()).toEqual([a.token, second].sort());
    expect(other.pushed()).toHaveLength(0);
    expect(batch[0]!.data).toHaveProperty('notificationId');
  });

  it('delivers each notification only once, even with parallel dispatchers', async () => {
    const a = await account();
    await send(a);
    await Promise.all([dispatchAll(), dispatchAll(), dispatchAll()]);
    await dispatchAll();
    expect(a.pushed()).toHaveLength(1);
  });

  it('removes dead device tokens and keeps working ones', async () => {
    const a = await account();
    const alive = newToken();
    await a.call('post', '/v1/push-tokens').send({ token: alive, platform: 'android' });
    ctx.push.errors[a.token] = 'DeviceNotRegistered';
    await send(a);
    await dispatchAll();
    delete ctx.push.errors[a.token];
    const tokens = (
      await ctx.db.query('SELECT token FROM push_tokens WHERE user_id = $1', [a.user.id])
    ).rows.map((r) => r.token);
    expect(tokens).toEqual([alive]);
    expect((await rowFor(a)).push_error).toBeNull(); // delivered to the live device
  });

  it('records a notification whose every device is gone', async () => {
    const a = await account();
    ctx.push.errors[a.token] = 'DeviceNotRegistered';
    await send(a);
    await dispatchAll();
    delete ctx.push.errors[a.token];
    expect(await rowFor(a)).toMatchObject({ push_error: 'device_not_registered' });
    expect(
      (await ctx.db.query('SELECT 1 FROM push_tokens WHERE user_id = $1', [a.user.id])).rowCount,
    ).toBe(0);
  });

  it('retries after a provider outage and gives up after 5 attempts', async () => {
    const a = await account();
    await send(a);
    ctx.push.fail = new Error('push provider unreachable');
    try {
      await dispatchAll();
      expect(await rowFor(a)).toMatchObject({
        push_attempts: 1,
        push_sent_at: null,
        push_error: 'push provider unreachable',
      });
    } finally {
      ctx.push.fail = null;
    }
    await dispatchAll(); // provider is back
    expect(a.pushed()).toHaveLength(1);
    expect((await rowFor(a)).push_sent_at).not.toBeNull();

    const b = await account();
    await send(b);
    ctx.push.fail = new Error('down');
    try {
      for (let i = 0; i < 6; i++) await dispatchAll();
    } finally {
      ctx.push.fail = null;
    }
    const row = await rowFor(b);
    expect(row.push_attempts).toBe(5);
    expect(row.push_sent_at).not.toBeNull(); // gave up: no endless retries
    expect(row.push_error).toBe('down');
  });
});

describe('notification centre API', () => {
  it('lists newest first with unread counts, filters, pages, and marks read', async () => {
    const a = await account({ device: false });
    for (let i = 0; i < 3; i++)
      await a
        .invoice({}, null)
        .then((inv) => a.call('post', `/v1/invoices/${inv.id}/send`).send({}));
    const all = await a.notifications();
    expect(all.total).toBe(3);
    expect(all.unread).toBe(3);
    expect(all.items.map((x: { createdAt: string }) => x.createdAt)).toEqual(
      [...all.items.map((x: { createdAt: string }) => x.createdAt)].sort().reverse(),
    );

    expect((await a.call('post', `/v1/notifications/${all.items[0].id}/read`)).status).toBe(204);
    expect((await a.call('post', `/v1/notifications/${all.items[0].id}/read`)).status).toBe(204); // idempotent
    const after = await a.notifications();
    expect(after.unread).toBe(2);
    expect((await a.call('get', '/v1/notifications?unread=true')).body.items).toHaveLength(2);
    expect((await a.call('get', '/v1/notifications?limit=1&offset=1')).body.items).toHaveLength(1);

    expect((await a.call('post', '/v1/notifications/read-all')).body.updated).toBe(2);
    expect((await a.notifications()).unread).toBe(0);
  });

  it("never shows or changes another account's notifications", async () => {
    const a = await account({ device: false });
    const b = await account({ device: false });
    const inv = await a.invoice({}, null);
    await a.call('post', `/v1/invoices/${inv.id}/send`).send({});
    const id = (await a.notifications()).items[0].id;
    expect((await b.notifications()).total).toBe(0);
    expect((await b.call('post', `/v1/notifications/${id}/read`)).status).toBe(404);
    expect((await b.call('post', '/v1/notifications/read-all')).body.updated).toBe(0);
    expect((await a.notifications()).unread).toBe(1);
    expect((await request(ctx.app).get('/v1/notifications')).status).toBe(401);
    expect((await a.call('get', '/v1/notifications?limit=1000')).status).toBe(400);
  });
});

describe('overdue sweep: many at once', () => {
  it('sends one summary instead of a push per invoice, but every invoice gets its timeline entry', async () => {
    const a = await account();
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const inv = await a.invoice({ dueDate: addDays(todayInTimezone('UTC'), -3) });
      ids.push(inv.id);
    }
    await ctx.overdue.sweep();
    const notes = (await a.notifications()).items.filter(
      (x: { type: string }) => x.type === 'invoices_overdue' || x.type === 'invoice_overdue',
    );
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ type: 'invoices_overdue', title: 'Invoices overdue' });
    expect(notes[0].body).toContain('8 invoices are now overdue');
    for (const id of ids) {
      const types = (await a.call('get', `/v1/invoices/${id}/activity`)).body.items.map(
        (x: { type: string }) => x.type,
      );
      expect(types).toContain('overdue');
    }
    await dispatchAll();
    expect(a.pushed().filter((m) => m.title === 'Invoices overdue')).toHaveLength(1);
    expect(a.pushed().filter((m) => m.title === 'Invoice overdue')).toHaveLength(0);
  });

  it('keeps individual notifications for a handful', async () => {
    const a = await account();
    for (let i = 0; i < 3; i++) await a.invoice({ dueDate: addDays(todayInTimezone('UTC'), -2) });
    await ctx.overdue.sweep();
    const notes = (await a.notifications()).items.filter(
      (x: { type: string }) => x.type === 'invoice_overdue',
    );
    expect(notes).toHaveLength(3);
  });
});
