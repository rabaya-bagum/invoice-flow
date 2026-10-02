import type { InvoiceWriteInput } from '@invoiceflow/shared';
import { serverHasContent } from '../src/offline/compare';
import {
  attentionCount,
  copyAsNew,
  findOp,
  pendingCount,
  queueDelete,
  queueSave,
  requeue,
} from '../src/offline/outbox';
import { processOutbox, rebase, type SyncApi } from '../src/offline/sync';
import type { DraftOp, DraftSummary } from '../src/offline/types';
import { ApiError } from '../src/services/api';
import { CUSTOMER_ID, invoiceDetail } from '../test-utils';

const payload = (over: Partial<InvoiceWriteInput> = {}): InvoiceWriteInput =>
  ({
    customerId: CUSTOMER_ID,
    number: null,
    issueDate: '2026-10-01',
    dueDate: '2026-10-15',
    currency: 'USD',
    taxInclusive: false,
    discount: null,
    feesMinor: 0,
    notes: null,
    terms: null,
    items: [
      {
        productId: null,
        description: 'Web Development',
        quantityMilli: 10_000,
        unitPriceMinor: 10_000,
        taxes: [{ name: 'GST', rateBps: 500 }],
      },
    ],
    ...over,
  }) as InvoiceWriteInput;

const summary: DraftSummary = {
  customerName: 'Acme Ltd',
  currency: 'USD',
  totalMinor: 105_000,
  number: null,
};
const t = (n: number) => `2026-10-01T10:00:0${n}.000Z`;
const err = (kind: ConstructorParameters<typeof ApiError>[0], status?: number, code?: string) =>
  new ApiError(kind, status, code);

const server = (over: Record<string, unknown> = {}) =>
  invoiceDetail({
    id: 'inv-1',
    status: 'draft',
    displayStatus: 'draft',
    editable: true,
    ...over,
  }) as never;

function fakeApi(over: Partial<Record<keyof SyncApi, jest.Mock>> = {}) {
  const api = {
    createInvoice: jest.fn(async () => server()),
    updateInvoice: jest.fn(async () => server()),
    deleteInvoice: jest.fn(async () => undefined),
    getInvoice: jest.fn(async () => server()),
    ...over,
  };
  return api as typeof api & SyncApi;
}

const newOp = (id = 'new-1', now = t(0)) =>
  queueSave(
    [],
    { invoiceId: id, isNew: true, payload: payload(), baseVersion: null, summary },
    now,
  );
const editOp = (id = 'inv-1', base = 2) =>
  queueSave(
    [],
    { invoiceId: id, isNew: false, payload: payload(), baseVersion: base, summary },
    t(0),
  );

