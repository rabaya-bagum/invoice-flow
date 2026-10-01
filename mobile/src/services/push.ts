import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { ApiClient } from './api';

const TOKEN_KEY = 'push_token';
const PREF_KEY = 'push_pref';

export type PushOutcome = 'registered' | 'denied' | 'unsupported' | 'error';

/** Show notifications that arrive while the app is open (banner + list), with sound. */
export function configureNotificationHandler() {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Invoice activity',
    importance: Notifications.AndroidImportance.HIGH,
  });
}

/** Whether the user has switched notifications off inside the app (default: on). */
export async function isPushPreferenceOn(): Promise<boolean> {
  return (await SecureStore.getItemAsync(PREF_KEY)) !== 'off';
}

export async function setPushPreference(on: boolean): Promise<void> {
  if (on) await SecureStore.deleteItemAsync(PREF_KEY);
  else await SecureStore.setItemAsync(PREF_KEY, 'off');
}

/**
 * Asks for permission (only if the OS still allows asking), gets this device's Expo push token and
 * registers it with the server. Never throws: failures return an outcome the UI can explain.
 */
export async function registerForPush(
  api: Pick<ApiClient, 'registerPushToken'>,
): Promise<PushOutcome> {
  try {
    // Simulators and emulators cannot receive remote pushes.
    if (!Device.isDevice) return 'unsupported';
    await ensureAndroidChannel();

    let perm = await Notifications.getPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) return 'denied'; // do not nag: the user must change it in system settings
      perm = await Notifications.requestPermissionsAsync();
      if (!perm.granted) return 'denied';
    }

    const projectId =
      process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    await api.registerPushToken(token, Platform.OS === 'ios' ? 'ios' : 'android');
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    return 'registered';
  } catch {
    return 'error';
  }
}

/** Stops this device receiving this account's notifications (sign-out, or the user turned them off). */
export async function unregisterPush(api: Pick<ApiClient, 'removePushToken'>): Promise<void> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) return;
  try {
    await api.removePushToken(token);
  } catch {
    /* best effort: the server also drops tokens that Expo reports as dead */
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export interface NotificationTarget {
  tab: 'InvoicesTab';
  screen: 'Invoice' | 'Estimate';
  params: { id: string };
}

/** Where tapping a notification should go: the invoice or estimate it is about. */
export function routeForNotification(data: unknown): NotificationTarget | null {
  const d = data as { invoiceId?: unknown; estimateId?: unknown } | null | undefined;
  if (typeof d?.invoiceId === 'string' && d.invoiceId.length > 0)
    return { tab: 'InvoicesTab', screen: 'Invoice', params: { id: d.invoiceId } };
  if (typeof d?.estimateId === 'string' && d.estimateId.length > 0)
    return { tab: 'InvoicesTab', screen: 'Estimate', params: { id: d.estimateId } };
  return null;
}
