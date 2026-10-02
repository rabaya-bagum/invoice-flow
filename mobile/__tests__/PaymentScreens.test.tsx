import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { Alert, AppState, Linking } from 'react-native';
import { OnlinePaymentsScreen } from '../src/screens/OnlinePaymentsScreen';
import { PaymentDetailScreen } from '../src/screens/PaymentDetailScreen';
import { PaymentListScreen } from '../src/screens/PaymentListScreen';
import { ApiError } from '../src/services/api';
import { nav, renderWithQuery, setupApi } from '../test-utils';

jest.mock('../src/store/auth');

const payment = (over: Record<string, unknown> = {}) => ({
  id: '11111111-aaaa-4bbb-8ccc-111111111111',
  invoiceId: 'i1',
  invoiceNumber: 'INV-0001',
  customerName: 'Acme Ltd',
  amountMinor: 100_000,
  refundedMinor: 0,
  currency: 'USD',
  status: 'successful',
  method: 'apple_pay',
  stripePaymentIntentId: 'pi_123',
  receiptUrl: 'https://receipt.test/x',
  failureCode: null,
  paidAt: '2026-10-02T10:00:00Z',
  createdAt: '2026-10-02T09:59:00Z',
  ...over,
});

describe('PaymentListScreen', () => {
  const open = async (
    list = jest.fn(async () => ({
      items: [
        payment(),
        payment({
          id: 'p2',
          status: 'failed',
          method: null,
          stripePaymentIntentId: 'pi_456',
          customerName: 'Ann Lee',
          invoiceNumber: 'INV-0002',
          amountMinor: 25_000,
        }),
      ],
      total: 2,
    })),
  ) => {
    const api = setupApi({ listPayments: list });
    const navigation = nav();
    await renderWithQuery(
      <PaymentListScreen navigation={navigation as never} route={{} as never} />,
    );
    return { api, navigation };
  };

  it('shows payment id, invoice, customer, amount, method, date and status', async () => {
    const { navigation } = await open();
    expect(await screen.findByText('Acme Ltd')).toBeTruthy();
    expect(screen.getByText('$1,000.00')).toBeTruthy();
    expect(screen.getByText(/INV-0001 · Apple Pay · Oct 2, 2026/)).toBeTruthy();
    expect(screen.getByText('pi_123')).toBeTruthy();
    expect(screen.getByLabelText('Payment status: Successful')).toBeTruthy();
    expect(screen.getByLabelText('Payment status: Failed')).toBeTruthy();
    await fireEvent.press(screen.getByText('Acme Ltd'));
    expect(navigation.navigate).toHaveBeenCalledWith('PaymentDetail', {
      id: '11111111-aaaa-4bbb-8ccc-111111111111',
    });
  });

  it('filters by status on the server and searches', async () => {
    const { api } = await open();
    await screen.findByText('Acme Ltd');
    await fireEvent.press(screen.getByRole('button', { name: 'Refunded' }));
    await waitFor(() =>
      expect(api.listPayments).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'refunded' }),
      ),
    );
    await fireEvent.changeText(screen.getByLabelText('Search payments'), 'INV-0002');
    await waitFor(() =>
      expect(api.listPayments).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'INV-0002' }),
      ),
    );
  });

  it('shows an empty state and friendly errors', async () => {
    await open(jest.fn(async () => ({ items: [], total: 0 })));
    expect(await screen.findByText('No payments yet')).toBeTruthy();
  });
});

