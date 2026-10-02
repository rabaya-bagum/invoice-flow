import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';
import { OfflineProvider } from '../src/offline/OfflineProvider';
import { useOffline, type OfflineValue } from '../src/offline/context';
import { outboxFile, referenceFile, createMemoryStore } from '../src/offline/storage';
import { ApiError } from '../src/services/api';
import { useAuth } from '../src/store/auth';
import { business, CUSTOMER_ID, invoiceDetail } from '../test-utils';

jest.mock('../src/store/auth');

const summary = { customerName: 'Acme Ltd', currency: 'USD', totalMinor: 105_000, number: null };
const payload = (over: object = {}) => ({
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
});
const save = (id = 'draft-1', over: Record<string, unknown> = {}) => ({
  invoiceId: id,
  isNew: true,
  payload: payload() as never,
  baseVersion: null,
  summary,
  ...over,
});

let api: Record<string, jest.Mock>;
let off: OfflineValue;
let invalidate: jest.SpyInstance;

function Probe() {
  off = useOffline();
  return (
    <Text>{`ops:${off.ops.length} pending:${off.pending} attention:${off.attention} syncing:${off.syncing}`}</Text>
  );
}

function setAuth(status: 'signedIn' | 'signedOut', userId = 'user-1') {
  (useAuth as jest.Mock).mockReturnValue({
    api,
    status,
    session: status === 'signedIn' ? { user: { id: userId } } : null,
  });
}

async function mount(store = createMemoryStore()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  invalidate = jest.spyOn(client, 'invalidateQueries');
  const build = () => (
    <QueryClientProvider client={client}>
      <OfflineProvider store={store}>
        <Probe />
      </OfflineProvider>
    </QueryClientProvider>
  );
  const utils = await render(build());
  return { store, client, build, ...utils };
}

const offlineErr = () => new ApiError('network');

beforeEach(() => {
  api = {
    createInvoice: jest.fn(async () => invoiceDetail()),
    updateInvoice: jest.fn(async () => invoiceDetail()),
    deleteInvoice: jest.fn(async () => undefined),
    getInvoice: jest.fn(async () => invoiceDetail({ status: 'draft', editable: true, version: 3 })),
    getBusiness: jest.fn(async () => business),
    listTaxRates: jest.fn(async () => ({ items: [] })),
    listCustomers: jest.fn(async () => ({ items: [], total: 0 })),
    listProducts: jest.fn(async () => ({ items: [], total: 0 })),
  };
  setAuth('signedIn');
});

const settle = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
};

