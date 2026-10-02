import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SyncBanner } from '../src/components/SyncBanner';
import { OfflineProvider } from '../src/offline/OfflineProvider';
import { createMemoryStore, outboxFile, referenceFile } from '../src/offline/storage';
import { InvoiceListScreen } from '../src/screens/InvoiceListScreen';
import { InvoiceScreen } from '../src/screens/InvoiceScreen';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import { SyncStatusScreen } from '../src/screens/SyncStatusScreen';
import { ApiError } from '../src/services/api';
import { useAuth } from '../src/store/auth';
import { business, CUSTOMER_ID, invoiceDetail, nav } from '../test-utils';

jest.mock('../src/store/auth');
jest.mock('expo-print', () => ({ printAsync: jest.fn(async () => undefined) }));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(),
}));
jest.mock('expo-file-system', () => ({ Paths: { cache: 'c/', document: 'd/' }, File: class {} }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));
jest.mock('expo-notifications', () => ({}));
jest.mock('expo-device', () => ({ isDevice: true }));

const gst = { id: 'r1', name: 'GST', rateBps: 500, isDefault: true };
const acme = {
  id: CUSTOMER_ID,
  firstName: null,
  lastName: null,
  companyName: 'Acme Ltd',
  email: 'a@acme.co',
};
const offline = () => new ApiError('network');

let api: Record<string, jest.Mock>;
let store: ReturnType<typeof createMemoryStore>;

const baseApi = () => ({
  getBusiness: jest.fn(async () => business),
  listTaxRates: jest.fn(async () => ({ items: [gst] })),
  listCustomers: jest.fn(async () => ({ items: [acme], total: 1 })),
  listProducts: jest.fn(async () => ({ items: [], total: 0 })),
  createInvoice: jest.fn(async () => invoiceDetail({ id: 'created' })),
  updateInvoice: jest.fn(async () => invoiceDetail()),
  deleteInvoice: jest.fn(async () => undefined),
  getInvoice: jest.fn(async () =>
    invoiceDetail({ status: 'draft', displayStatus: 'draft', editable: true }),
  ),
  getInvoiceActivity: jest.fn(async () => ({ items: [] })),
  listInvoices: jest.fn(async () => ({ items: [], total: 0 })),
});

async function mount(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <OfflineProvider store={store}>{ui}</OfflineProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api = baseApi();
  store = createMemoryStore();
  (useAuth as jest.Mock).mockReturnValue({
    api,
    status: 'signedIn',
    session: { user: { id: 'u1' } },
  });
});

const queued = async () =>
  JSON.parse((await store.read(outboxFile('u1'))) ?? '{"ops":[]}').ops as Array<
    Record<string, unknown> & {
      payload: { items: Array<{ quantityMilli: number; description: string }>; version?: number };
    }
  >;

async function fillNewInvoice() {
  await screen.findByText('New invoice');
  await fireEvent.press(screen.getByRole('button', { name: 'Choose customer' }));
  await fireEvent.press(await screen.findByText('Acme Ltd'));
  await fireEvent.changeText(screen.getByLabelText('Item 1 description'), 'Web Development');
  await fireEvent.changeText(screen.getByLabelText('Item 1 quantity'), '10');
  await fireEvent.changeText(screen.getByLabelText('Item 1 unit price'), '100');
}

