import path from 'path';
import * as webStore from '../src/web/secure-store';

class MemoryStorage {
  data = new Map<string, string>();
  getItem = (k: string) => this.data.get(k) ?? null;
  setItem = (k: string, v: string) => void this.data.set(k, v);
  removeItem = (k: string) => void this.data.delete(k);
}

jest.mock('expo/metro-config', () => ({
  getDefaultConfig: () => ({ resolver: {} }),
}));

const g = globalThis as { localStorage?: unknown };
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else delete g.localStorage;
});

function useStorage(value: unknown) {
  Object.defineProperty(globalThis, 'localStorage', { value, configurable: true, writable: true });
}

describe('web secure-store stand-in', () => {
  it('round-trips values under a prefix and deletes them', async () => {
    const s = new MemoryStorage();
    useStorage(s);
    await webStore.setItemAsync('session', 'abc');
    expect(s.data.get('securestore:session')).toBe('abc');
    expect(await webStore.getItemAsync('session')).toBe('abc');
    expect(webStore.getItem('session')).toBe('abc');
    await webStore.deleteItemAsync('session');
    expect(await webStore.getItemAsync('session')).toBeNull();
  });

  it('returns null for a missing key', async () => {
    useStorage(new MemoryStorage());
    expect(await webStore.getItemAsync('nope')).toBeNull();
  });

  it('behaves as empty when storage is blocked or throws', async () => {
    useStorage(null);
    expect(await webStore.isAvailableAsync()).toBe(false);
    await expect(webStore.setItemAsync('k', 'v')).resolves.toBeUndefined();
    expect(await webStore.getItemAsync('k')).toBeNull();

    useStorage({
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    });
    await expect(webStore.setItemAsync('k', 'v')).resolves.toBeUndefined();
    expect(await webStore.getItemAsync('k')).toBeNull();
    await expect(webStore.deleteItemAsync('k')).resolves.toBeUndefined();
  });

  it('reports no biometrics and exports the accessibility constants the app uses', () => {
    expect(webStore.canUseBiometricAuthentication()).toBe(false);
    expect(typeof webStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY).toBe('number');
  });
});

describe('metro config', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const config = require('../metro.config.js');
  const context = {
    resolveRequest: (_c: unknown, name: string) => ({
      type: 'sourceFile',
      filePath: `native:${name}`,
    }),
  };

  it('swaps expo-secure-store for the stand-in on web only', () => {
    const web = config.resolver.resolveRequest(context, 'expo-secure-store', 'web');
    expect(web.filePath).toBe(path.resolve(__dirname, '..', 'src/web/secure-store.ts'));
    for (const platform of ['ios', 'android']) {
      expect(config.resolver.resolveRequest(context, 'expo-secure-store', platform).filePath).toBe(
        'native:expo-secure-store',
      );
    }
  });

  it('leaves every other module alone on web', () => {
    expect(config.resolver.resolveRequest(context, 'react', 'web').filePath).toBe('native:react');
  });
});
