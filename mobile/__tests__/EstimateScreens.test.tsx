import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Print from 'expo-print';
import { Alert } from 'react-native';
import { EstimateListScreen } from '../src/screens/EstimateListScreen';
import { EstimateScreen } from '../src/screens/EstimateScreen';
import { SendEstimateScreen } from '../src/screens/SendEstimateScreen';
import { estimateAsInvoice } from '../src/utils/estimate';
import {
  business,
  CUSTOMER_ID,
  estimateDetail,
  estimateSummary,
  invoiceDetail,
  nav,
  renderWithQuery,
  setupApi,
} from '../test-utils';

jest.mock('../src/store/auth');
jest.mock('expo-print', () => ({ printAsync: jest.fn(async () => undefined) }));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache/' },
  File: class {
    uri: string;
    constructor(dir: string, name: string) {
      this.uri = `${dir}${name}`;
    }
    create() {}
    write() {}
  },
}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-image-manipulator', () => ({}));

const gst = { id: 'r1', name: 'GST', rateBps: 500, isDefault: true };
const customer = {
  id: CUSTOMER_ID,
  firstName: null,
  lastName: null,
  companyName: 'Acme Ltd',
  email: 'a@acme.co',
};

describe('EstimateListScreen', () => {
  const open = async (
    items = [
      estimateSummary(),
      estimateSummary({
        id: 'e2',
        number: 'EST-0002',
        customerName: 'Ann Lee',
        status: 'sent',
        displayStatus: 'expired',
      }),
    ],
  ) => {
    const api = setupApi({ listEstimates: jest.fn(async () => ({ items, total: items.length })) });
    const navigation = nav();
    await renderWithQuery(
      <EstimateListScreen navigation={navigation as never} route={{} as never} />,
    );
    return { api, navigation };
  };

  it('lists estimates with amounts and statuses, and opens one', async () => {
    const { navigation } = await open();
    expect(await screen.findByText('Acme Ltd')).toBeTruthy();
    expect(screen.getAllByText('$1,050.00')).toHaveLength(2);
    expect(screen.getByLabelText('Status: Draft')).toBeTruthy();
    expect(screen.getByLabelText('Status: Expired')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText(/^Estimate EST-0001/));
    expect(navigation.navigate).toHaveBeenCalledWith('Estimate', { id: 'e1' });
  });

  it('filters by status and searches', async () => {
    const { api } = await open();
    await screen.findByText('Acme Ltd');
    await fireEvent.press(screen.getByRole('button', { name: 'Accepted' }));
    await waitFor(() =>
      expect(api.listEstimates).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'accepted' }),
      ),
    );
    await fireEvent.changeText(screen.getByLabelText('Search estimates'), 'Ann');
    await waitFor(() =>
      expect(api.listEstimates).toHaveBeenCalledWith(expect.objectContaining({ search: 'Ann' })),
    );
  });

  it('starts a new estimate and explains an empty list', async () => {
    const { navigation } = await open([]);
    expect(await screen.findByText('No estimates yet')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('New estimate'));
    expect(navigation.navigate).toHaveBeenCalledWith('Estimate');
  });
});

