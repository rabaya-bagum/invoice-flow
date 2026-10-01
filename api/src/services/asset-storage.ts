import type { SupabaseClient } from '@supabase/supabase-js';

export interface StoredAsset {
  bytes: Buffer;
  contentType: string;
}

/** Private object storage for business logos and signatures. */
export interface AssetStorage {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredAsset | null>;
  remove(key: string): Promise<void>;
}

export const ASSET_BUCKET = 'business-assets';

export function createSupabaseAssetStorage(
  admin: SupabaseClient,
  bucket = ASSET_BUCKET,
): AssetStorage {
  return {
    async put(key, bytes, contentType) {
      const { error } = await admin.storage
        .from(bucket)
        .upload(key, bytes, { contentType, upsert: true });
      if (error) throw error;
    },
    async get(key) {
      const { data, error } = await admin.storage.from(bucket).download(key);
      if (error || !data) return null; // missing object
      return {
        bytes: Buffer.from(await data.arrayBuffer()),
        contentType: data.type || 'application/octet-stream',
      };
    },
    async remove(key) {
      const { error } = await admin.storage.from(bucket).remove([key]);
      if (error) throw error;
    },
  };
}

/** Creates the private bucket if it does not exist yet (safe to call on every boot). */
export async function ensureAssetBucket(admin: SupabaseClient, bucket = ASSET_BUCKET) {
  const { error } = await admin.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: 1_000_000,
  });
  if (error && !/already exists|duplicate/i.test(error.message)) throw error;
}

export function createMemoryAssetStorage(): AssetStorage & { size(): number } {
  const items = new Map<string, StoredAsset>();
  return {
    put: async (k, bytes, contentType) => void items.set(k, { bytes, contentType }),
    get: async (k) => items.get(k) ?? null,
    remove: async (k) => void items.delete(k),
    size: () => items.size,
  };
}

/** Accept only real PNG/JPEG data (checks magic bytes, not the client-declared type). */
export function sniffImage(bytes: Buffer): 'image/png' | 'image/jpeg' | null {
  if (
    bytes.length > 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  return null;
}
