/**
 * Web stand-in for expo-secure-store, which has no web implementation. metro.config.js resolves
 * `expo-secure-store` to this file for web builds only; iOS/Android keep the Keychain/Keystore.
 *
 * Values live in localStorage: fine for the Supabase session and small preferences (the standard
 * Supabase web setup), but NOT a secret store. Offline data is therefore not kept on web at all
 * (see OfflineProvider), so no encryption key is ever written here.
 */
type Options = { keychainAccessible?: number };

const PREFIX = 'securestore:';

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // blocked storage (private mode, disabled site data)
  }
}

export const AFTER_FIRST_UNLOCK = 0;
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 1;
export const ALWAYS = 2;
export const WHEN_PASSCODE_SET_THIS_DEVICE_ONLY = 3;
export const ALWAYS_THIS_DEVICE_ONLY = 4;
export const WHEN_UNLOCKED = 5;
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 6;

export async function isAvailableAsync(): Promise<boolean> {
  return storage() !== null;
}

export function getItem(key: string, _options?: Options): string | null {
  try {
    return storage()?.getItem(PREFIX + key) ?? null;
  } catch {
    return null;
  }
}

export function setItem(key: string, value: string, _options?: Options): void {
  try {
    storage()?.setItem(PREFIX + key, value);
  } catch {
    /* quota exceeded or blocked: behave as if nothing was saved */
  }
}

export async function getItemAsync(key: string, options?: Options): Promise<string | null> {
  return getItem(key, options);
}

export async function setItemAsync(key: string, value: string, options?: Options): Promise<void> {
  setItem(key, value, options);
}

export async function deleteItemAsync(key: string, _options?: Options): Promise<void> {
  try {
    storage()?.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
}

export function canUseBiometricAuthentication(): boolean {
  return false;
}
