import * as SecureStore from 'expo-secure-store';

/** Minimal key-value store contract (matches the parts of expo-secure-store we use). */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

// SecureStore values are limited to ~2KB on some platforms; a Supabase session is larger.
const CHUNK_SIZE = 1800;

/**
 * Supabase auth storage that splits large values across several secure-store entries
 * (Keychain on iOS, Keystore-backed encryption on Android). Keys written as `<key>.n`
 * (chunk count) and `<key>.<i>` (chunks).
 */
export function createChunkedStorage(store: KeyValueStore) {
  const countKey = (k: string) => `${k}.n`;
  const chunkKey = (k: string, i: number) => `${k}.${i}`;

  async function readCount(key: string): Promise<number> {
    const raw = await store.get(countKey(key));
    const n = raw === null ? 0 : Number(raw);
    return Number.isInteger(n) && n > 0 ? n : 0;
  }

  return {
    async getItem(key: string): Promise<string | null> {
      const n = await readCount(key);
      if (n === 0) return null;
      const parts: string[] = [];
      for (let i = 0; i < n; i++) {
        const part = await store.get(chunkKey(key, i));
        if (part === null) return null; // partially written / corrupt: treat as signed out
        parts.push(part);
      }
      return parts.join('');
    },

    async setItem(key: string, value: string): Promise<void> {
      const previous = await readCount(key);
      const chunks: string[] = [];
      for (let i = 0; i < value.length; i += CHUNK_SIZE)
        chunks.push(value.slice(i, i + CHUNK_SIZE));
      for (let i = 0; i < chunks.length; i++)
        await store.set(chunkKey(key, i), chunks[i] as string);
      await store.set(countKey(key), String(chunks.length));
      for (let i = chunks.length; i < previous; i++) await store.remove(chunkKey(key, i));
    },

    async removeItem(key: string): Promise<void> {
      const n = await readCount(key);
      await store.remove(countKey(key));
      for (let i = 0; i < n; i++) await store.remove(chunkKey(key, i));
    },
  };
}

const OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const secureKeyValueStore: KeyValueStore = {
  get: (k) => SecureStore.getItemAsync(k, OPTIONS),
  set: (k, v) => SecureStore.setItemAsync(k, v, OPTIONS),
  remove: (k) => SecureStore.deleteItemAsync(k, OPTIONS),
};

export const secureStorage = createChunkedStorage(secureKeyValueStore);