describe('creating an invoice with no connection', () => {
  it('keeps it on the device under its own id and opens it, with no error', async () => {
    api.createInvoice.mockRejectedValue(offline());
    const navigation = nav();
    await mount(
      <InvoiceScreen navigation={navigation as never} route={{ params: undefined } as never} />,
    );
    await fillNewInvoice();
    await fireEvent.press(screen.getByRole('button', { name: 'Create invoice' }));
    await waitFor(async () => expect(await queued()).toHaveLength(1));
    const [op] = await queued();
    expect(op).toMatchObject({
      isNew: true,
      state: 'pending',
      summary: { customerName: 'Acme Ltd', currency: 'USD', totalMinor: 105_000 },
    });
    expect(op!.invoiceId).toMatch(/^[0-9a-f-]{36}$/);
    // The same id went to the server, so a retry can never make a second invoice.
    expect(api.createInvoice).toHaveBeenCalledWith(expect.objectContaining({ id: op!.invoiceId }));
    expect(navigation.replace).toHaveBeenCalledWith('Invoice', { id: op!.invoiceId });
    expect(screen.queryByText(/No internet connection/)).toBeNull();
  });

  it('sends the client id on a normal online create too', async () => {
    const navigation = nav();
    await mount(
      <InvoiceScreen navigation={navigation as never} route={{ params: undefined } as never} />,
    );
    await fillNewInvoice();
    await fireEvent.press(screen.getByRole('button', { name: 'Create invoice' }));
    await waitFor(() => expect(api.createInvoice).toHaveBeenCalled());
    expect(api.createInvoice.mock.calls[0]![0].id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await queued()).toEqual([]);
  });

  it('still shows server problems (not connection ones) instead of queuing', async () => {
    api.createInvoice.mockRejectedValue(new ApiError('unknown', 409, 'NUMBER_EXISTS'));
    await mount(
      <InvoiceScreen navigation={nav() as never} route={{ params: undefined } as never} />,
    );
    await fillNewInvoice();
    await fireEvent.press(screen.getByRole('button', { name: 'Create invoice' }));
    await waitFor(() => expect(api.createInvoice).toHaveBeenCalled());
    expect(await queued()).toEqual([]);
  });

  it('writes the form from the saved copy of customers when there is no connection', async () => {
    api.getBusiness.mockRejectedValue(offline());
    api.listTaxRates.mockRejectedValue(offline());
    api.listCustomers.mockRejectedValue(offline());
    await store.write(
      referenceFile('u1'),
      JSON.stringify({
        savedAt: new Date().toISOString(),
        business,
        taxRates: [gst],
        customers: [acme, { ...acme, id: 'c2', companyName: 'Zed Corp' }],
        products: [],
      }),
    );
    api.createInvoice.mockRejectedValue(offline());
    await mount(
      <InvoiceScreen navigation={nav() as never} route={{ params: undefined } as never} />,
    );
    await screen.findByText('New invoice');
    await fireEvent.press(screen.getByRole('button', { name: 'Choose customer' }));
    expect(await screen.findByText('Acme Ltd')).toBeTruthy();
    expect(screen.getByText('Zed Corp')).toBeTruthy();
    await fireEvent.press(screen.getByText('Zed Corp'));
    expect(screen.getByRole('button', { name: 'Zed Corp' })).toBeTruthy();
  });
});

describe('editing an existing draft with no connection', () => {
  const open = async (
    inv = invoiceDetail({ status: 'draft', displayStatus: 'draft', editable: true }),
  ) => {
    api.getInvoice.mockResolvedValue(inv);
    const navigation = nav();
    await mount(
      <InvoiceScreen navigation={navigation as never} route={{ params: { id: 'i1' } } as never} />,
    );
    await screen.findByText('INV-0001');
    return navigation;
  };

  it('queues the edit against the version it started from', async () => {
    api.updateInvoice.mockRejectedValue(offline());
    await open();
    await fireEvent.changeText(screen.getByLabelText('Item 1 quantity'), '12');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(async () => expect(await queued()).toHaveLength(1));
    const [op] = await queued();
    expect(op).toMatchObject({ invoiceId: 'i1', isNew: false, baseVersion: 2 });
    expect(op!.payload.items[0].quantityMilli).toBe(12_000);
    expect(op!.payload.version).toBeUndefined();
    // The screen now shows the saved-on-device copy with its edit.
    expect(await screen.findByText(/Saved on this device/)).toBeTruthy();
    expect(screen.getByDisplayValue('12')).toBeTruthy();
  });

  it('does not queue edits to an invoice that was already sent (money may have moved)', async () => {
    api.updateInvoice.mockRejectedValue(offline());
    await open(invoiceDetail({ status: 'sent', displayStatus: 'sent', editable: true }));
    await fireEvent.changeText(screen.getByLabelText('Item 1 quantity'), '12');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText(/No internet connection/)).toBeTruthy();
    expect(await queued()).toEqual([]);
  });

  it('queues deleting a draft when offline, after confirming', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    api.deleteInvoice.mockRejectedValue(offline());
    const navigation = await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete draft' }));
    await waitFor(async () => expect(await queued()).toHaveLength(1));
    expect((await queued())[0]).toMatchObject({ invoiceId: 'i1', payload: null });
    await waitFor(() => expect(navigation.popToTop).toHaveBeenCalled());
    alert.mockRestore();
  });
});