describe('outbox', () => {
  it('coalesces edits into one op that keeps the first base version and queue time', () => {
    let ops = editOp('inv-1', 2);
    ops = queueSave(
      ops,
      {
        invoiceId: 'inv-1',
        isNew: false,
        payload: payload({ notes: 'second' }),
        baseVersion: 7,
        summary,
      },
      t(5),
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      baseVersion: 2,
      queuedAt: t(0),
      updatedAt: t(5),
      state: 'pending',
    });
    expect(ops[0]!.payload!.notes).toBe('second');
  });

  it('keeps a created-offline draft marked as new through later edits', () => {
    let ops = newOp();
    ops = queueSave(
      ops,
      { invoiceId: 'new-1', isNew: false, payload: payload(), baseVersion: 3, summary },
      t(4),
    );
    expect(ops[0]).toMatchObject({ isNew: true, baseVersion: null });
  });

  it('orders by when the change was first queued', () => {
    let ops = newOp('a', t(5));
    ops = queueSave(
      ops,
      { invoiceId: 'b', isNew: true, payload: payload(), baseVersion: null, summary },
      t(1),
    );
    expect(ops.map((o) => o.invoiceId)).toEqual(['b', 'a']);
  });

  it('turns a queued save into a delete, and an edit after a delete into a fresh save', () => {
    let ops = newOp();
    ops = queueDelete(ops, { invoiceId: 'new-1', isNew: true, summary }, t(2));
    expect(ops[0]).toMatchObject({ payload: null, isNew: true });
    ops = queueSave(
      ops,
      { invoiceId: 'new-1', isNew: false, payload: payload(), baseVersion: 1, summary },
      t(3),
    );
    expect(ops[0]).toMatchObject({ isNew: false, baseVersion: 1 });
    expect(ops[0]!.payload).not.toBeNull();
  });

  it('counts waiting and needs-attention separately', () => {
    const ops: DraftOp[] = [
      ...newOp('a'),
      { ...newOp('b')[0]!, state: 'conflict' },
      { ...newOp('c')[0]!, state: 'failed' },
    ];
    expect(pendingCount(ops)).toBe(1);
    expect(attentionCount(ops)).toBe(2);
  });

  it('copies an op to a new draft with a fresh id and automatic number', () => {
    const base = queueSave(
      [],
      {
        invoiceId: 'inv-1',
        isNew: false,
        payload: payload({ number: 'MINE-7', version: 4 }),
        baseVersion: 4,
        summary: { ...summary, number: 'MINE-7' },
      },
      t(0),
    );
    const ops = copyAsNew(requeue(base, 'inv-1'), 'inv-1', 'copy-9', t(8));
    expect(findOp(ops, 'inv-1')).toBeUndefined();
    expect(findOp(ops, 'copy-9')).toMatchObject({
      isNew: true,
      baseVersion: null,
      state: 'pending',
      summary: { number: null },
    });
    expect(findOp(ops, 'copy-9')!.payload).toMatchObject({ number: null });
    expect(findOp(ops, 'copy-9')!.payload!.version).toBeUndefined();
  });
});

describe('serverHasContent', () => {
  it('matches identical content and ignores whitespace-only note differences', () => {
    expect(serverHasContent(server(), payload())).toBe(true);
    expect(serverHasContent(server({ notes: ' hi ' }), payload({ notes: 'hi' }))).toBe(true);
  });
  it.each([
    ['dueDate', { dueDate: '2026-11-01' }],
    ['fees', { feesMinor: 5 }],
    ['discount', { discount: { type: 'percent', value: 500 } }],
    ['number', { number: 'OTHER-1' }],
    ['items', { items: [] }],
  ])('differs when %s differs', (_n, over) => {
    expect(serverHasContent(server(), payload(over as never))).toBe(false);
  });
});

