import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { usePushNotifications } from '../src/hooks/usePushNotifications';
import { openTarget } from '../src/navigation/ref';
import { SettingsScreen } from '../src/screens/SettingsScreen';
import * as push from '../src/services/push';
import { useAuth } from '../src/store/auth';

jest.mock('../src/store/auth');
jest.mock('../src/navigation/ref', () => ({
  openTarget: jest.fn(),
  flushPendingTarget: jest.fn(),
  navigationRef: {},
}));
jest.mock('../src/services/push', () => ({
  configureNotificationHandler: jest.fn(),
  isPushPreferenceOn: jest.fn(),
  setPushPreference: jest.fn(async () => undefined),
  registerForPush: jest.fn(),
  unregisterPush: jest.fn(async () => undefined),
  routeForNotification: jest.requireActual('../src/services/push').routeForNotification,
}));
jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: jest.fn(async () => null),
  addNotificationReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
}));
jest.mock('expo-device', () => ({ isDevice: true }));
jest.mock('expo-secure-store', () => ({}));
jest.mock('expo-constants', () => ({ __esModule: true, default: {} }));

const P = push as unknown as Record<string, jest.Mock>;
const N = Notifications as unknown as Record<string, jest.Mock>;
const api = { registerPushToken: jest.fn(), removePushToken: jest.fn() };

function Probe() {
  usePushNotifications();
  return null;
}
const mountHook = async () => {
  const client = new QueryClient();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <Probe />
    </QueryClientProvider>,
  );
  return invalidate;
};

beforeEach(() => {
  jest.clearAllMocks();
  (useAuth as jest.Mock).mockReturnValue({ api });
  P.isPushPreferenceOn.mockResolvedValue(true);
  P.registerForPush.mockResolvedValue('registered');
  N.getLastNotificationResponseAsync.mockResolvedValue(null);
});

describe('usePushNotifications', () => {
  it('does nothing on web, where expo-notifications is unavailable', async () => {
    jest.replaceProperty(Platform, 'OS', 'web');
    await mountHook();
    expect(P.configureNotificationHandler).not.toHaveBeenCalled();
    expect(P.registerForPush).not.toHaveBeenCalled();
    expect(N.getLastNotificationResponseAsync).not.toHaveBeenCalled();
    expect(N.addNotificationReceivedListener).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  it('registers the device on mount when notifications are on', async () => {
    await mountHook();
    await waitFor(() => expect(P.registerForPush).toHaveBeenCalledWith(api));
    expect(P.configureNotificationHandler).toHaveBeenCalled();
  });

  it('does not register (or prompt) when the user turned notifications off', async () => {
    P.isPushPreferenceOn.mockResolvedValue(false);
    await mountHook();
    await waitFor(() => expect(N.getLastNotificationResponseAsync).toHaveBeenCalled());
    expect(P.registerForPush).not.toHaveBeenCalled();
  });

  it('opens the invoice when a notification is tapped', async () => {
    await mountHook();
    await waitFor(() => expect(N.addNotificationResponseReceivedListener).toHaveBeenCalled());
    const handler = N.addNotificationResponseReceivedListener.mock.calls[0]![0] as (
      r: unknown,
    ) => void;
    handler({ notification: { request: { content: { data: { invoiceId: 'inv-9' } } } } });
    expect(openTarget).toHaveBeenCalledWith({
      tab: 'InvoicesTab',
      screen: 'Invoice',
      params: { id: 'inv-9' },
    });
    handler({ notification: { request: { content: { data: {} } } } }); // no invoice: nothing to open
    expect(openTarget).toHaveBeenLastCalledWith(null);
  });

  it('handles the tap that launched the app', async () => {
    N.getLastNotificationResponseAsync.mockResolvedValue({
      notification: { request: { content: { data: { invoiceId: 'cold-1' } } } },
    });
    await mountHook();
    await waitFor(() =>
      expect(openTarget).toHaveBeenCalledWith({
        tab: 'InvoicesTab',
        screen: 'Invoice',
        params: { id: 'cold-1' },
      }),
    );
  });

  it('refreshes notifications and invoices when one arrives in the foreground', async () => {
    const invalidate = await mountHook();
    await waitFor(() => expect(N.addNotificationReceivedListener).toHaveBeenCalled());
    (N.addNotificationReceivedListener.mock.calls[0]![0] as () => void)();
    const keysInvalidated = invalidate.mock.calls.map((c) =>
      JSON.stringify((c[0] as { queryKey: unknown }).queryKey),
    );
    expect(keysInvalidated).toEqual(expect.arrayContaining(['["notifications"]', '["invoices"]']));
  });

  it('removes its listeners on unmount', async () => {
    const remove = jest.fn();
    N.addNotificationReceivedListener.mockReturnValue({ remove });
    N.addNotificationResponseReceivedListener.mockReturnValue({ remove });
    const client = new QueryClient();
    const view = await render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(P.registerForPush).toHaveBeenCalled());
    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(2);
  });
});

describe('Settings: push notifications switch', () => {
  const auth = {
    api,
    session: { user: { email: 'a@b.co' } },
    biometricEnabled: false,
    signOut: jest.fn(),
    isBiometricAvailable: jest.fn(async () => false),
    setBiometricEnabled: jest.fn(),
  };
  const open = async (on = true) => {
    P.isPushPreferenceOn.mockResolvedValue(on);
    (useAuth as jest.Mock).mockReturnValue(auth);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SettingsScreen />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByLabelText('Push notifications').props.value).toBe(on));
  };

  it('turning it off unregisters the device and remembers the choice', async () => {
    await open(true);
    await fireEvent(screen.getByLabelText('Push notifications'), 'valueChange', false);
    await waitFor(() => expect(P.unregisterPush).toHaveBeenCalledWith(api));
    expect(P.setPushPreference).toHaveBeenCalledWith(false);
  });

  it('turning it on registers the device', async () => {
    await open(false);
    await fireEvent(screen.getByLabelText('Push notifications'), 'valueChange', true);
    await waitFor(() => expect(P.registerForPush).toHaveBeenCalledWith(api));
    await waitFor(() => expect(P.setPushPreference).toHaveBeenCalledWith(true));
  });

  it('explains a blocked permission and offers the device settings', async () => {
    P.registerForPush.mockResolvedValue('denied');
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await open(false);
    await fireEvent(screen.getByLabelText('Push notifications'), 'valueChange', true);
    expect(await screen.findByText(/blocked for InvoiceFlow/)).toBeTruthy();
    expect(P.setPushPreference).not.toHaveBeenCalledWith(true); // not switched on without permission
    await fireEvent.press(screen.getByRole('button', { name: 'Open device settings' }));
    expect(openSettings).toHaveBeenCalled();
  });

  it.each([
    ['unsupported', /physical phone/],
    ['error', /Could not turn on/],
  ])('explains the %s outcome', async (outcome, message) => {
    P.registerForPush.mockResolvedValue(outcome);
    await open(false);
    await fireEvent(screen.getByLabelText('Push notifications'), 'valueChange', true);
    expect(await screen.findByText(message)).toBeTruthy();
  });
});