const op = (over: Record<string, unknown> = {}) => ({
  invoiceId: 'q1',
  isNew: true,
  payload: {
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
        description: 'Offline work',
        quantityMilli: 2_000,
        unitPriceMinor: 5_000,
        taxes: [],
      },
    ],
  },
  baseVersion: null,
  summary: { customerName: 'Acme Ltd', currency: 'USD', totalMinor: 10_000, number: null },
  queuedAt: '2026-10-01T10:00:00.000Z',
  updatedAt: '2026-10-01T10:00:00.000Z',
  state: 'pending',
  attempts: 0,
  ...over,
});
const seed = (...ops: object[]) =>
  store.write(outboxFile('u1'), JSON.stringify({ version: 1, ops }));

describe('a draft waiting in the queue', () => {
  const open = async () => {
    const navigation = nav();
    await mount(
      <InvoiceScreen navigation={navigation as never} route={{ params: { id: 'q1' } } as never} />,
    );
    await screen.findByText('New draft');
    return navigation;
  };

  it('opens from the device without asking the server, prefilled for editing', async () => {
    api.createInvoice.mockRejectedValue(offline());
    await seed(op());
    await open();
    expect(screen.getByText(/Saved on this device/)).toBeTruthy();
    expect(screen.getByDisplayValue('Offline work')).toBeTruthy();
    expect(api.getInvoice).not.toHaveBeenCalled();
  });

  it('saves a further edit into the queue (not straight to the server)', async () => {
    api.createInvoice.mockRejectedValue(offline());
    await seed(op());
    await open();
    await fireEvent.changeText(screen.getByLabelText('Item 1 description'), 'Changed offline');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(async () =>
      expect((await queued())[0]?.payload.items[0].description).toBe('Changed offline'),
    );
    expect(api.updateInvoice).not.toHaveBeenCalled();
  });

  it('deletes a never-uploaded draft after confirming', async () => {
    api.createInvoice.mockRejectedValue(offline());
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await seed(op());
    const navigation = await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete draft' }));
    await waitFor(async () => expect((await queued())[0]?.payload).toBeNull());
    await waitFor(() => expect(navigation.popToTop).toHaveBeenCalled());
    alert.mockRestore();
  });

  const conflict = (code: string, message: string) =>
    op({ isNew: false, baseVersion: 2, state: 'conflict', problem: { code, message } });
  const openExisting = async () => {
    const navigation = nav();
    await mount(
      <InvoiceScreen navigation={navigation as never} route={{ params: { id: 'q1' } } as never} />,
    );
    await screen.findByRole('button', { name: 'Discard my changes' });
    return navigation;
  };

  it('explains a version conflict and keeps my version after re-basing', async () => {
    api.updateInvoice.mockResolvedValue(invoiceDetail());
    api.getInvoice.mockResolvedValue(
      invoiceDetail({ id: 'q1', status: 'draft', editable: true, version: 9 }),
    );
    await seed(
      conflict(
        'version_conflict',
        'This draft was changed on another device while you were offline.',
      ),
    );
    await openExisting();
    expect(screen.getByText(/changed on another device/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Keep my version' }));
    await waitFor(() => expect(api.updateInvoice).toHaveBeenCalled());
    expect(api.updateInvoice.mock.calls[0]![1]).toMatchObject({ version: 9 });
  });

  it('lets me use the server version, throwing my edit away after confirming', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    await seed(
      conflict(
        'version_conflict',
        'This draft was changed on another device while you were offline.',
      ),
    );
    const navigation = await openExisting();
    await fireEvent.press(screen.getByRole('button', { name: 'Use server version' }));
    await waitFor(async () => expect(await queued()).toEqual([]));
    await waitFor(() => expect(navigation.popToTop).toHaveBeenCalled());
    alert.mockRestore();
  });

  it('offers a copy when the original was sent meanwhile, and no "keep mine"', async () => {
    api.createInvoice.mockRejectedValue(offline());
    await seed(
      conflict(
        'locked',
        'This invoice was sent or paid on another device, so it cannot be changed any more.',
      ),
    );
    const navigation = await openExisting();
    expect(screen.queryByRole('button', { name: 'Keep my version' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Save as new draft' }));
    await waitFor(async () => {
      const ops = await queued();
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({ isNew: true, summary: { number: null } });
      expect(ops[0]!.invoiceId).not.toBe('q1');
    });
    await waitFor(() => expect(navigation.popToTop).toHaveBeenCalled());
  });

  it('shows a refused draft with the reason, so it can be fixed and saved again', async () => {
    api.createInvoice.mockRejectedValue(offline());
    await seed(
      op({
        state: 'failed',
        problem: { code: 'rejected', message: 'That invoice number is already used.' },
      }),
    );
    await open();
    expect(screen.getByText(/That invoice number is already used\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
  });

  it('shows a queued delete and lets me undo it', async () => {
    api.deleteInvoice.mockRejectedValue(offline());
    await seed(op({ isNew: false, payload: null }));
    await mount(
      <InvoiceScreen navigation={nav() as never} route={{ params: { id: 'q1' } } as never} />,
    );
    expect(await screen.findByText(/will be deleted when the app is back online/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Undo delete' }));
    await waitFor(async () => expect(await queued()).toEqual([]));
  });
});

describe('list, banner and sync screen', () => {
  it('shows an offline-created draft at the top of the invoice list with a "Not synced" note', async () => {
    api.createInvoice.mockRejectedValue(offline());
    api.listInvoices.mockResolvedValue({ items: [{ ...invoiceDetail(), id: 'srv-1' }], total: 1 });
    await seed(op());
    const navigation = nav();
    await mount(
      <InvoiceListScreen navigation={navigation as never} route={{ params: undefined } as never} />,
    );
    expect(await screen.findByText('Not synced')).toBeTruthy();
    expect(screen.getByLabelText(/^Invoice New draft, Acme Ltd, \$100\.00/)).toBeTruthy();
    expect(screen.getByText('INV-0001 · Due Oct 15, 2026')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Invoice New draft/));
    expect(navigation.navigate).toHaveBeenCalledWith('Invoice', { id: 'q1' });
  });

  it('still shows queued drafts when the invoice list cannot be loaded', async () => {
    api.createInvoice.mockRejectedValue(offline());
    api.listInvoices.mockRejectedValue(offline());
    await seed(op());
    await mount(
      <InvoiceListScreen navigation={nav() as never} route={{ params: undefined } as never} />,
    );
    expect(await screen.findByText('Not synced')).toBeTruthy();
    expect(await screen.findByText(/Could not load your other invoices/)).toBeTruthy();
  });

  it('hides queued drafts under filters they do not match, and finds them by customer name', async () => {
    api.createInvoice.mockRejectedValue(offline());
    await seed(op());
    await mount(
      <InvoiceListScreen navigation={nav() as never} route={{ params: undefined } as never} />,
    );
    await screen.findByText('Not synced');
    await fireEvent.press(screen.getByRole('button', { name: 'Paid' }));
    await waitFor(() => expect(screen.queryByText('Not synced')).toBeNull());
    await fireEvent.press(screen.getByRole('button', { name: 'Draft' }));
    expect(await screen.findByText('Not synced')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search invoices'), 'zzz');
    await waitFor(() => expect(screen.queryByText('Not synced')).toBeNull());
    await fireEvent.changeText(screen.getByLabelText('Search invoices'), 'acme');
    expect(await screen.findByText('Not synced')).toBeTruthy();
  });

  it('marks a server draft that has unsynced edits', async () => {
    api.createInvoice.mockRejectedValue(offline());
    api.updateInvoice.mockRejectedValue(offline());
    api.listInvoices.mockResolvedValue({ items: [{ ...invoiceDetail(), id: 'q1' }], total: 1 });
    await seed(op({ isNew: false, baseVersion: 2 }));
    await mount(
      <InvoiceListScreen navigation={nav() as never} route={{ params: undefined } as never} />,
    );
    expect(await screen.findByText('Unsynced changes')).toBeTruthy();
  });

  it('the banner counts waiting and attention drafts, and is hidden when empty', async () => {
    api.createInvoice.mockRejectedValue(offline());
    const onOpen = jest.fn();
    await seed(
      op(),
      op({ invoiceId: 'q2', state: 'failed', problem: { code: 'rejected', message: 'nope' } }),
    );
    await mount(<SyncBanner onOpen={onOpen} />);
    const banner = await screen.findByRole('button', { name: /1 draft needs your attention/ });
    await fireEvent.press(banner);
    expect(onOpen).toHaveBeenCalled();
  });

  it('the banner is absent with nothing queued', async () => {
    await mount(<SyncBanner onOpen={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /Sync status/ })).toBeNull();
  });

  it('the sync screen lists each change, its problem, and syncs on request', async () => {
    api.createInvoice.mockRejectedValueOnce(offline()).mockResolvedValue(invoiceDetail());
    await seed(
      op(),
      op({
        invoiceId: 'q2',
        state: 'conflict',
        isNew: false,
        problem: { code: 'locked', message: 'Sent on another device.' },
      }),
    );
    const navigation = nav();
    await mount(<SyncStatusScreen navigation={navigation as never} route={{} as never} />);
    expect(await screen.findByText('Sent on another device.')).toBeTruthy();
    expect(screen.getAllByText('Acme Ltd')).toHaveLength(2);
    await fireEvent.press(screen.getByLabelText(/Acme Ltd, Needs your attention/));
    expect(navigation.navigate).toHaveBeenCalledWith('Invoice', { id: 'q2' });
    await waitFor(() => expect(api.createInvoice).toHaveBeenCalled());
  });

  it('the sync screen says so when everything is synced', async () => {
    await mount(<SyncStatusScreen navigation={nav() as never} route={{} as never} />);
    expect(await screen.findByText('Everything is synced.')).toBeTruthy();
  });
});

describe('signing out with unsynced drafts', () => {
  const signOut = jest.fn(async () => undefined);
  const open = async () => {
    (useAuth as jest.Mock).mockReturnValue({
      api,
      status: 'signedIn',
      session: { user: { id: 'u1' } },
      signOut,
      biometricEnabled: false,
      isBiometricAvailable: async () => false,
      setBiometricEnabled: async () => true,
    });
    await mount(<SettingsScreen />);
    await screen.findByRole('button', { name: 'Sign out' });
  };
  beforeEach(() => signOut.mockClear());

  it('warns before discarding drafts that exist only on this device', async () => {
    api.createInvoice.mockRejectedValue(offline());
    await seed(op());
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await open();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy());
    // wait for the queue to load
    await screen.findByRole('button', { name: 'Sign out' });
    await new Promise((r) => setTimeout(r, 30));
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(alert).toHaveBeenCalledWith(
      'Sign out and lose unsynced drafts?',
      expect.stringContaining('1 draft change is saved only on this device'),
      expect.any(Array),
    );
    expect(signOut).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0]![2]!;
    buttons.find((b) => b.text === 'Sign out anyway')!.onPress!();
    expect(signOut).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('signs out straight away when nothing is waiting', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(alert).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
    alert.mockRestore();
  });
});
