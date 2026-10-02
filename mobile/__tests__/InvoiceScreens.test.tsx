import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { InvoiceListScreen, dueTiming } from '../src/screens/InvoiceListScreen';
import { InvoiceScreen } from '../src/screens/InvoiceScreen';
import { TaxRatesScreen } from '../src/screens/TaxRatesScreen';
import { ApiError } from '../src/services/api';
import { StatusBadge } from '../src/components/StatusBadge';
import {
  business,
  CUSTOMER_ID,
  invoiceDetail,
  invoiceSummary,
  nav,
  renderWithQuery,
  setupApi,
} from '../test-utils';

jest.mock('../src/store/auth');

const gst = { id: 'r1', name: 'GST', rateBps: 500, isDefault: true };
const customer = {
  id: CUSTOMER_ID,
  firstName: null,
  lastName: null,
  companyName: 'Acme Ltd',
  email: 'a@acme.co',
};

describe('StatusBadge', () => {
  it.each([
    ['draft', 'Draft'],
    ['sent', 'Sent'],
    ['viewed', 'Viewed'],
    ['partially_paid', 'Partially paid'],
    ['paid', 'Paid'],
    ['overdue', 'Overdue'],
    ['cancelled', 'Cancelled'],
    ['refunded', 'Refunded'],
  ] as const)('labels %s as text', async (status, label) => {
    await renderWithQuery(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });
});

describe('InvoiceListScreen', () => {
  const render = async (
    list = jest.fn(async () => ({
      items: [
        invoiceSummary(),
        invoiceSummary({
          id: 'i2',
          number: 'INV-0002',
          displayStatus: 'overdue',
          status: 'sent',
          customerName: 'Ann Lee',
          totalMinor: 25_000,
        }),
      ],
      total: 2,
    })),
  ) => {
    const api = setupApi({ listInvoices: list, getBusiness: jest.fn(async () => business) });
    const navigation = nav();
    await renderWithQuery(
      <InvoiceListScreen navigation={navigation as never} route={{} as never} />,
    );
    return { api, navigation };
  };

  it('lists invoices with amounts and status badges, and opens one', async () => {
    const { navigation } = await render();
    expect(await screen.findByText('Acme Ltd')).toBeTruthy();
    expect(screen.getByText('$1,050.00')).toBeTruthy();
    expect(screen.getByLabelText('Status: Overdue')).toBeTruthy();
    expect(screen.getByLabelText('Status: Sent')).toBeTruthy();
    await fireEvent.press(screen.getByText('Acme Ltd'));
    expect(navigation.navigate).toHaveBeenCalledWith('Invoice', { id: 'i1' });
  });

  it('filters by status on the server', async () => {
    const { api } = await render();
    await screen.findByText('Acme Ltd');
    await fireEvent.press(screen.getByRole('button', { name: 'Overdue' }));
    await waitFor(() =>
      expect(api.listInvoices).toHaveBeenCalledWith(expect.objectContaining({ status: 'overdue' })),
    );
  });

  it('filters by date preset using the business timezone', async () => {
    const { api } = await render();
    await screen.findByText('Acme Ltd');
    // Dates sit behind one button, so they don't push the list down.
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
    await fireEvent.press(screen.getByLabelText('Date filter: Any date'));
    await fireEvent.press(screen.getByRole('button', { name: 'Today' }));
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull(); // closes on pick
    await waitFor(() => {
      const last = (api.listInvoices as jest.Mock).mock.calls.at(-1)[0];
      expect(last.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(last.from).toBe(last.to);
    });
    await fireEvent.press(screen.getByLabelText('Date filter: Today'));
    await fireEvent.press(screen.getByRole('button', { name: 'This month' }));
    await waitFor(() => {
      const last = (api.listInvoices as jest.Mock).mock.calls.at(-1)[0];
      expect(last.from.endsWith('-01')).toBe(true);
      expect(last.to > last.from).toBe(true);
    });
  });

  it('sends the search text and shows an empty state', async () => {
    const list = jest.fn(async () => ({ items: [], total: 0 }));
    const { api } = await render(list);
    expect(await screen.findByText('Create your first invoice')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search invoices'), '125.50');
    await waitFor(() =>
      expect(api.listInvoices).toHaveBeenCalledWith(expect.objectContaining({ search: '125.50' })),
    );
    expect(await screen.findByText('No matching invoices')).toBeTruthy();
    await fireEvent.press(screen.getByText('Clear filters'));
    expect(await screen.findByText('Create your first invoice')).toBeTruthy();
    expect(screen.getByLabelText('Search invoices').props.value).toBe('');
  });

  it('counts the invoices shown and offers creating one from the empty state', async () => {
    const list = jest.fn(async () => ({ items: [], total: 0 }));
    const { navigation } = await render(list);
    expect(await screen.findByText('0 invoices')).toBeTruthy();
    await fireEvent.press(screen.getAllByLabelText('New invoice')[0]!);
    expect(navigation.navigate).toHaveBeenCalledWith('Invoice');
  });
});

describe('invoice row timing', () => {
  const t = (displayStatus: string, dueDate: string) =>
    dueTiming({ displayStatus, dueDate } as never, '2026-10-02');

  it('counts down for invoices still awaiting money, and flags late ones', () => {
    expect(t('sent', '2026-10-07')).toEqual({ text: 'Due in 5 days', urgent: false });
    expect(t('viewed', '2026-10-03')).toEqual({ text: 'Due in 1 day', urgent: false });
    expect(t('partially_paid', '2026-10-02')).toEqual({ text: 'Due today', urgent: true });
    expect(t('overdue', '2026-09-20')).toEqual({ text: 'Overdue by 12 days', urgent: true });
  });

  it('shows the plain due date for drafts and settled invoices', () => {
    for (const status of ['draft', 'paid', 'cancelled', 'refunded'])
      expect(t(status, '2026-09-20')).toEqual({ text: 'Due Sep 20, 2026', urgent: false });
  });
});

describe('InvoiceListScreen summary', () => {
  it('shows the business-wide balance owed next to the unfiltered list only', async () => {
    setupApi({
      listInvoices: jest.fn(async () => ({ items: [invoiceSummary()], total: 12 })),
      getBusiness: jest.fn(async () => business),
      getDashboard: jest.fn(async () => ({
        currencies: [{ currency: 'USD', outstandingMinor: 2_485_000 }],
      })),
    });
    await renderWithQuery(<InvoiceListScreen navigation={nav() as never} route={{} as never} />);
    expect(await screen.findByText('12 invoices · $24,850.00 outstanding')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Draft' }));
    expect(await screen.findByText('12 invoices')).toBeTruthy();
  });
});

describe('InvoiceScreen: new invoice', () => {
  const setup = (extra: Record<string, jest.Mock> = {}) => {
    const api = setupApi({
      getBusiness: jest.fn(async () => business),
      listTaxRates: jest.fn(async () => ({ items: [gst] })),
      listCustomers: jest.fn(async () => ({ items: [customer], total: 1 })),
      listProducts: jest.fn(async () => ({ items: [], total: 0 })),
      createInvoice: jest.fn(async () => invoiceDetail()),
      ...extra,
    });
    const navigation = nav();
    return { api, navigation };
  };
  const open = async (navigation: ReturnType<typeof nav>) => {
    await renderWithQuery(
      <InvoiceScreen navigation={navigation as never} route={{ params: undefined } as never} />,
    );
    await screen.findByText('New invoice');
  };

  it('creates an invoice and shows live totals from the shared calculator', async () => {
    const { api, navigation } = setup();
    await open(navigation);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose customer' }));
    await fireEvent.press(await screen.findByText('Acme Ltd'));
    await fireEvent.changeText(screen.getByLabelText('Item 1 description'), 'Web Development');
    await fireEvent.changeText(screen.getByLabelText('Item 1 quantity'), '10');
    await fireEvent.changeText(screen.getByLabelText('Item 1 unit price'), '100');
    // 10 x 100.00 = 1000.00 + 5% default tax = 1050.00
    expect(await screen.findAllByText('$1,050.00')).not.toHaveLength(0);

    await fireEvent.press(screen.getByRole('button', { name: 'Create invoice' }));
    await waitFor(() => expect(api.createInvoice).toHaveBeenCalled());
    expect(api.createInvoice).toHaveBeenCalledWith(
      expect.objectContaining({
        customerId: CUSTOMER_ID,
        currency: 'USD',
        number: null,
        feesMinor: 0,
        items: [
          expect.objectContaining({
            description: 'Web Development',
            quantityMilli: 10_000,
            unitPriceMinor: 10_000,
            taxes: [{ name: 'GST', rateBps: 500 }],
          }),
        ],
      }),
    );
    // No totals are ever sent: the server computes them.
    const sent = (api.createInvoice as jest.Mock).mock.calls[0][0];
    expect(sent.totalMinor).toBeUndefined();
    expect(navigation.replace).toHaveBeenCalledWith('Invoice', { id: 'i1' });
  });

  it('shows field errors and does not call the API when the form is invalid', async () => {
    const { api, navigation } = setup();
    await open(navigation);
    await fireEvent.press(screen.getByRole('button', { name: 'Create invoice' }));
    expect(await screen.findByText('Choose a customer')).toBeTruthy();
    expect(screen.getByText('Enter a description')).toBeTruthy();
    expect(screen.getByText(/Enter a price/)).toBeTruthy();
    expect(api.createInvoice).not.toHaveBeenCalled();
  });

  it('flags an impossible fixed discount in the live preview', async () => {
    const { navigation } = setup();
    await open(navigation);
    await fireEvent.changeText(screen.getByLabelText('Item 1 unit price'), '10');
    await fireEvent.press(screen.getByRole('button', { name: 'Fixed amount' }));
    await fireEvent.changeText(screen.getByLabelText('Discount amount (USD)'), '999');
    expect(await screen.findByText('Discount cannot exceed the subtotal')).toBeTruthy();
  });

  it('shows a plain-language message when the server rejects the number', async () => {
    const { navigation } = setup({
      createInvoice: jest.fn(async () => {
        throw new ApiError('unknown', 409, 'NUMBER_EXISTS');
      }),
    });
    await open(navigation);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose customer' }));
    await fireEvent.press(await screen.findByText('Acme Ltd'));
    await fireEvent.changeText(screen.getByLabelText('Item 1 description'), 'x');
    await fireEvent.changeText(screen.getByLabelText('Item 1 unit price'), '5');
    await fireEvent.changeText(screen.getByLabelText('Invoice number'), 'INV-0001');
    await fireEvent.press(screen.getByRole('button', { name: 'Create invoice' }));
    expect(await screen.findByText(/already used/)).toBeTruthy();
  });

  it('shows a friendly message for server failures (no raw error)', async () => {
    const { navigation } = setup({
      createInvoice: jest.fn(async () => {
        throw new ApiError('server', 500, 'INTERNAL');
      }),
    });
    await open(navigation);
    await fireEvent.press(screen.getByRole('button', { name: 'Choose customer' }));
    await fireEvent.press(await screen.findByText('Acme Ltd'));
    await fireEvent.changeText(screen.getByLabelText('Item 1 description'), 'x');
    await fireEvent.changeText(screen.getByLabelText('Item 1 unit price'), '5');
    await fireEvent.press(screen.getByRole('button', { name: 'Create invoice' }));
    expect(await screen.findByText(/servers are having trouble/)).toBeTruthy();
  });
});

describe('InvoiceScreen: existing invoice', () => {
  const setup = (inv = invoiceDetail(), extra: Record<string, jest.Mock> = {}) => {
    const api = setupApi({
      getBusiness: jest.fn(async () => business),
      listTaxRates: jest.fn(async () => ({ items: [gst] })),
      getInvoice: jest.fn(async () => inv),
      updateInvoice: jest.fn(async () => inv),
      transitionInvoice: jest.fn(async () => inv),
      deleteInvoice: jest.fn(async () => undefined),
      getInvoiceActivity: jest.fn(async () => ({
        items: [
          {
            id: 'a1',
            type: 'created',
            message: 'Invoice created',
            createdAt: '2026-10-01T10:00:00Z',
          },
        ],
      })),
      listCustomers: jest.fn(async () => ({ items: [], total: 0 })),
      listProducts: jest.fn(async () => ({ items: [], total: 0 })),
      ...extra,
    });
    return api;
  };
  const open = async () => {
    const navigation = nav();
    await renderWithQuery(
      <InvoiceScreen navigation={navigation as never} route={{ params: { id: 'i1' } } as never} />,
    );
    await screen.findByText('INV-0001');
    return navigation;
  };

  it('loads the invoice into the form and saves with the version for conflict detection', async () => {
    const api = setup();
    await open();
    expect(screen.getByDisplayValue('Web Development')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Item 1 quantity'), '12');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateInvoice).toHaveBeenCalled());
    const [id, body] = (api.updateInvoice as jest.Mock).mock.calls[0];
    expect(id).toBe('i1');
    expect(body).toMatchObject({
      version: 2,
      number: 'INV-0001',
      items: [{ quantityMilli: 12_000 }],
    });
  });

  it('does not allow editing a paid invoice', async () => {
    setup(
      invoiceDetail({
        status: 'paid',
        displayStatus: 'paid',
        editable: false,
        amountPaidMinor: 105_000,
        balanceDueMinor: 0,
      }),
    );
    await open();
    expect(await screen.findByText(/can no longer be edited because it is paid/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel invoice' })).toBeNull();
  });

  it('shows server totals in Preview and the timeline in History', async () => {
    setup();
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Balance due')).toBeTruthy();
    expect(screen.getAllByText('$1,050.00').length).toBeGreaterThan(0);
    expect(screen.getByText('GST (5%)')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'History' }));
    expect(await screen.findByText('Invoice created')).toBeTruthy();
  });

  it('marks a draft as sent', async () => {
    const api = setup(invoiceDetail({ status: 'draft', displayStatus: 'draft' }));
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Mark as sent' }));
    await waitFor(() => expect(api.transitionInvoice).toHaveBeenCalledWith('i1', 'sent'));
  });

  it('confirms before deleting a draft', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    const api = setup(invoiceDetail({ status: 'draft', displayStatus: 'draft' }));
    const navigation = await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete draft' }));
    await waitFor(() => expect(api.deleteInvoice).toHaveBeenCalledWith('i1'));
    expect(alert).toHaveBeenCalled();
    await waitFor(() => expect(navigation.popToTop).toHaveBeenCalled());
    alert.mockRestore();
  });

  it('shows the server explanation when an action is refused', async () => {
    setup(invoiceDetail({ status: 'draft', displayStatus: 'draft' }), {
      transitionInvoice: jest.fn(async () => {
        throw new ApiError('unknown', 409, 'INVALID_TRANSITION');
      }),
    });
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Mark as sent' }));
    expect(await screen.findByText('That change is not allowed for this invoice.')).toBeTruthy();
  });
});

describe('TaxRatesScreen', () => {
  it('adds a rate as basis points and validates the percentage', async () => {
    const api = setupApi({
      listTaxRates: jest.fn(async () => ({ items: [gst] })),
      createTaxRate: jest.fn(async () => gst),
    });
    await renderWithQuery(<TaxRatesScreen />);
    expect(await screen.findByText('GST')).toBeTruthy();
    expect(screen.getByText('5%')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Tax name'), 'HST');
    await fireEvent.changeText(screen.getByLabelText('Rate (%)'), '101');
    await fireEvent.press(screen.getByRole('button', { name: 'Add tax rate' }));
    expect(await screen.findByText(/percentage from 0 to 100/)).toBeTruthy();
    expect(api.createTaxRate).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByLabelText('Rate (%)'), '13');
    await fireEvent.press(screen.getByRole('button', { name: 'Add tax rate' }));
    await waitFor(() =>
      expect(api.createTaxRate).toHaveBeenCalledWith({
        name: 'HST',
        rateBps: 1300,
        isDefault: false,
      }),
    );
  });
});
