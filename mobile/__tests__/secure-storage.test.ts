import { createChunkedStorage, type KeyValueStore } from '../src/services/secure-storage';

function memoryStore() {
  const data = new Map<string, string>();
  const store: KeyValueStore = {
    get: async (k) => data.get(k) ?? null,
    set: async (k, v) => void data.set(k, v),
    remove: async (k) => void data.delete(k),
  };
  return { store, data };
}

describe('chunked secure storage', () => {
  it('round-trips values larger than one chunk', async () => {
    const { store, data } = memoryStore();
    const s = createChunkedStorage(store);
    const big = JSON.stringify({ token: 'x'.repeat(5000), n: 1 });
    await s.setItem('sb-session', big);
    expect(await s.getItem('sb-session')).toBe(big);
    expect([...data.values()].every((v) => v.length <= 1800)).toBe(true);
  });

  it('returns null for missing keys', async () => {
    expect(await createChunkedStorage(memoryStore().store).getItem('nope')).toBeNull();
  });

  it('removes stale chunks when the value shrinks', async () => {
    const { store, data } = memoryStore();
    const s = createChunkedStorage(store);
    await s.setItem('k', 'a'.repeat(5000));
    await s.setItem('k', 'small');
    expect(await s.getItem('k')).toBe('small');
    expect([...data.keys()].sort()).toEqual(['k.0', 'k.n']);
  });

  it('treats a missing chunk as signed out rather than returning garbage', async () => {
    const { store, data } = memoryStore();
    const s = createChunkedStorage(store);
    await s.setItem('k', 'a'.repeat(4000));
    data.delete('k.1');
    expect(await s.getItem('k')).toBeNull();
  });

  it('removeItem deletes everything', async () => {
    const { store, data } = memoryStore();
    const s = createChunkedStorage(store);
    await s.setItem('k', 'a'.repeat(4000));
    await s.removeItem('k');
    expect(data.size).toBe(0);
    expect(await s.getItem('k')).toBeNull();
  });
});
