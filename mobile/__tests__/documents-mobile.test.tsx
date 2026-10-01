import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Linking, Share } from 'react-native';
import { InvoiceScreen } from '../src/screens/InvoiceScreen';
import { SendInvoiceScreen } from '../src/screens/SendInvoiceScreen';
import { ApiError } from '../src/services/api';
import { business, invoiceDetail, nav, renderWithQuery, setupApi } from '../test-utils';

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

const baseApi = (inv = invoiceDetail(), extra: Record<string, jest.Mock> = {}) =>
  setupApi({
    getBusiness: jest.fn(async () => ({
      ...business,
      name: 'Acme Studio',
      paymentInstructions: 'E-transfer to pay@acme.test',
    })),
    listTaxRates: jest.fn(async () => ({ items: [gst] })),
    getInvoice: jest.fn(async () => inv),
    getBusinessAssetUri: jest.fn(async () => null),
    downloadInvoicePdf: jest.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46])),
    createShareLink: jest.fn(async () => ({ url: 'https://api.test/pay/abc' })),
    listCustomers: jest.fn(async () => ({ items: [], total: 0 })),
    listProducts: jest.fn(async () => ({ items: [], total: 0 })),
    ...extra,
  });

describe('Preview tab', () => {
  const open = async (inv = invoiceDetail(), extra: Record<string, jest.Mock> = {}) => {
    const api = baseApi(inv, extra);
    const navigation = nav();
    await renderWithQuery(
      <InvoiceScreen navigation={navigation as never} route={{ params: { id: 'i1' } } as never} />,
    );
    await screen.findByText('INV-0001');
    await fireEvent.press(screen.getByRole('button', { name: 'Preview' }));
    await screen.findByText('Balance due');
    return { api, navigation };
  };
  beforeEach(() => jest.clearAllMocks());

  it('shows the professional invoice document', async () => {
    await open();
    expect(screen.getByText('Acme Studio')).toBeTruthy();
    expect(screen.getByText('BILL TO')).toBeTruthy();
    expect(screen.getByText('Web Development')).toBeTruthy();
    expect(screen.getByText('PAYMENT INFORMATION')).toBeTruthy();
    expect(screen.getByText('E-transfer to pay@acme.test')).toBeTruthy();
    expect(screen.getByText('GST (5%)')).toBeTruthy();
    expect(screen.getByText('billing@acme.test')).toBeTruthy();
  });

  it('opens the native PDF preview with the downloaded file', async () => {
    const { api } = await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Preview PDF' }));
    await waitFor(() =>
      expect(Print.printAsync).toHaveBeenCalledWith({ uri: 'file:///cache/INV-0001.pdf' }),
    );
    expect(api.downloadInvoicePdf).toHaveBeenCalledWith('i1');
  });

  it('shares the PDF through the native share sheet', async () => {
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Share PDF' }));
    await waitFor(() =>
      expect(Sharing.shareAsync).toHaveBeenCalledWith(
        'file:///cache/INV-0001.pdf',
        expect.objectContaining({ mimeType: 'application/pdf' }),
      ),
    );
  });

  it('shares the customer link as a message', async () => {
    const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Share link' }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect((share.mock.calls[0]![0] as { message: string }).message).toBe(
      'Invoice INV-0001 from Acme Studio: https://api.test/pay/abc',
    );
    share.mockRestore();
  });

  it('opens the payment page for a payable invoice', async () => {
    const open_ = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Pay invoice' }));
    await waitFor(() => expect(open_).toHaveBeenCalledWith('https://api.test/pay/abc'));
    open_.mockRestore();
  });

  it('hides pay and email for a paid invoice, but still allows the PDF', async () => {
    await open(
      invoiceDetail({
        status: 'paid',
        displayStatus: 'paid',
        editable: false,
        amountPaidMinor: 105_000,
        balanceDueMinor: 0,
      }),
    );
    expect(screen.queryByRole('button', { name: 'Pay invoice' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Email invoice' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Share PDF' })).toBeTruthy();
  });

  it('goes to the send screen', async () => {
    const { navigation } = await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Email invoice' }));
    expect(navigation.navigate).toHaveBeenCalledWith('SendInvoice', { id: 'i1' });
  });

  it('shows a friendly message when the PDF cannot be generated', async () => {
    await open(invoiceDetail(), {
      downloadInvoicePdf: jest.fn(async () => {
        throw new ApiError('server', 500, 'PDF_FAILED');
      }),
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Share PDF' }));
    expect(
      await screen.findByText('The PDF could not be generated. Please try again.'),
    ).toBeTruthy();
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });
});

describe('SendInvoiceScreen', () => {
  const open = async (inv = invoiceDetail(), extra: Record<string, jest.Mock> = {}) => {
    const api = baseApi(inv, {
      sendInvoice: jest.fn(async () => ({ invoice: inv, sentTo: 'billing@acme.test' })),
      ...extra,
    });
    const navigation = nav();
    await renderWithQuery(
      <SendInvoiceScreen
        navigation={navigation as never}
        route={{ params: { id: 'i1' } } as never}
      />,
    );
    await screen.findByLabelText('To');
    return { api, navigation };
  };
  beforeEach(() => jest.clearAllMocks());

  it('prefills recipient, subject and the standard message', async () => {
    await open();
    expect(screen.getByDisplayValue('billing@acme.test')).toBeTruthy();
    expect(screen.getByDisplayValue('Invoice INV-0001 from Acme Studio')).toBeTruthy();
    expect(
      screen.getByDisplayValue(
        'Hi Acme Ltd,\n\nPlease find attached invoice INV-0001 for $1,050.00.\n\nPayment is due on October 15, 2026.\n\nThank you.',
      ),
    ).toBeTruthy();
  });

  it('sends the edited email and confirms', async () => {
    const { api, navigation } = await open();
    await fireEvent.changeText(screen.getByLabelText('To'), 'Other@Example.com');
    await fireEvent.changeText(screen.getByLabelText('Subject'), 'Your invoice');
    await fireEvent.press(screen.getByRole('button', { name: 'Send invoice' }));
    await waitFor(() =>
      expect(api.sendInvoice).toHaveBeenCalledWith(
        'i1',
        expect.objectContaining({ to: 'other@example.com', subject: 'Your invoice' }),
      ),
    );
    expect(await screen.findByText('Invoice sent')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(navigation.goBack).toHaveBeenCalled();
  });

  it('validates the address before calling the server', async () => {
    const { api } = await open();
    await fireEvent.changeText(screen.getByLabelText('To'), 'not-an-email');
    await fireEvent.press(screen.getByRole('button', { name: 'Send invoice' }));
    expect(await screen.findByText('Enter a valid email address')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('To'), '');
    await fireEvent.press(screen.getByRole('button', { name: 'Send invoice' }));
    expect(await screen.findByText('Enter an email address')).toBeTruthy();
    expect(api.sendInvoice).not.toHaveBeenCalled();
  });

  it('shows a plain-language error when delivery fails', async () => {
    await open(invoiceDetail(), {
      sendInvoice: jest.fn(async () => {
        throw new ApiError('server', 502, 'EMAIL_FAILED');
      }),
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Send invoice' }));
    expect(await screen.findByText(/could not be sent/)).toBeTruthy();
    expect(screen.queryByText('Invoice sent')).toBeNull();
  });
});
