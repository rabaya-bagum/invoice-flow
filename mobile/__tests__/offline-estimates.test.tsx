import type { InvoiceWriteInput } from '@invoiceflow/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { OfflineProvider } from '../src/offline/OfflineProvider';
import { queueDelete, queueSave } from '../src/offline/outbox';
import { createMemoryStore, outboxFile } from '../src/offline/storage';
import { processOutbox as runQueue, rebase as rebaseOp, type SyncApi } from '../src/offline/sync';
import { kindOf, type DraftSummary } from '../src/offline/types';
import { EstimateListScreen } from '../src/screens/EstimateListScreen';
import { EstimateScreen } from '../src/screens/EstimateScreen';
import { InvoiceListScreen } from '../src/screens/InvoiceListScreen';
import { SyncStatusScreen } from '../src/screens/SyncStatusScreen';
import { ApiError } from '../src/services/api';
import { useAuth } from '../src/store/auth';
import { business, CUSTOMER_ID, estimateDetail, invoiceDetail, nav } from '../test-utils';

jest.mock('../src/store/auth');
jest.mock('expo-print', () => ({ printAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ Paths: { cache: 'c/', document: 'd/' }, File: class {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));

const err = (kind: ConstructorParameters<typeof ApiError>[0], status?: number, code?: string) =>
  new ApiError(kind, status, code);
const offline = () => err('network');

/** Queue payloads are invoice-shaped; for an estimate `dueDate` is the expiry date. */
const payload = (over: Partial<InvoiceWriteInput> = {}): InvoiceWriteInput =>
  ({
    customerId: CUSTOMER_ID,
    number: null,
    issueDate: '2026-10-01',
    dueDate: '2026-10-31',
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

const server = (over: Record<string, unknown> = {}) =>
  estimateDetail({
    id: 'e1',
    status: 'draft',
    displayStatus: 'draft',
    editable: true,
    ...over,
  }) as never;

function fakeApi(over: Record<string, jest.Mock> = {}) {
  return {
    createInvoice: jest.fn(),
    updateInvoice: jest.fn(),
    deleteInvoice: jest.fn(),
    getInvoice: jest.fn(),
    createEstimate: jest.fn(async () => server()),
    updateEstimate: jest.fn(async () => server()),
    deleteEstimate: jest.fn(async () => undefined),
    getEstimate: jest.fn(async () => server()),
    ...over,
  } as Record<keyof SyncApi, jest.Mock>;
}

type FakeApi = ReturnType<typeof fakeApi>;
const processOutbox = (a: FakeApi, ops: Parameters<typeof runQueue>[1]) =>
  runQueue(a as unknown as SyncApi, ops);
const rebase = (a: FakeApi, op: Parameters<typeof rebaseOp>[1]) =>
  rebaseOp(a as unknown as SyncApi, op);

const estOp = (id = 'e1', isNew = true, baseVersion: number | null = null) =>
  queueSave(
    [],
    { invoiceId: id, kind: 'estimate', isNew, payload: payload(), baseVersion, summary },
    t(0),
  );

describe('queued estimates: sync', () => {
  it('uploads a new estimate to the estimate endpoint under its own id, with expiryDate', async () => {
    const api = fakeApi();
    const r = await processOutbox(api, estOp('new-e'));
    expect(api.createInvoice).not.toHaveBeenCalled();
    const sent = api.createEstimate.mock.calls[0]![0];
    expect(sent).toMatchObject({ id: 'new-e', expiryDate: '2026-10-31', customerId: CUSTOMER_ID });
    expect(sent.dueDate).toBeUndefined();
    expect(r).toMatchObject({ ops: [], synced: ['new-e'] });
  });

  it('sends the base version when updating, and renames the date', async () => {
    const api = fakeApi();
    await processOutbox(api, estOp('e1', false, 4));
    expect(api.updateEstimate).toHaveBeenCalledWith(
      'e1',
      expect.objectContaining({ version: 4, expiryDate: '2026-10-31' }),
    );
    expect(api.updateEstimate.mock.calls[0]![1].dueDate).toBeUndefined();
  });

  it('treats a lost reply as done (same content already on the server)', async () => {
    const api = fakeApi({
      createEstimate: jest.fn(async () => {
        throw err('unknown', 409, 'ID_TAKEN');
      }),
    });
    const r = await processOutbox(api, estOp('e1'));
    expect(api.getEstimate).toHaveBeenCalledWith('e1');
    expect(api.updateEstimate).not.toHaveBeenCalled();
    expect(r.ops).toEqual([]);
  });

  it('flags a version conflict only when the content differs', async () => {
    const conflict = fakeApi({
      updateEstimate: jest.fn(async () => {
        throw err('unknown', 409, 'VERSION_CONFLICT');
      }),
      getEstimate: jest.fn(async () => server({ notes: 'theirs', version: 9 })),
    });
    expect((await processOutbox(conflict, estOp('e1', false, 2))).ops[0]).toMatchObject({
      state: 'conflict',
      problem: { code: 'version_conflict' },
    });
    const same = fakeApi({
      updateEstimate: jest.fn(async () => {
        throw err('unknown', 409, 'VERSION_CONFLICT');
      }),
      getEstimate: jest.fn(async () => server({ version: 3 })),
    });
    expect((await processOutbox(same, estOp('e1', false, 2))).ops).toEqual([]);
  });

  it('knows the estimate-specific codes: locked on edit, not-draft on delete', async () => {
    const locked = fakeApi({
      updateEstimate: jest.fn(async () => {
        throw err('unknown', 409, 'ESTIMATE_LOCKED');
      }),
    });
    const out = (await processOutbox(locked, estOp('e1', false, 2))).ops[0]!;
    expect(out).toMatchObject({ state: 'conflict', problem: { code: 'locked' } });
    expect(out.problem!.message).toMatch(/estimate/);
    const del = fakeApi({
      deleteEstimate: jest.fn(async () => {
        throw err('unknown', 409, 'ESTIMATE_NOT_DRAFT');
      }),
    });
    const ops = queueDelete([], { invoiceId: 'e1', kind: 'estimate', isNew: false, summary }, t(0));
    expect((await processOutbox(del, ops)).ops[0]).toMatchObject({
      state: 'conflict',
      problem: { code: 'locked' },
    });
    expect(del.deleteInvoice).not.toHaveBeenCalled();
  });

  it('does not overwrite an estimate that was sent or answered behind a reused id', async () => {
    const api = fakeApi({
      createEstimate: jest.fn(async () => {
        throw err('unknown', 409, 'ID_TAKEN');
      }),
      getEstimate: jest.fn(async () => server({ status: 'accepted', editable: false, notes: 'x' })),
    });
    const r = await processOutbox(api, estOp('e1'));
    expect(r.ops[0]).toMatchObject({ state: 'conflict', problem: { code: 'locked' } });
    expect(api.updateEstimate).not.toHaveBeenCalled();
  });

  it('keeps invoices and estimates apart in one queue, and treats old files (no kind) as invoices', async () => {
    const api = fakeApi({
      createInvoice: jest.fn(async () => invoiceDetail()),
    });
    let ops = queueSave(
      [],
      { invoiceId: 'inv-1', isNew: true, payload: payload(), baseVersion: null, summary },
      t(0),
    );
    ops = queueSave(
      ops,
      {
        invoiceId: 'est-1',
        kind: 'estimate',
        isNew: true,
        payload: payload(),
        baseVersion: null,
        summary,
      },
      t(1),
    );
    await processOutbox(api, ops);
    expect(api.createInvoice).toHaveBeenCalledTimes(1);
    expect(api.createEstimate).toHaveBeenCalledTimes(1);
    const legacy = { ...ops[0]! };
    delete (legacy as { kind?: string }).kind;
    expect(kindOf(legacy)).toBe('invoice');
  });

  it('rebases against the estimate endpoint', async () => {
    const api = fakeApi({ getEstimate: jest.fn(async () => server({ version: 11 })) });
    expect(await rebase(api, estOp('e1', false, 2)[0]!)).toEqual({ ok: true, version: 11 });
    const sent = fakeApi({
      getEstimate: jest.fn(async () => server({ status: 'sent', editable: true })),
    });
    expect((await rebase(sent, estOp('e1', false, 2)[0]!)).ok).toBe(false);
    expect(api.getInvoice).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------------------------------ UI
let api: Record<string, jest.Mock>;
let store: ReturnType<typeof createMemoryStore>;
const gst = { id: 'r1', name: 'GST', rateBps: 500, isDefault: true };
const acme = {
  id: CUSTOMER_ID,
  firstName: null,
  lastName: null,
  companyName: 'Acme Ltd',
  email: 'a@acme.co',
};

async function mount(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OfflineProvider store={store}>{ui}</OfflineProvider>
    </QueryClientProvider>,
  );
}
const queued = async () =>
  JSON.parse((await store.read(outboxFile('u1'))) ?? '{"ops":[]}').ops as Array<{
    invoiceId: string;
    kind?: string;
    isNew: boolean;
    payload: null | { dueDate: string };
    baseVersion: number | null;
  }>;
const seed = (...ops: object[]) =>
  store.write(outboxFile('u1'), JSON.stringify({ version: 1, ops }));
const rawOp = (over: Record<string, unknown> = {}) => ({
  invoiceId: 'q1',
  kind: 'estimate',
  isNew: true,
  payload: payload(),
  baseVersion: null,
  summary: { ...summary, totalMinor: 10_000 },
  queuedAt: t(0),
  updatedAt: t(0),
  state: 'pending',
  attempts: 0,
  ...over,
});

beforeEach(() => {
  api = {
    getBusiness: jest.fn(async () => business),
    listTaxRates: jest.fn(async () => ({ items: [gst] })),
    listCustomers: jest.fn(async () => ({ items: [acme], total: 1 })),
    listProducts: jest.fn(async () => ({ items: [], total: 0 })),
    createEstimate: jest.fn(async () => estimateDetail({ id: 'created' })),
    updateEstimate: jest.fn(async () => estimateDetail()),
    deleteEstimate: jest.fn(async () => undefined),
    getEstimate: jest.fn(async () => estimateDetail()),
    listEstimates: jest.fn(async () => ({ items: [], total: 0 })),
    listInvoices: jest.fn(async () => ({ items: [], total: 0 })),
  };
  store = createMemoryStore();
  (useAuth as jest.Mock).mockReturnValue({
    api,
    status: 'signedIn',
    session: { user: { id: 'u1' } },
  });
});

describe('creating an estimate with no connection', () => {
  it('keeps it on the device as an estimate, under its own id, and opens it', async () => {
    api.createEstimate.mockRejectedValue(offline());
    const navigation = nav();
    await mount(
      <EstimateScreen navigation={navigation as never} route={{ params: undefined } as never} />,
    );
    await screen.findByText('New estimate');
    await fireEvent.press(screen.getByRole('button', { name: 'Choose customer' }));
    await fireEvent.press(await screen.findByText('Acme Ltd'));
    await fireEvent.changeText(screen.getByLabelText('Item 1 description'), 'Survey');
    await fireEvent.changeText(screen.getByLabelText('Item 1 quantity'), '1');
    await fireEvent.changeText(screen.getByLabelText('Item 1 unit price'), '300');
    await fireEvent.press(screen.getByRole('button', { name: 'Create estimate' }));
    await waitFor(async () => expect(await queued()).toHaveLength(1));
    const [op] = await queued();
    expect(op).toMatchObject({ kind: 'estimate', isNew: true });
    expect(api.createEstimate).toHaveBeenCalledWith(expect.objectContaining({ id: op!.invoiceId }));
    expect(navigation.replace).toHaveBeenCalledWith('Estimate', { id: op!.invoiceId });
  });

  it('sends the client id on a normal online create too', async () => {
    await mount(
      <EstimateScreen navigation={nav() as never} route={{ params: undefined } as never} />,
    );
    await screen.findByText('New estimate');
    await fireEvent.press(screen.getByRole('button', { name: 'Choose customer' }));
    await fireEvent.press(await screen.findByText('Acme Ltd'));
    await fireEvent.changeText(screen.getByLabelText('Item 1 description'), 'Survey');
    await fireEvent.changeText(screen.getByLabelText('Item 1 unit price'), '300');
    await fireEvent.press(screen.getByRole('button', { name: 'Create estimate' }));
    await waitFor(() => expect(api.createEstimate).toHaveBeenCalled());
    expect(api.createEstimate.mock.calls[0]![0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await queued()).toEqual([]);
  });
});

describe('editing or deleting an estimate with no connection', () => {
  const open = async (est = estimateDetail()) => {
    api.getEstimate.mockResolvedValue(est);
    const navigation = nav();
    await mount(
      <EstimateScreen navigation={navigation as never} route={{ params: { id: 'e1' } } as never} />,
    );
    await screen.findByText('EST-0001');
    return navigation;
  };

  it('queues the edit of a draft against its version', async () => {
    api.updateEstimate.mockRejectedValue(offline());
    await open();
    await fireEvent.changeText(screen.getByLabelText('Item 1 quantity'), '12');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(async () => expect(await queued()).toHaveLength(1));
    expect((await queued())[0]).toMatchObject({
      invoiceId: 'e1',
      kind: 'estimate',
      isNew: false,
      baseVersion: 2,
    });
    expect(await screen.findByText(/Saved on this device/)).toBeTruthy();
    expect(screen.getByLabelText('Valid until')).toBeTruthy();
  });

  it('does not queue edits to an estimate that was already sent', async () => {
    api.updateEstimate.mockRejectedValue(offline());
    await open(estimateDetail({ status: 'sent', displayStatus: 'sent' }));
    await fireEvent.changeText(screen.getByLabelText('Item 1 quantity'), '12');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/No internet connection/)).toBeTruthy();
    expect(await queued()).toEqual([]);
  });

  it('queues deleting a draft estimate after confirming', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, b) => {
      b?.find((x) => x.style === 'destructive')?.onPress?.();
    });
    api.deleteEstimate.mockRejectedValue(offline());
    const navigation = await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete draft' }));
    await waitFor(async () =>
      expect((await queued())[0]).toMatchObject({
        invoiceId: 'e1',
        kind: 'estimate',
        payload: null,
      }),
    );
    await waitFor(() => expect(navigation.popToTop).toHaveBeenCalled());
    alert.mockRestore();
  });
});

describe('a queued estimate draft', () => {
  it('opens from the device (no server call), editable, with the estimate wording', async () => {
    api.createEstimate.mockRejectedValue(offline());
    await seed(rawOp());
    await mount(
      <EstimateScreen navigation={nav() as never} route={{ params: { id: 'q1' } } as never} />,
    );
    expect(await screen.findByText('New draft')).toBeTruthy();
    expect(screen.getByLabelText('Valid until')).toBeTruthy();
    expect(screen.getByDisplayValue('Web Development')).toBeTruthy();
    expect(api.getEstimate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Delete draft' })).toBeTruthy();
  });

  it('uploads once online and then shows the server copy', async () => {
    await seed(rawOp({ invoiceId: 'e1' }));
    await mount(
      <EstimateScreen navigation={nav() as never} route={{ params: { id: 'e1' } } as never} />,
    );
    await waitFor(() => expect(api.createEstimate).toHaveBeenCalled());
    expect(await screen.findByText('EST-0001')).toBeTruthy();
    expect(await queued()).toEqual([]);
  });

  it('explains an estimate conflict and offers a copy when it was answered elsewhere', async () => {
    await seed(
      rawOp({
        isNew: false,
        baseVersion: 2,
        state: 'conflict',
        problem: {
          code: 'locked',
          message: 'This estimate was sent, answered or converted on another device.',
        },
      }),
    );
    await mount(
      <EstimateScreen navigation={nav() as never} route={{ params: { id: 'q1' } } as never} />,
    );
    expect(await screen.findByRole('button', { name: 'Save as new draft' })).toBeTruthy();
    expect(screen.getByText(/sent, answered or converted/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Discard my changes' })).toBeTruthy();
  });
});

describe('lists and the sync screen keep the two kinds apart', () => {
  it('shows a queued estimate in the estimate list only, and a queued invoice in the invoice list only', async () => {
    api.createEstimate.mockRejectedValue(offline());
    await seed(
      rawOp(),
      rawOp({
        invoiceId: 'i9',
        kind: 'invoice',
        summary: { ...summary, customerName: 'Invoice Person' },
      }),
    );
    await mount(<EstimateListScreen navigation={nav() as never} route={{} as never} />);
    expect(await screen.findByText('Not synced')).toBeTruthy();
    expect(screen.getByText('Acme Ltd')).toBeTruthy();
    expect(screen.queryByText('Invoice Person')).toBeNull();
    expect(screen.getByText(/New draft · Valid until Oct 31, 2026/)).toBeTruthy();
  });

  it('the invoice list ignores queued estimates', async () => {
    api.createEstimate.mockRejectedValue(offline());
    await seed(rawOp());
    await mount(
      <InvoiceListScreen navigation={nav() as never} route={{ params: undefined } as never} />,
    );
    await screen.findByText('No invoices yet');
    expect(screen.queryByText('Not synced')).toBeNull();
  });

  it('the estimate list still shows queued drafts when the server list cannot load', async () => {
    api.createEstimate.mockRejectedValue(offline());
    api.listEstimates.mockRejectedValue(offline());
    await seed(rawOp());
    await mount(<EstimateListScreen navigation={nav() as never} route={{} as never} />);
    expect(await screen.findByText('Not synced')).toBeTruthy();
    expect(await screen.findByText(/Could not load your other estimates/)).toBeTruthy();
  });

  it('the sync screen labels each kind and opens the right screen', async () => {
    api.createEstimate.mockRejectedValue(offline());
    api.createInvoice = jest.fn().mockRejectedValue(offline());
    await seed(rawOp(), rawOp({ invoiceId: 'i9', kind: 'invoice' }));
    const navigation = nav();
    await mount(<SyncStatusScreen navigation={navigation as never} route={{} as never} />);
    expect(await screen.findByText(/New estimate draft/)).toBeTruthy();
    expect(screen.getByText(/New invoice draft/)).toBeTruthy();
    await fireEvent.press(screen.getAllByLabelText(/Acme Ltd/)[0]!);
    expect(navigation.navigate).toHaveBeenCalledWith('Estimate', { id: 'q1' });
    await fireEvent.press(screen.getAllByLabelText(/Acme Ltd/)[1]!);
    expect(navigation.navigate).toHaveBeenCalledWith('Invoice', { id: 'i9' });
  });
});
