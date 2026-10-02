import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { Text } from 'react-native';
import { decryptText, encryptText, isEncrypted, KEY_BYTES } from '../src/offline/crypto';
import { useOffline, type OfflineValue } from '../src/offline/context';
import { OfflineProvider } from '../src/offline/OfflineProvider';
import {
  createEncryptedStore,
  createMemoryStore,
  loadOutbox,
  outboxFile,
  referenceFile,
  saveOutbox,
} from '../src/offline/storage';
import { createMemoryVault, createSecureStoreVault } from '../src/offline/vault';
import { useAuth } from '../src/store/auth';
import { base64ToBytes, bytesToBase64 } from '../src/utils/base64';
import { CUSTOMER_ID } from '../test-utils';

jest.mock('../src/store/auth');
const mockKeychain = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: jest.fn(async (k: string) => mockKeychain.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockKeychain.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockKeychain.delete(k)),
}));
jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) =>
    Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256)),
}));

// Test-only randomness (production uses the operating system's secure generator via expo-crypto).
const rng = (n: number) => Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 256));
const key = () => rng(KEY_BYTES);
const SECRET = 'Acme Ltd owes $1,050.00';

beforeEach(() => mockKeychain.clear());

describe('base64', () => {
  it('round-trips every length and rejects garbage', () => {
    for (let n = 0; n < 40; n++) {
      const b = rng(n);
      expect(Array.from(base64ToBytes(bytesToBase64(b)))).toEqual(Array.from(b));
    }
    expect(() => base64ToBytes('a')).toThrow();
    expect(() => base64ToBytes('ab$d')).toThrow();
  });
});

describe('encryptText', () => {
  it('round-trips text, including unicode and empty', () => {
    const k = key();
    for (const t of ['', 'x', SECRET, 'Café ☕ — 日本語 🙂', 'a'.repeat(100_000)]) {
      expect(decryptText(k, 'f', encryptText(k, 'f', t, rng))).toBe(t);
    }
  });

  it('does not contain the plaintext, and is a recognisable envelope', () => {
    const stored = encryptText(key(), 'f', SECRET, rng);
    expect(stored).not.toContain('Acme');
    expect(stored).not.toContain('1,050');
    expect(isEncrypted(stored)).toBe(true);
    expect(isEncrypted('{"version":1,"ops":[]}')).toBe(false);
    expect(isEncrypted('not json')).toBe(false);
  });

  it('uses a fresh nonce every time (same input, different bytes)', () => {
    const k = key();
    const a = encryptText(k, 'f', SECRET, rng);
    const b = encryptText(k, 'f', SECRET, rng);
    expect(a).not.toBe(b);
    expect(JSON.parse(a).n).not.toBe(JSON.parse(b).n);
  });

  it('fails with the wrong key, the wrong file name, or any changed byte', () => {
    const k = key();
    const stored = encryptText(k, 'file-a', SECRET, rng);
    expect(() => decryptText(key(), 'file-a', stored)).toThrow();
    expect(() => decryptText(k, 'file-b', stored)).toThrow(); // swapped into another file
    const env = JSON.parse(stored);
    const bytes = base64ToBytes(env.c);
    for (const i of [0, Math.floor(bytes.length / 2), bytes.length - 1]) {
      const bad = new Uint8Array(bytes);
      bad[i] = (bad[i] as number) ^ 1;
      expect(() =>
        decryptText(k, 'file-a', JSON.stringify({ ...env, c: bytesToBase64(bad) })),
      ).toThrow();
    }
    expect(() =>
      decryptText(k, 'file-a', JSON.stringify({ ...env, n: bytesToBase64(rng(24)) })),
    ).toThrow();
    expect(() => decryptText(k, 'file-a', JSON.stringify({ ...env, v: 1 }))).toThrow();
    expect(() => decryptText(k, 'file-a', JSON.stringify({ ...env, n: 'AAAA' }))).toThrow();
  });
});

describe('encrypted store', () => {
  const make = (initial: Record<string, string> = {}) => {
    const files = createMemoryStore(initial);
    const vault = createMemoryVault(rng);
    return { files, vault, store: createEncryptedStore(files, vault, rng) };
  };

  it('writes only ciphertext to disk and reads plaintext back', async () => {
    const { files, store } = make();
    await store.write('f.json', `{"customer":"${SECRET}"}`);
    expect(files.files.get('f.json')).not.toContain('Acme');
    expect(await store.read('f.json')).toBe(`{"customer":"${SECRET}"}`);
    expect(await store.read('missing.json')).toBeNull();
  });

  it('upgrades an old plain-text file: still readable, and encrypted from then on', async () => {
    const plain = JSON.stringify({ version: 1, ops: [] });
    const { files, store } = make({ 'old.json': plain });
    expect(await store.read('old.json')).toBe(plain);
    expect(isEncrypted(files.files.get('old.json')!)).toBe(true);
    expect(await store.read('old.json')).toBe(plain);
  });

  it('treats a file it cannot decrypt (lost key, tampering, swapped) as missing and deletes it', async () => {
    const a = make();
    await a.store.write('f.json', SECRET);
    const other = createEncryptedStore(a.files, createMemoryVault(rng), rng); // a different key
    expect(await other.read('f.json')).toBeNull();
    expect(a.files.files.has('f.json')).toBe(false);

    const b = make();
    await b.store.write('one.json', 'one');
    b.files.files.set('two.json', b.files.files.get('one.json')!); // copied under another name
    expect(await b.store.read('two.json')).toBeNull();
  });

  it('keeps the queue loader working end to end, and a damaged file is an empty queue', async () => {
    const { files, store } = make();
    const op = {
      invoiceId: 'a',
      isNew: true,
      payload: { customerId: CUSTOMER_ID },
      baseVersion: null,
      summary: { customerName: 'Acme Ltd', currency: 'USD', totalMinor: 1, number: null },
      queuedAt: 't',
      updatedAt: 't',
      state: 'pending',
      attempts: 0,
    };
    await saveOutbox(store, 'u1', [op as never]);
    expect(files.files.get(outboxFile('u1'))).not.toContain('Acme');
    expect((await loadOutbox(store, 'u1')).ops).toHaveLength(1);
    files.files.set(outboxFile('u1'), '{"v":2,"alg":"xchacha20poly1305","n":"AAAA","c":"zzzz"}');
    expect((await loadOutbox(store, 'u1')).ops).toEqual([]);
  });
});

