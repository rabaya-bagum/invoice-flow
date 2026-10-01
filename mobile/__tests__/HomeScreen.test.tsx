import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { InvoiceListScreen } from '../src/screens/InvoiceListScreen';
import { HomeScreen } from '../src/screens/HomeScreen';
import { QuickCreateFab } from '../src/components/QuickCreateFab';
import { StatCard } from '../src/components/StatCard';
import { business, invoiceSummary, nav, renderWithQuery, setupApi } from '../test-utils';

jest.mock('../src/store/auth');
const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));

const totals = (over: Record<string, unknown> = {}) => ({
  currency: 'USD',
  outstandingMinor: 425_000,
  outstandingCount: 4,
  overdueMinor: 120_000,
  overdueCount: 2,
  draftMinor: 30_000,
  draftCount: 3,
  paidMinor: 1_250_000,
  paidCount: 5,
  ...over,
});

const payment = {
  id: 'p1',
  invoiceId: 'i1',
  invoiceNumber: 'INV-0001',
  customerName: 'Acme Ltd',
  amountMinor: 50_000,
  refundedMinor: 0,
  currency: 'USD',
  status: 'successful',
  method: 'card',
  stripePaymentIntentId: null,
  receiptUrl: null,
  failureCode: null,
  paidAt: '2026-09-28T12:00:00Z',
  createdAt: '2026-09-28T12:00:00Z',
};

const dashboard = (over: Record<string, unknown> = {}) => ({
  businessName: 'Acme Studio',
  defaultCurrency: 'USD',
  period: 'all',
  currencies: [totals()],
  recentInvoices: [invoiceSummary()],
  recentPayments: [payment],
  ...over,
});

async function open(data: object | Error = dashboard()) {
  const getDashboard =
    data instanceof Error ? jest.fn(async () => Promise.reject(data)) : jest.fn(async () => data);
  const api = setupApi({
    getDashboard,
    listNotifications: jest.fn(async () => ({ items: [], total: 0, unread: 2 })),
  });
  await renderWithQuery(<HomeScreen />);
  return api;
}

