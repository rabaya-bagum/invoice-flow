import * as Notifications from 'expo-notifications';
import {
  isPushPreferenceOn,
  registerForPush,
  routeForNotification,
  setPushPreference,
  unregisterPush,
} from '../src/services/push';

const mockDevice = { isDevice: true };
jest.mock('expo-device', () => ({
  get isDevice() {
    return mockDevice.isDevice;
  },
}));
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { eas: { projectId: 'proj-1' } } } },
}));
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  setNotificationHandler: jest.fn(),
  AndroidImportance: { HIGH: 4 },
}));
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));

const N = Notifications as unknown as Record<string, jest.Mock>;
const api = () => ({
  registerPushToken: jest.fn(async () => undefined),
  removePushToken: jest.fn(async () => undefined),
});

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  mockDevice.isDevice = true;
  N.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
  N.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
});

describe('registerForPush', () => {
  it('registers the Expo token with the server when permission is granted', async () => {
    const a = api();
    expect(await registerForPush(a)).toBe('registered');
    expect(N.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'proj-1' });
    expect(a.registerPushToken).toHaveBeenCalledWith(
      'ExponentPushToken[abc]',
      expect.stringMatching(/ios|android/),
    );
    expect(mockStore.get('push_token')).toBe('ExponentPushToken[abc]');
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled(); // already granted: no prompt
  });

  it('asks once when permission is undetermined, and registers if the user allows', async () => {
    N.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    N.requestPermissionsAsync.mockResolvedValue({ granted: true });
    const a = api();
    expect(await registerForPush(a)).toBe('registered');
    expect(N.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('returns denied (and never registers) when the user refuses', async () => {
    N.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    N.requestPermissionsAsync.mockResolvedValue({ granted: false });
    const a = api();
    expect(await registerForPush(a)).toBe('denied');
    expect(a.registerPushToken).not.toHaveBeenCalled();
    expect(N.getExpoPushTokenAsync).not.toHaveBeenCalled();
  });

  it('does not nag: a permanently blocked permission is not requested again', async () => {
    N.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    expect(await registerForPush(api())).toBe('denied');
    expect(N.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports simulators as unsupported without touching anything', async () => {
    mockDevice.isDevice = false;
    const a = api();
    expect(await registerForPush(a)).toBe('unsupported');
    expect(N.getPermissionsAsync).not.toHaveBeenCalled();
    expect(a.registerPushToken).not.toHaveBeenCalled();
  });

  it('never throws: token or network failures become an "error" outcome', async () => {
    N.getExpoPushTokenAsync.mockRejectedValue(new Error('no network'));
    expect(await registerForPush(api())).toBe('error');
    N.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[abc]' });
    const a = api();
    a.registerPushToken.mockRejectedValue(new Error('500'));
    expect(await registerForPush(a)).toBe('error');
    expect(mockStore.has('push_token')).toBe(false); // not remembered if the server did not accept it
  });
});

describe('unregisterPush and the preference', () => {
  it('removes the stored token from the server, then forgets it', async () => {
    mockStore.set('push_token', 'ExponentPushToken[abc]');
    const a = api();
    await unregisterPush(a);
    expect(a.removePushToken).toHaveBeenCalledWith('ExponentPushToken[abc]');
    expect(mockStore.has('push_token')).toBe(false);
  });

  it('is a no-op without a token and tolerates server errors', async () => {
    const a = api();
    await unregisterPush(a);
    expect(a.removePushToken).not.toHaveBeenCalled();
    mockStore.set('push_token', 'ExponentPushToken[abc]');
    a.removePushToken.mockRejectedValue(new Error('offline'));
    await expect(unregisterPush(a)).resolves.toBeUndefined();
    expect(mockStore.has('push_token')).toBe(false);
  });

  it('defaults to on and remembers an explicit off', async () => {
    expect(await isPushPreferenceOn()).toBe(true);
    await setPushPreference(false);
    expect(await isPushPreferenceOn()).toBe(false);
    await setPushPreference(true);
    expect(await isPushPreferenceOn()).toBe(true);
  });
});

describe('routeForNotification', () => {
  it('opens the invoice for notifications that carry one', () => {
    expect(routeForNotification({ invoiceId: 'inv-1', notificationId: 'n1' })).toEqual({
      tab: 'InvoicesTab',
      screen: 'Invoice',
      params: { id: 'inv-1' },
    });
  });
  it('opens the overdue list for an overdue summary', () => {
    expect(routeForNotification({ count: 8, list: 'overdue' })).toEqual({
      tab: 'InvoicesTab',
      screen: 'InvoiceList',
      params: { status: 'overdue' },
    });
    expect(routeForNotification({ list: 'other' })).toBeNull();
  });
  it('opens the estimate for estimate notifications', () => {
    expect(routeForNotification({ estimateId: 'est-1' })).toEqual({
      tab: 'InvoicesTab',
      screen: 'Estimate',
      params: { id: 'est-1' },
    });
  });
  it.each([
    [null],
    [undefined],
    [{}],
    [{ invoiceId: '' }],
    [{ invoiceId: 5 }],
    [{ estimateId: '' }],
    ['x'],
  ])('ignores %p', (data) => {
    expect(routeForNotification(data)).toBeNull();
  });
});