describe('processOutbox: creating', () => {
  it('uploads a new draft under its own id and clears it from the queue', async () => {
    const api = fakeApi();
    const r = await processOutbox(api, newOp('new-1'));
    expect(api.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'new-1', customerId: CUSTOMER_ID }),
    );
    expect(r).toMatchObject({ ops: [], synced: ['new-1'], stopped: null });
  });

  it('stops quietly when offline and keeps everything queued, counting the attempt', async () => {
    const api = fakeApi({
      createInvoice: jest.fn(async () => {
        throw err('network');
      }),
    });
    const ops = [...newOp('a', t(0)), ...newOp('b', t(1))];
    const r = await processOutbox(api, ops);
    expect(r.stopped).toBe('offline');
    expect(api.createInvoice).toHaveBeenCalledTimes(1); // did not hammer the second one
    expect(r.ops.map((o) => [o.invoiceId, o.state, o.attempts])).toEqual([
      ['a', 'pending', 1],
      ['b', 'pending', 0],
    ]);
  });

  it('treats server trouble and rate limits as "try later"', async () => {
    for (const kind of ['server', 'rate_limited'] as const) {
      const api = fakeApi({
        createInvoice: jest.fn(async () => {
          throw err(kind, 503);
        }),
      });
      expect((await processOutbox(api, newOp())).stopped).toBe('busy');
    }
  });

  it('stops for auth when the session has ended, without losing the draft', async () => {
    const api = fakeApi({
      createInvoice: jest.fn(async () => {
        throw err('session_expired', 401);
      }),
    });
    const r = await processOutbox(api, newOp());
    expect(r.stopped).toBe('auth');
    expect(r.ops).toHaveLength(1);
  });

  it('recovers when an earlier attempt already created it (reply lost): same content is done', async () => {
    const api = fakeApi({
      createInvoice: jest.fn(async () => {
        throw err('unknown', 409, 'ID_TAKEN');
      }),
    });
    const r = await processOutbox(api, newOp('inv-1'));
    expect(api.getInvoice).toHaveBeenCalledWith('inv-1');
    expect(api.updateInvoice).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ops: [], synced: ['inv-1'] });
  });

  it('updates the already-created draft when the user edited after the lost reply', async () => {
    const api = fakeApi({
      createInvoice: jest.fn(async () => {
        throw err('unknown', 409, 'ID_TAKEN');
      }),
      getInvoice: jest.fn(async () => server({ notes: 'older text', version: 5 })),
    });
    const r = await processOutbox(api, newOp('inv-1'));
    expect(api.updateInvoice).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({ version: 5 }),
    );
    expect(r.ops).toEqual([]);
  });

  it('flags a locked invoice behind a reused id instead of overwriting it', async () => {
    const api = fakeApi({
      createInvoice: jest.fn(async () => {
        throw err('unknown', 409, 'ID_TAKEN');
      }),
      getInvoice: jest.fn(async () => server({ status: 'paid', editable: false, notes: 'x' })),
    });
    const r = await processOutbox(api, newOp('inv-1'));
    expect(r.ops[0]).toMatchObject({ state: 'conflict', problem: { code: 'locked' } });
    expect(api.updateInvoice).not.toHaveBeenCalled();
  });

  it.each([
    ['NUMBER_EXISTS', /number is already used/],
    ['INVALID_CUSTOMER', /customer was deleted/],
    ['INVALID_PRODUCT', /products was deleted/],
  ])(
    'marks a refused draft as failed with a plain reason (%s) and carries on',
    async (code, text) => {
      const api = fakeApi({
        createInvoice: jest
          .fn()
          .mockRejectedValueOnce(err('unknown', 409, code))
          .mockResolvedValueOnce(server()),
      });
      const r = await processOutbox(api, [...newOp('a', t(0)), ...newOp('b', t(1))]);
      expect(r.ops).toHaveLength(1);
      expect(r.ops[0]).toMatchObject({ invoiceId: 'a', state: 'failed' });
      expect(r.ops[0]!.problem!.message).toMatch(text);
      expect(r.synced).toEqual(['b']);
    },
  );

  it('skips ops that are waiting for the user', async () => {
    const api = fakeApi();
    const [op] = newOp('a');
    const r = await processOutbox(api, [{ ...op!, state: 'conflict' }]);
    expect(api.createInvoice).not.toHaveBeenCalled();
    expect(r.ops).toHaveLength(1);
  });
});