describe('OfflineProvider', () => {
  it('is inert when no provider is mounted', async () => {
    let seen: OfflineValue | undefined;
    function Bare() {
      seen = useOffline();
      return null;
    }
    await render(<Bare />);
    expect(seen).toMatchObject({ available: false, ops: [], pending: 0 });
    await expect(seen!.saveDraft(save())).resolves.toBeUndefined();
  });

  it("loads this user's saved queue, and never another user's", async () => {
    const mine = JSON.stringify({ version: 1, ops: [{ ...baseOp('mine') }] });
    const theirs = JSON.stringify({ version: 1, ops: [{ ...baseOp('theirs') }] });
    api.createInvoice.mockRejectedValue(offlineErr());
    const store = createMemoryStore({
      [outboxFile('user-1')]: mine,
      [outboxFile('user-2')]: theirs,
    });
    await mount(store);
    expect(await screen.findByText(/ops:1 /)).toBeTruthy();
    expect(off.getOp('mine')).toBeTruthy();
    expect(off.getOp('theirs')).toBeUndefined();
  });

  it('treats a damaged file as an empty queue', async () => {
    const store = createMemoryStore({ [outboxFile('user-1')]: '{not json' });
    await mount(store);
    await settle();
    expect(screen.getByText(/ops:0 /)).toBeTruthy();
    const wrongShape = createMemoryStore({
      [outboxFile('user-1')]: JSON.stringify({ version: 9, ops: 'x' }),
    });
    await mount(wrongShape);
    await settle();
    expect(screen.getAllByText(/ops:0 /).length).toBeGreaterThan(0);
  });

  it('saves a draft to the device and keeps it while offline', async () => {
    api.createInvoice.mockRejectedValue(offlineErr());
    const { store } = await mount();
    await settle();
    await act(async () => off.saveDraft(save()));
    expect(await screen.findByText(/ops:1 pending:1/)).toBeTruthy();
    const saved = JSON.parse((await store.read(outboxFile('user-1')))!);
    expect(saved.ops[0]).toMatchObject({ invoiceId: 'draft-1', isNew: true, state: 'pending' });
    await act(async () => off.syncNow());
    expect(api.createInvoice).toHaveBeenCalledWith(expect.objectContaining({ id: 'draft-1' }));
    expect(screen.getByText(/ops:1 pending:1/)).toBeTruthy(); // still there
    expect(off.lastStop).toBe('offline');
  });

  it('uploads when back online, empties the queue and the file, and refreshes the lists', async () => {
    const { store } = await mount();
    await settle();
    await act(async () => off.saveDraft(save()));
    await waitFor(() => expect(api.createInvoice).toHaveBeenCalled());
    expect(await screen.findByText(/ops:0 pending:0/)).toBeTruthy();
    expect(await store.read(outboxFile('user-1'))).toBeNull();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['invoices'] });
  });

  it('syncs when the app returns to the foreground', async () => {
    let listener: (s: string) => void = () => undefined;
    const add = jest.spyOn(AppState, 'addEventListener').mockImplementation(((
      _: string,
      cb: (s: string) => void,
    ) => {
      listener = cb;
      return { remove: jest.fn() };
    }) as never);
    api.createInvoice.mockRejectedValueOnce(offlineErr());
    await mount();
    await settle();
    await act(async () => off.saveDraft(save()));
    await waitFor(() => expect(api.createInvoice).toHaveBeenCalledTimes(1));
    await settle();
    await act(async () => listener('active'));
    await waitFor(() => expect(api.createInvoice).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/ops:0 /)).toBeTruthy();
    add.mockRestore();
  });

  it('wipes the queue and the saved copy when the user signs out', async () => {
    api.createInvoice.mockRejectedValue(offlineErr());
    const { store, rerender, build } = await mount();
    await settle();
    await act(async () => off.saveDraft(save()));
    expect(await store.read(outboxFile('user-1'))).not.toBeNull();
    setAuth('signedOut');
    await rerender(build());
    await waitFor(async () => expect(await store.read(outboxFile('user-1'))).toBeNull());
    expect(await store.read(referenceFile('user-1'))).toBeNull();
    expect(screen.getByText(/ops:0 /)).toBeTruthy();
  });

  it('keeps an edit made while the previous version was uploading', async () => {
    let release: () => void = () => undefined;
    api.createInvoice.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(invoiceDetail());
        }),
    );
    await mount();
    await settle();
    await act(async () => off.saveDraft(save()));
    await waitFor(() => expect(api.createInvoice).toHaveBeenCalledTimes(1));
    await act(async () =>
      off.saveDraft(
        save('draft-1', { payload: payload({ notes: 'edited during upload' }) as never }),
      ),
    );
    await act(async () => release());
    await waitFor(() => expect(api.updateInvoice).toHaveBeenCalled());
    expect(api.updateInvoice.mock.calls[0]![1]).toMatchObject({ notes: 'edited during upload' });
    // The edit followed the create: no version check against our own upload.
    expect(api.updateInvoice.mock.calls[0]![1].version).toBeUndefined();
    expect(await screen.findByText(/ops:0 /)).toBeTruthy();
  });

  it('resolves a conflict: keep mine re-bases and uploads', async () => {
    api.updateInvoice
      .mockRejectedValueOnce(new ApiError('unknown', 409, 'VERSION_CONFLICT'))
      .mockResolvedValue(invoiceDetail());
    api.getInvoice.mockResolvedValue(
      invoiceDetail({ id: 'inv-1', status: 'draft', editable: true, version: 8, notes: 'theirs' }),
    );
    await mount();
    await settle();
    await act(async () => off.saveDraft(save('inv-1', { isNew: false, baseVersion: 2 })));
    expect(await screen.findByText(/attention:1/)).toBeTruthy();
    expect(off.getOp('inv-1')!.problem!.code).toBe('version_conflict');
    let message: string | null = 'x';
    await act(async () => {
      message = await off.keepMine('inv-1');
    });
    expect(message).toBeNull();
    await waitFor(() => expect(api.updateInvoice).toHaveBeenCalledTimes(2));
    expect(api.updateInvoice.mock.calls[1]![1]).toMatchObject({ version: 8 });
    expect(await screen.findByText(/ops:0 /)).toBeTruthy();
  });

  it('keep mine reports a draft that was sent meanwhile, and offers a copy instead', async () => {
    api.updateInvoice.mockRejectedValue(new ApiError('unknown', 409, 'VERSION_CONFLICT'));
    api.getInvoice.mockResolvedValue(
      invoiceDetail({ id: 'inv-1', status: 'sent', editable: false, notes: 'x' }),
    );
    await mount();
    await settle();
    await act(async () => off.saveDraft(save('inv-1', { isNew: false, baseVersion: 2 })));
    await screen.findByText(/attention:1/);
    // The first sync only saw a version conflict against a still-draft copy; now it was sent.
    let message: string | null = null;
    await act(async () => {
      message = await off.keepMine('inv-1');
    });
    expect(message).toMatch(/sent or paid/);
    await act(async () => off.saveAsCopy('inv-1'));
    await waitFor(() => expect(api.createInvoice).toHaveBeenCalled());
    const created = api.createInvoice.mock.calls[0]![0];
    expect(created.id).not.toBe('inv-1');
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(created.number).toBeNull();
  });

  it('discard drops the queued change and refreshes', async () => {
    api.createInvoice.mockRejectedValue(offlineErr());
    const { store } = await mount();
    await settle();
    await act(async () => off.saveDraft(save()));
    await act(async () => off.discard('draft-1'));
    expect(await screen.findByText(/ops:0 /)).toBeTruthy();
    expect(await store.read(outboxFile('user-1'))).toBeNull();
    expect(invalidate).toHaveBeenCalled();
  });

  it('copies the lists the form needs for offline use', async () => {
    api.listCustomers.mockResolvedValue({
      items: [{ id: CUSTOMER_ID, companyName: 'Acme Ltd' }],
      total: 1,
    });
    const { store } = await mount();
    await waitFor(async () => expect(await off.getSnapshot()).not.toBeNull());
    expect((await off.getSnapshot())!.customers).toHaveLength(1);
    const file = JSON.parse((await store.read(referenceFile('user-1')))!);
    expect(file.business.name).toBe('Acme');
  });
});

function baseOp(id: string) {
  return {
    invoiceId: id,
    isNew: true,
    payload: payload(),
    baseVersion: null,
    summary,
    queuedAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-01T10:00:00.000Z',
    state: 'pending',
    attempts: 0,
  };
}
