import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { base64ToBytes, bytesToBase64 } from '../utils/base64';
import { KEY_BYTES, type RandomBytes } from './crypto';

/** Where the encryption key lives. Tests use an in-memory vault. */
export interface KeyVault {
  /** The key, created on first use. */
  getKey(): Promise<Uint8Array>;
  /** Forget the key: everything encrypted with it becomes unreadable (crypto-erase). */
  destroy(): Promise<void>;
}

/** Cryptographically secure random bytes from the operating system. */
export const secureRandom: RandomBytes = (n) => Crypto.getRandomBytes(n);

const keyName = (userId: string) =>
  `invoiceflow.offline.key.${userId.replace(/[^A-Za-z0-9-]/g, '')}`;

/**
 * One random 256-bit key per user, kept in the Keychain (iOS) / Keystore-backed storage (Android) and
 * never backed up or moved to another device. Files encrypted with it are useless without it.
 */
export function createSecureStoreVault(
  userId: string,
  random: RandomBytes = secureRandom,
): KeyVault {
  const name = keyName(userId);
  let cached: Uint8Array | null = null;
  return {
    async getKey() {
      if (cached) return cached;
      const saved = await SecureStore.getItemAsync(name);
      if (saved) {
        try {
          const bytes = base64ToBytes(saved);
          if (bytes.length === KEY_BYTES) return (cached = bytes);
        } catch {
          /* damaged: fall through and make a new key (old files become unreadable) */
        }
      }
      const fresh = random(KEY_BYTES);
      await SecureStore.setItemAsync(name, bytesToBase64(fresh), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      return (cached = fresh);
    },
    async destroy() {
      cached = null;
      await SecureStore.deleteItemAsync(name);
    },
  };
}

export function createMemoryVault(random: RandomBytes): KeyVault & { destroyed: boolean } {
  let key: Uint8Array | null = null;
  const vault = {
    destroyed: false,
    async getKey() {
      return (key ??= random(KEY_BYTES));
    },
    async destroy() {
      key = null;
      vault.destroyed = true;
    },
  };
  return vault;
}