describe('processOutbox: editing', () => {
  it('sends the version the edit started from', async () => {
    const api = fakeApi();
    const r = await processOutbox(api, editOp('inv-1', 4));
    expect(api.updateInvoice).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({ version: 4 }),
    );
    expect(r.ops).toEqual([]);
  });

  it('is a conflict when the server copy moved on with different content', async () => {
    const api = fakeApi({
      updateInvoice: jest.fn(async () => {
        throw err('unknown', 409, 'VERSION_CONFLICT');
      }),
      getInvoice: jest.fn(async () => server({ notes: 'edited elsewhere', version: 9 })),
    });
    const r = await processOutbox(api, editOp());
    expect(r.ops[0]).toMatchObject({ state: 'conflict', problem: { code: 'version_conflict' } });
  });

  it('is NOT a conflict when the server already has exactly this content (reply lost)', async () => {
    const api = fakeApi({
      updateInvoice: jest.fn(async () => {
        throw err('unknown', 409, 'VERSION_CONFLICT');
      }),
      getInvoice: jest.fn(async () => server({ version: 3 })),
    });
    const r = await processOutbox(api, editOp());
    expect(r).toMatchObject({ ops: [], synced: ['inv-1'] });
  });

  it('retries later when the check after a conflict cannot reach the server', async () => {
    const api = fakeApi({
      updateInvoice: jest.fn(async () => {
        throw err('unknown', 409, 'VERSION_CONFLICT');
      }),
      getInvoice: jest.fn(async () => {
        throw err('network');
      }),
    });
    const r = await processOutbox(api, editOp());
    expect(r.stopped).toBe('offline');
    expect(r.ops[0]!.state).toBe('pending');
  });

  it('is a "locked" conflict when the invoice was sent or paid meanwhile', async () => {
    const api = fakeApi({
      updateInvoice: jest.fn(async () => {
        throw err('unknown', 409, 'INVOICE_LOCKED');
      }),
    });
    expect((await processOutbox(api, editOp())).ops[0]).toMatchObject({
      state: 'conflict',
      problem: { code: 'locked' },
    });
  });

  it('is a "deleted" conflict when the draft no longer exists', async () => {
    const api = fakeApi({
      updateInvoice: jest.fn(async () => {
        throw err('unknown', 404, 'NOT_FOUND');
      }),
    });
    expect((await processOutbox(api, editOp())).ops[0]).toMatchObject({
      state: 'conflict',
      problem: { code: 'deleted' },
    });
  });

  it('waits out a payment in progress instead of failing', async () => {
    const api = fakeApi({
      updateInvoice: jest.fn(async () => {
        throw err('unknown', 409, 'PAYMENT_IN_PROGRESS');
      }),
    });
    const r = await processOutbox(api, editOp());
    expect(r.stopped).toBe('busy');
    expect(r.ops[0]!.state).toBe('pending');
  });
});

describe('processOutbox: deleting', () => {
  const del = (id = 'inv-1') => queueDelete([], { invoiceId: id, isNew: false, summary }, t(0));

  it('deletes, and counts "already gone" as done', async () => {
    expect((await processOutbox(fakeApi(), del())).ops).toEqual([]);
    const gone = fakeApi({
      deleteInvoice: jest.fn(async () => {
        throw err('unknown', 404, 'NOT_FOUND');
      }),
    });
    expect((await processOutbox(gone, del())).ops).toEqual([]);
  });

  it('is a conflict when the draft was sent elsewhere and can no longer be deleted', async () => {
    const api = fakeApi({
      deleteInvoice: jest.fn(async () => {
        throw err('unknown', 409, 'INVOICE_NOT_DRAFT');
      }),
    });
    expect((await processOutbox(api, del())).ops[0]).toMatchObject({
      state: 'conflict',
      problem: { code: 'locked' },
    });
  });

  it('removes an orphan that was created on the server when a new draft is deleted offline', async () => {
    const api = fakeApi();
    const ops = queueDelete(newOp('new-1'), { invoiceId: 'new-1', isNew: true, summary }, t(3));
    await processOutbox(api, ops);
    expect(api.deleteInvoice).toHaveBeenCalledWith('new-1');
    expect(api.createInvoice).not.toHaveBeenCalled();
  });
});

describe('rebase (keep my version)', () => {
  it('returns the server version while the draft is still editable', async () => {
    const api = fakeApi({ getInvoice: jest.fn(async () => server({ version: 11 })) });
    expect(await rebase(api, editOp()[0]!)).toEqual({ ok: true, version: 11 });
  });
  it('refuses once the draft was sent or paid', async () => {
    const api = fakeApi({
      getInvoice: jest.fn(async () => server({ status: 'sent', editable: false })),
    });
    const out = await rebase(api, editOp()[0]!);
    expect(out.ok).toBe(false);
  });
  it('after a rebase the requeued op uploads against the new version', async () => {
    const api = fakeApi();
    const ops = requeue(editOp(), 'inv-1', 11);
    await processOutbox(api, ops);
    expect(api.updateInvoice).toHaveBeenCalledWith(
      'inv-1',
      expect.objectContaining({ version: 11 }),
    );
  });
});
