import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { buildDbApp, closePool, createUser } from './helpers';

let ctx: Awaited<ReturnType<typeof buildDbApp>>;
beforeAll(async () => {
  ctx = await buildDbApp();
});
afterAll(closePool);

async function account() {
  const user = await createUser();
  const auth = await ctx.bearer(user.id);
  const call = (m: 'get' | 'post' | 'put' | 'delete', url: string) =>
    request(ctx.app)[m](url).set('Authorization', auth);
  const customerId = (await call('post', '/v1/customers').send({ companyName: 'Acme' })).body.id;
  const body = (over: object = {}) => ({
    customerId,
    issueDate: '2026-10-01',
    dueDate: '2026-10-15',
    currency: 'USD',
    items: [{ description: 'Work', quantityMilli: 1000, unitPriceMinor: 10_000, taxes: [] }],
    ...over,
  });
  return { user, call, body, customerId };
}

describe('client-generated invoice ids (offline drafts)', () => {
  it('creates the invoice under the id the client chose', async () => {
    const a = await account();
    const id = randomUUID();
    const res = await a.call('post', '/v1/invoices').send(a.body({ id }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ id, status: 'draft', number: 'INV-0001' });
    expect((await a.call('get', `/v1/invoices/${id}`)).status).toBe(200);
  });

  it('still generates an id when none is sent', async () => {
    const a = await account();
    const res = await a.call('post', '/v1/invoices').send(a.body());
    expect(res.status).toBe(201);
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('never makes two invoices from the same id, and burns no number on the retry', async () => {
    const a = await account();
    const id = randomUUID();
    expect((await a.call('post', '/v1/invoices').send(a.body({ id }))).status).toBe(201);
    const again = await a.call('post', '/v1/invoices').send(a.body({ id }));
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ID_TAKEN');
    const next = await a.call('post', '/v1/invoices').send(a.body());
    expect(next.body.number).toBe('INV-0002');
    expect((await a.call('get', '/v1/invoices')).body.total).toBe(2);
  });

  it("answers the same way for another business's id, and does not touch it", async () => {
    const a = await account();
    const b = await account();
    const id = randomUUID();
    await a.call('post', '/v1/invoices').send(a.body({ id }));
    const res = await b.call('post', '/v1/invoices').send(b.body({ id }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ID_TAKEN');
    expect((await b.call('get', `/v1/invoices/${id}`)).status).toBe(404);
    expect((await b.call('get', '/v1/invoices')).body.total).toBe(0);
  });

  it('creates exactly one when the same id arrives twice at once', async () => {
    const a = await account();
    const id = randomUUID();
    const out = await Promise.all([
      a.call('post', '/v1/invoices').send(a.body({ id })),
      a.call('post', '/v1/invoices').send(a.body({ id })),
      a.call('post', '/v1/invoices').send(a.body({ id })),
    ]);
    expect(out.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect((await a.call('get', '/v1/invoices')).body.total).toBe(1);
  });

  it('rejects ids that are not UUIDs, and ignores an id on update', async () => {
    const a = await account();
    expect((await a.call('post', '/v1/invoices').send(a.body({ id: 'abc' }))).status).toBe(400);
    expect((await a.call('post', '/v1/invoices').send(a.body({ id: 42 }))).status).toBe(400);
    const made = (await a.call('post', '/v1/invoices').send(a.body())).body;
    const other = randomUUID();
    const upd = await a.call('put', `/v1/invoices/${made.id}`).send(a.body({ id: other }));
    expect(upd.status).toBe(200);
    expect(upd.body.id).toBe(made.id);
    expect((await a.call('get', `/v1/invoices/${other}`)).status).toBe(404);
  });

  it('keeps all the usual checks for a client-id create', async () => {
    const a = await account();
    const id = randomUUID();
    const badCustomer = await a
      .call('post', '/v1/invoices')
      .send(a.body({ id, customerId: randomUUID() }));
    expect(badCustomer.status).toBe(422);
    // A failed create leaves the id free for the corrected retry.
    expect((await a.call('post', '/v1/invoices').send(a.body({ id }))).status).toBe(201);
    await a.call('post', '/v1/invoices').send(a.body({ number: 'MINE-1' }));
    const dup = await a
      .call('post', '/v1/invoices')
      .send(a.body({ id: randomUUID(), number: 'MINE-1' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('NUMBER_EXISTS');
  });

  it('the estimate conversion path still creates invoices with generated ids', async () => {
    const a = await account();
    const est = (
      await a.call('post', '/v1/estimates').send({
        customerId: a.customerId,
        issueDate: '2026-10-01',
        expiryDate: '2026-11-01',
        currency: 'USD',
        items: [{ description: 'x', quantityMilli: 1000, unitPriceMinor: 100, taxes: [] }],
      })
    ).body;
    expect((await a.call('post', `/v1/estimates/${est.id}/convert`)).status).toBe(201);
  });
});

describe('client-generated estimate ids (offline drafts)', () => {
  const est = (a: Awaited<ReturnType<typeof account>>, over: object = {}) => ({
    customerId: a.customerId,
    issueDate: '2026-10-01',
    expiryDate: '2026-11-01',
    currency: 'USD',
    items: [{ description: 'Work', quantityMilli: 1000, unitPriceMinor: 10_000, taxes: [] }],
    ...over,
  });

  it('creates under the chosen id, never twice, and answers alike for another business', async () => {
    const a = await account();
    const b = await account();
    const id = randomUUID();
    const ok = await a.call('post', '/v1/estimates').send(est(a, { id }));
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ id, number: 'EST-0001' });
    const again = await a.call('post', '/v1/estimates').send(est(a, { id }));
    expect([again.status, again.body.error.code]).toEqual([409, 'ID_TAKEN']);
    const other = await b.call('post', '/v1/estimates').send(est(b, { id }));
    expect([other.status, other.body.error.code]).toEqual([409, 'ID_TAKEN']);
    expect((await b.call('get', `/v1/estimates/${id}`)).status).toBe(404);
    expect((await a.call('get', '/v1/estimates')).body.total).toBe(1);
  });

  it('creates exactly one when the same id arrives at once, and rejects non-UUIDs', async () => {
    const a = await account();
    const id = randomUUID();
    const out = await Promise.all(
      [1, 2, 3].map(() => a.call('post', '/v1/estimates').send(est(a, { id }))),
    );
    expect(out.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect((await a.call('post', '/v1/estimates').send(est(a, { id: 'abc' }))).status).toBe(400);
  });
});