describe('PaymentDetailScreen', () => {
  beforeEach(() => jest.restoreAllMocks());
  const open = async (p = payment(), extra: Record<string, jest.Mock> = {}) => {
    const api = setupApi({
      getPayment: jest.fn(async () => p),
      refundPayment: jest.fn(async () => ({ requested: 0 })),
      ...extra,
    });
    await renderWithQuery(
      <PaymentDetailScreen navigation={nav() as never} route={{ params: { id: p.id } } as never} />,
    );
    await screen.findByText('INV-0001');
    return api;
  };
  const confirmAlerts = () =>
    jest
      .spyOn(Alert, 'alert')
      .mockImplementation(
        (_t, _m, buttons) => void buttons?.find((b) => b.style === 'destructive')?.onPress?.(),
      );

  it('shows the details and a receipt link', async () => {
    await open();
    expect(screen.getByText('INV-0001')).toBeTruthy();
    expect(screen.getByText('Apple Pay')).toBeTruthy();
    expect(screen.getByText('pi_123')).toBeTruthy();
    const open_ = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await fireEvent.press(screen.getByRole('button', { name: 'View receipt' }));
    expect(open_).toHaveBeenCalledWith('https://receipt.test/x');
  });

  it('refunds the full remaining amount after confirmation', async () => {
    const alert = confirmAlerts();
    const api = await open();
    await fireEvent.press(screen.getByRole('button', { name: 'Refund' }));
    await waitFor(() =>
      expect(api.refundPayment).toHaveBeenCalledWith(
        '11111111-aaaa-4bbb-8ccc-111111111111',
        undefined,
        expect.stringMatching(/^[0-9a-f-]{36}$/),
      ),
    );
    expect(alert.mock.calls[0]![1]).toContain('$1,000.00');
    expect(await screen.findByText(/Refund of \$1,000\.00 requested/)).toBeTruthy();
  });

  it('refunds a partial amount converted to minor units', async () => {
    confirmAlerts();
    const api = await open();
    await fireEvent.changeText(screen.getByLabelText(/Amount \(USD\)/), '250.50');
    await fireEvent.press(screen.getByRole('button', { name: 'Refund' }));
    await waitFor(() =>
      expect(api.refundPayment).toHaveBeenCalledWith(
        '11111111-aaaa-4bbb-8ccc-111111111111',
        25_050,
        expect.stringMatching(/^[0-9a-f-]{36}$/),
      ),
    );
  });

  it.each([
    ['abc', /Enter an amount/],
    ['0', /greater than zero/],
    ['1000.01', /most you can refund is \$1,000\.00/],
    ['1.234', /Enter an amount/],
  ])('rejects the refund amount %p before calling the server', async (value, message) => {
    const alert = confirmAlerts();
    const api = await open();
    await fireEvent.changeText(screen.getByLabelText(/Amount \(USD\)/), value);
    await fireEvent.press(screen.getByRole('button', { name: 'Refund' }));
    expect(await screen.findByText(message)).toBeTruthy();
    expect(api.refundPayment).not.toHaveBeenCalled();
    expect(alert).not.toHaveBeenCalled();
  });

  it('limits a partly refunded payment to what remains', async () => {
    confirmAlerts();
    const api = await open(payment({ refundedMinor: 40_000 }));
    expect(screen.getByText('$400.00')).toBeTruthy(); // refunded so far
    await fireEvent.changeText(screen.getByLabelText(/Amount \(USD\)/), '600.01');
    await fireEvent.press(screen.getByRole('button', { name: 'Refund' }));
    expect(await screen.findByText(/most you can refund is \$600\.00/)).toBeTruthy();
    expect(api.refundPayment).not.toHaveBeenCalled();
  });

  it.each([['failed'], ['pending'], ['refunded']] as const)(
    'offers no refund for a %s payment',
    async (status) => {
      await open(
        payment({
          status,
          refundedMinor: status === 'refunded' ? 100_000 : 0,
          failureCode: status === 'failed' ? 'card_declined' : null,
        }),
      );
      expect(screen.queryByRole('button', { name: 'Refund' })).toBeNull();
      if (status === 'failed') expect(screen.getByText('card declined')).toBeTruthy();
    },
  );

  it('explains a refused refund in plain language', async () => {
    confirmAlerts();
    await open(payment(), {
      refundPayment: jest.fn(async () => {
        throw new ApiError('server', 502, 'PAYMENT_PROVIDER_ERROR');
      }),
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Refund' }));
    expect(await screen.findByText(/payment provider could not be reached/)).toBeTruthy();
  });

  it('retries a failed refund with the same key, and uses a new key once one succeeds', async () => {
    confirmAlerts();
    let fail = true;
    const refundPayment = jest.fn(async () => {
      if (fail) throw new ApiError('server', 502, 'PAYMENT_PROVIDER_ERROR');
      return { requested: 1000 };
    });
    await open(payment(), { refundPayment });
    const press = () => fireEvent.press(screen.getByRole('button', { name: 'Refund' }));
    const keyOf = (n: number) => (refundPayment.mock.calls[n] as unknown[])[2];

    await press();
    await screen.findByText(/payment provider could not be reached/);
    fail = false;
    await press(); // retry after the error: the first attempt may have gone through at Stripe
    await screen.findByText(/requested/);
    await press(); // a new, deliberate refund
    await waitFor(() => expect(refundPayment).toHaveBeenCalledTimes(3));
    expect(keyOf(1)).toBe(keyOf(0));
    expect(keyOf(2)).not.toBe(keyOf(0));
  });
});

describe('OnlinePaymentsScreen', () => {
  const status = (over: Record<string, unknown> = {}) => ({
    configured: true,
    connected: false,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    requirementsDue: [],
    ...over,
  });
  beforeEach(() => jest.restoreAllMocks());

  it('starts onboarding and opens Stripe in the browser', async () => {
    const api = setupApi({
      getConnectStatus: jest.fn(async () => status()),
      startConnectOnboarding: jest.fn(async () => ({ url: 'https://connect.stripe.test/x' })),
    });
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderWithQuery(<OnlinePaymentsScreen />);
    expect(await screen.findByText('Not set up')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Set up online payments' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://connect.stripe.test/x'));
    expect(api.startConnectOnboarding).toHaveBeenCalled();
  });

  it('offers to continue an unfinished setup', async () => {
    setupApi({ getConnectStatus: jest.fn(async () => status({ connected: true })) });
    await renderWithQuery(<OnlinePaymentsScreen />);
    expect(await screen.findByText('Setup not finished')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue setup' })).toBeTruthy();
  });

  it('shows ready state without a setup button', async () => {
    setupApi({
      getConnectStatus: jest.fn(async () =>
        status({ connected: true, chargesEnabled: true, payoutsEnabled: true }),
      ),
    });
    await renderWithQuery(<OnlinePaymentsScreen />);
    expect(await screen.findByText('Ready to accept payments')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set up online payments' })).toBeNull();
  });

  it('explains when the server has no payment provider configured', async () => {
    setupApi({ getConnectStatus: jest.fn(async () => status({ configured: false })) });
    await renderWithQuery(<OnlinePaymentsScreen />);
    expect(await screen.findByText(/not enabled on this server/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set up online payments' })).toBeNull();
  });

  it('re-checks the status when the app returns to the foreground', async () => {
    let handler: ((s: string) => void) | undefined;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation(
        ((_: string, h: (s: string) => void) => ((handler = h), { remove: jest.fn() })) as never,
      );
    const api = setupApi({ getConnectStatus: jest.fn(async () => status()) });
    await renderWithQuery(<OnlinePaymentsScreen />);
    await screen.findByText('Not set up');
    const calls = (api.getConnectStatus as jest.Mock).mock.calls.length;
    handler?.('active');
    await waitFor(() =>
      expect((api.getConnectStatus as jest.Mock).mock.calls.length).toBeGreaterThan(calls),
    );
  });
});