describe('secure-store vault', () => {
  it('creates a 256-bit key once, keeps it in the keychain this-device-only, and reuses it', async () => {
    const v1 = createSecureStoreVault('user-1', rng);
    const k1 = await v1.getKey();
    expect(k1).toHaveLength(32);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      expect.stringContaining('user-1'),
      expect.any(String),
      { keychainAccessible: 'when-unlocked-this-device-only' },
    );
    const again = createSecureStoreVault('user-1', rng); // e.g. after an app restart
    expect(Array.from(await again.getKey())).toEqual(Array.from(k1));
  });

  it('gives each user their own key', async () => {
    const a = await createSecureStoreVault('user-1', rng).getKey();
    const b = await createSecureStoreVault('user-2', rng).getKey();
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('forgets the key on destroy, so old files can never be read again', async () => {
    const files = createMemoryStore();
    const vault = createSecureStoreVault('user-1', rng);
    const store = createEncryptedStore(files, vault, rng);
    await store.write('f.json', SECRET);
    await vault.destroy();
    expect(mockKeychain.size).toBe(0);
    const reopened = createEncryptedStore(files, createSecureStoreVault('user-1', rng), rng);
    expect(await reopened.read('f.json')).toBeNull();
  });

  it('replaces a damaged saved key instead of crashing', async () => {
    mockKeychain.set('invoiceflow.offline.key.user-1', 'not base64 !!');
    const k = await createSecureStoreVault('user-1', rng).getKey();
    expect(k).toHaveLength(32);
  });
});

describe('OfflineProvider with encryption', () => {
  let off: OfflineValue;
  const Probe = () => {
    off = useOffline();
    return <Text>{`ops:${off.ops.length} loaded:${off.loaded}`}</Text>;
  };
  const down = async () => {
    throw Object.assign(new Error('offline'), { kind: 'network' });
  };
  const api = {
    createInvoice: jest.fn(down),
    getBusiness: jest.fn(down),
    listTaxRates: jest.fn(down),
    listCustomers: jest.fn(down),
    listProducts: jest.fn(down),
  };
  const setAuth = (status: 'signedIn' | 'signedOut') =>
    (useAuth as jest.Mock).mockReturnValue({
      api,
      status,
      session: status === 'signedIn' ? { user: { id: 'user-1' } } : null,
    });
  const save = () =>
    off.saveDraft({
      invoiceId: 'd1',
      isNew: true,
      payload: { customerId: CUSTOMER_ID, items: [] } as never,
      baseVersion: null,
      summary: {
        customerName: 'Secret Customer GmbH',
        currency: 'USD',
        totalMinor: 1,
        number: null,
      },
    });

  it('stores drafts encrypted, restores them after a restart, and erases file and key on sign-out', async () => {
    const files = createMemoryStore();
    const vaults = new Map<string, ReturnType<typeof createMemoryVault>>();
    const vaultFor = (u: string) => {
      if (!vaults.has(u)) vaults.set(u, createMemoryVault(rng));
      return vaults.get(u)!;
    };
    const client = new QueryClient();
    const tree = () => (
      <QueryClientProvider client={client}>
        <OfflineProvider store={files} vaultFor={vaultFor} random={rng}>
          <Probe />
        </OfflineProvider>
      </QueryClientProvider>
    );
    setAuth('signedIn');
    const first = await render(tree());
    await screen.findByText(/loaded:true/);
    await act(async () => save());
    const onDisk = files.files.get(outboxFile('user-1'))!;
    expect(onDisk).toBeDefined();
    expect(onDisk).not.toContain('Secret Customer');
    expect(isEncrypted(onDisk)).toBe(true);

    // "Restart": a fresh provider over the same files and keychain reads the draft back.
    await first.unmount();
    await render(tree());
    expect(await screen.findByText(/ops:1 loaded:true/)).toBeTruthy();
    expect(off.getOp('d1')!.summary.customerName).toBe('Secret Customer GmbH');

    // Signing out removes the file AND the key.
    setAuth('signedOut');
    await screen.rerender(tree());
    await waitFor(() => expect(files.files.has(outboxFile('user-1'))).toBe(false));
    expect(files.files.has(referenceFile('user-1'))).toBe(false);
    expect(vaults.get('user-1')!.destroyed).toBe(true);
  });
});