describe('HomeScreen dashboard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows each total with its invoice count', async () => {
    await open();
    expect(await screen.findByText('Acme Studio')).toBeTruthy();
    expect(screen.getByText('$4,250.00')).toBeTruthy();
    expect(screen.getByText('4 invoices')).toBeTruthy();
    expect(screen.getByText('$1,200.00')).toBeTruthy();
    expect(screen.getByText('$12,500.00')).toBeTruthy();
    expect(screen.getByText('$300.00')).toBeTruthy();
    expect(screen.getByText('3 drafts')).toBeTruthy();
    expect(screen.getByText('Notifications (2)')).toBeTruthy();
  });

  it('opens the matching invoice list when a card is tapped', async () => {
    await open();
    await fireEvent.press(await screen.findByLabelText(/^Overdue: /));
    expect(mockNavigate).toHaveBeenCalledWith('InvoicesTab', {
      screen: 'InvoiceList',
      params: { status: 'overdue' },
    });
    await fireEvent.press(screen.getByLabelText(/^Outstanding: /));
    expect(mockNavigate).toHaveBeenLastCalledWith('InvoicesTab', {
      screen: 'InvoiceList',
      params: { status: 'outstanding' },
    });
  });

  it('refetches Paid for the chosen period', async () => {
    const api = await open();
    await screen.findByText('Acme Studio');
    expect(api.getDashboard).toHaveBeenCalledWith('all');
    await fireEvent.press(screen.getByText('This month'));
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalledWith('this_month'));
  });

  it('lists recent invoices and payments and opens them', async () => {
    await open();
    expect(await screen.findByText('Recent invoices')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Invoice INV-0001/));
    expect(mockNavigate).toHaveBeenCalledWith('InvoicesTab', {
      screen: 'Invoice',
      params: { id: 'i1' },
    });
    await fireEvent.press(screen.getByLabelText(/^Payment of \$500\.00 from Acme Ltd/));
    expect(mockNavigate).toHaveBeenLastCalledWith('PaymentsTab', {
      screen: 'PaymentDetail',
      params: { id: 'p1' },
    });
  });

  it('keeps other currencies in their own section', async () => {
    await open(
      dashboard({
        currencies: [
          totals(),
          totals({ currency: 'EUR', outstandingMinor: 70_000, outstandingCount: 1 }),
        ],
      }),
    );
    expect(await screen.findByText('EUR invoices')).toBeTruthy();
    expect(screen.getByText('€700.00')).toBeTruthy();
  });

  it('welcomes a brand-new business with a first-invoice action', async () => {
    await open(
      dashboard({
        currencies: [
          totals({
            outstandingMinor: 0,
            outstandingCount: 0,
            overdueMinor: 0,
            overdueCount: 0,
            draftMinor: 0,
            draftCount: 0,
            paidMinor: 0,
            paidCount: 0,
          }),
        ],
        recentInvoices: [],
        recentPayments: [],
      }),
    );
    expect(await screen.findByText('Welcome to InvoiceFlow')).toBeTruthy();
    await fireEvent.press(screen.getByText('Create your first invoice'));
    expect(mockNavigate).toHaveBeenCalledWith('InvoicesTab', { screen: 'Invoice' });
  });

  it('shows an error with retry when loading fails', async () => {
    await open(new Error('boom'));
    expect(await screen.findByText('Try again')).toBeTruthy();
  });

  it('creates things from the quick-create menu', async () => {
    await open();
    await screen.findByText('Acme Studio');
    await fireEvent.press(screen.getByLabelText('Quick create'));
    await fireEvent.press(screen.getByLabelText('New customer'));
    expect(mockNavigate).toHaveBeenCalledWith('CustomersTab', { screen: 'CustomerForm' });
    await fireEvent.press(screen.getByLabelText('Quick create'));
    await fireEvent.press(screen.getByLabelText('New estimate'));
    expect(mockNavigate).toHaveBeenLastCalledWith('InvoicesTab', { screen: 'Estimate' });
    await fireEvent.press(screen.getByLabelText('Quick create'));
    await fireEvent.press(screen.getByLabelText('New invoice'));
    expect(mockNavigate).toHaveBeenLastCalledWith('InvoicesTab', { screen: 'Invoice' });
  });
});

describe('QuickCreateFab', () => {
  it('toggles its menu and closes on backdrop tap or pick', async () => {
    const onPress = jest.fn();
    await render(<QuickCreateFab actions={[{ label: 'Do it', icon: 'add', onPress }]} />);
    expect(screen.queryByLabelText('Do it')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Quick create'));
    expect(screen.getByLabelText('Do it')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Close menu'));
    expect(screen.queryByLabelText('Do it')).toBeNull();
    await fireEvent.press(screen.getByLabelText('Quick create'));
    await fireEvent.press(screen.getByLabelText('Do it'));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Do it')).toBeNull();
  });
});

describe('StatCard', () => {
  it('is a button only when given onPress', async () => {
    const onPress = jest.fn();
    await render(
      <StatCard
        label="Paid"
        amountMinor={500}
        currency="USD"
        detail="1 invoice"
        onPress={onPress}
      />,
    );
    await fireEvent.press(screen.getByLabelText('Paid: $5.00, 1 invoice'));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('InvoiceListScreen status preset', () => {
  const open = async (status?: string) => {
    const api = setupApi({
      listInvoices: jest.fn(async () => ({ items: [invoiceSummary()], total: 1 })),
      getBusiness: jest.fn(async () => business),
    });
    await renderWithQuery(
      <InvoiceListScreen
        navigation={nav() as never}
        route={{ params: status ? { status } : undefined } as never}
      />,
    );
    return api;
  };

  it('starts filtered by the status it was opened with', async () => {
    const api = await open('outstanding');
    await screen.findByText('Acme Ltd');
    expect(api.listInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'outstanding' }),
    );
    expect(screen.getByRole('button', { name: 'Outstanding', selected: true })).toBeTruthy();
  });

  it('shows everything without a preset', async () => {
    const api = await open();
    await screen.findByText('Acme Ltd');
    expect(api.listInvoices).toHaveBeenCalledWith(expect.objectContaining({ status: undefined }));
  });
});