describe('EstimateScreen: new estimate', () => {
  it('creates an estimate with an expiry date and no totals', async () => {
    const api = setupApi({
      getBusiness: jest.fn(async () => business),
      listTaxRates: jest.fn(async () => ({ items: [gst] })),
      listCustomers: jest.fn(async () => ({ items: [customer], total: 1 })),
      listProducts: jest.fn(async () => ({ items: [], total: 0 })),
      createEstimate: jest.fn(async () => estimateDetail()),
    });
    const navigation = nav();
    await renderWithQuery(
      <EstimateScreen navigation={navigation as never} route={{ params: undefined } as never} />,
    );
    await screen.findByText('New estimate');
    expect(screen.getByLabelText('Estimate number')).toBeTruthy();
    expect(screen.getByLabelText('Valid until')).toBeTruthy();
    expect(screen.queryByLabelText('Due date')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Choose customer' }));
    await fireEvent.press(await screen.findByText('Acme Ltd'));
    await fireEvent.changeText(screen.getByLabelText('Item 1 description'), 'Web Development');
    await fireEvent.changeText(screen.getByLabelText('Item 1 quantity'), '10');
    await fireEvent.changeText(screen.getByLabelText('Item 1 unit price'), '100');
    await fireEvent.press(screen.getByRole('button', { name: 'Create estimate' }));

    await waitFor(() => expect(api.createEstimate).toHaveBeenCalled());
    const sent = (api.createEstimate as jest.Mock).mock.calls[0][0];
    expect(sent).toMatchObject({ customerId: CUSTOMER_ID, currency: 'USD', number: null });
    expect(sent.expiryDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent.dueDate).toBeUndefined();
    expect(sent.totalMinor).toBeUndefined();
    expect(navigation.replace).toHaveBeenCalledWith('Estimate', { id: 'e1' });
  });
});

describe('EstimateScreen: existing estimate', () => {
  const setup = (est = estimateDetail(), extra: Record<string, jest.Mock> = {}) =>
    setupApi({
      getBusiness: jest.fn(async () => business),
      listTaxRates: jest.fn(async () => ({ items: [gst] })),
      getEstimate: jest.fn(async () => est),
      updateEstimate: jest.fn(async () => est),
      transitionEstimate: jest.fn(async () => est),
      deleteEstimate: jest.fn(async () => undefined),
      convertEstimate: jest.fn(async () => ({
        estimate: est,
        invoice: invoiceDetail({ id: 'inv-9', status: 'draft' }),
      })),
      downloadEstimatePdf: jest.fn(async () => new Uint8Array([37, 80, 68, 70])),
      listCustomers: jest.fn(async () => ({ items: [], total: 0 })),
      listProducts: jest.fn(async () => ({ items: [], total: 0 })),
      ...extra,
    });
  const open = async () => {
    const navigation = nav();
    await renderWithQuery(
      <EstimateScreen navigation={navigation as never} route={{ params: { id: 'e1' } } as never} />,
    );
    await screen.findByText('EST-0001');
    return navigation;
  };
  const confirmAll = () =>
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style !== 'cancel')?.onPress?.();
    });

  it('saves edits as expiryDate with the version', async () => {
    const api = setup();
    await open();
    expect(screen.getByDisplayValue('Web Development')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Item 1 quantity'), '12');
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(api.updateEstimate).toHaveBeenCalled());
    const [id, body] = (api.updateEstimate as jest.Mock).mock.calls[0];
    expect(id).toBe('e1');
    expect(body).toMatchObject({
      version: 2,
      number: 'EST-0001',
      expiryDate: '2026-10-31',
      items: [{ quantityMilli: 12_000 }],
    });
    expect(body.dueDate).toBeUndefined();
  });

  it('marks a draft as sent', async () => {
    const api = setup();
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Mark as sent' }));
    await waitFor(() => expect(api.transitionEstimate).toHaveBeenCalledWith('e1', 'sent'));
  });

  it('records the customer decision on a sent estimate', async () => {
    const alert = confirmAll();
    const api = setup(estimateDetail({ status: 'sent', displayStatus: 'sent' }));
    await open();
    expect(screen.queryByRole('button', { name: 'Mark as sent' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Mark accepted' }));
    await waitFor(() => expect(api.transitionEstimate).toHaveBeenCalledWith('e1', 'accepted'));
    await fireEvent.press(screen.getByRole('button', { name: 'Mark declined' }));
    await waitFor(() => expect(api.transitionEstimate).toHaveBeenCalledWith('e1', 'rejected'));
    alert.mockRestore();
  });

  it('confirms, converts, and opens the new invoice', async () => {
    const alert = confirmAll();
    const api = setup(
      estimateDetail({ status: 'accepted', displayStatus: 'accepted', editable: false }),
    );
    const navigation = await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Convert to invoice' }));
    await waitFor(() => expect(api.convertEstimate).toHaveBeenCalledWith('e1'));
    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith('Invoice', { id: 'inv-9' }),
    );
    expect(alert).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('locks a converted estimate and links to its invoice', async () => {
    setup(
      estimateDetail({
        status: 'accepted',
        displayStatus: 'accepted',
        editable: false,
        convertible: false,
        convertedInvoiceId: 'inv-9',
      }),
    );
    const navigation = await open();
    expect(screen.getByText('This estimate was turned into an invoice.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Convert to invoice' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Open invoice' }));
    expect(navigation.navigate).toHaveBeenCalledWith('Invoice', { id: 'inv-9' });
  });

  it('does not offer conversion or editing for a declined estimate', async () => {
    setup(
      estimateDetail({
        status: 'rejected',
        displayStatus: 'rejected',
        editable: false,
        convertible: false,
      }),
    );
    await open();
    expect(screen.queryByRole('button', { name: 'Convert to invoice' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark accepted' })).toBeNull();
    expect(screen.getByLabelText('Status: Declined')).toBeTruthy();
  });

  it('deletes a draft after confirming', async () => {
    const alert = confirmAll();
    const api = setup();
    const navigation = await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete draft' }));
    await waitFor(() => expect(api.deleteEstimate).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(navigation.popToTop).toHaveBeenCalled());
    alert.mockRestore();
  });

  it('previews an estimate without payment lines and prints its PDF', async () => {
    const api = setup();
    const navigation = await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('ESTIMATE')).toBeTruthy();
    expect(screen.getByText(/Valid until/)).toBeTruthy();
    expect(screen.queryByText('Balance due')).toBeNull();
    expect(screen.queryByText('Pay invoice')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Preview PDF' }));
    await waitFor(() => expect(api.downloadEstimatePdf).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(Print.printAsync).toHaveBeenCalled());
    await fireEvent.press(screen.getByRole('button', { name: 'Email estimate' }));
    expect(navigation.navigate).toHaveBeenCalledWith('SendEstimate', { id: 'e1' });
  });

  it('shows the server explanation when an action is refused', async () => {
    const { ApiError } = jest.requireActual('../src/services/api');
    setup(estimateDetail(), {
      transitionEstimate: jest.fn(async () => {
        throw new ApiError(409, 'INVALID_TRANSITION', 'A sent estimate cannot become sent');
      }),
    });
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Mark as sent' }));
    expect(await screen.findByText(/cannot become sent|went wrong|try again/i)).toBeTruthy();
  });
});

describe('SendEstimateScreen', () => {
  const open = async (est = estimateDetail(), extra: Record<string, jest.Mock> = {}) => {
    const api = setupApi({
      getEstimate: jest.fn(async () => est),
      getBusiness: jest.fn(async () => ({ ...business, name: 'Acme Studio' })),
      sendEstimate: jest.fn(async () => ({ estimate: est, sentTo: 'billing@acme.test' })),
      ...extra,
    });
    const navigation = nav();
    await renderWithQuery(
      <SendEstimateScreen
        navigation={navigation as never}
        route={{ params: { id: 'e1' } } as never}
      />,
    );
    await screen.findByDisplayValue('Estimate EST-0001 from Acme Studio');
    return { api, navigation };
  };

  it('prefills a default email and sends it', async () => {
    const { api } = await open();
    expect(screen.getByDisplayValue('billing@acme.test')).toBeTruthy();
    expect(screen.getByDisplayValue(/valid until October 31, 2026/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Send estimate' }));
    await waitFor(() =>
      expect(api.sendEstimate).toHaveBeenCalledWith(
        'e1',
        expect.objectContaining({ to: 'billing@acme.test' }),
      ),
    );
    expect(await screen.findByText('Estimate sent')).toBeTruthy();
  });

  it('asks for a recipient when the customer has no email', async () => {
    const { api } = await open(estimateDetail({ customerEmail: null }));
    await fireEvent.press(screen.getByRole('button', { name: 'Send estimate' }));
    expect(await screen.findByText('Enter an email address')).toBeTruthy();
    expect(api.sendEstimate).not.toHaveBeenCalled();
  });
});

describe('estimate adapter', () => {
  it('fills payment fields so the invoice components can render an estimate', () => {
    const inv = estimateAsInvoice(estimateDetail() as never);
    expect(inv).toMatchObject({
      dueDate: '2026-10-31',
      amountPaidMinor: 0,
      balanceDueMinor: 105_000,
      sentAt: null,
    });
  });
});
