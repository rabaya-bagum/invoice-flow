import type { BusinessProfile, Customer, Product, TaxRate } from '../models';
import { customerDisplayName } from '../models';
import { referenceFile, type TextStore } from './storage';

/** The few lists the invoice form needs, copied so a draft can be written with no connection. */
export interface ReferenceSnapshot {
  savedAt: string;
  business: BusinessProfile;
  taxRates: TaxRate[];
  customers: Customer[];
  products: Product[];
}

/** Only the most recent rows are copied; a bigger catalogue is partly available offline. */
export const SNAPSHOT_LIMIT = 100;

const norm = (s: string) => s.trim().toLowerCase();

export function filterCustomers(list: Customer[], search: string): Customer[] {
  const q = norm(search);
  if (!q) return list;
  return list.filter((c) =>
    [customerDisplayName(c), c.email ?? '', c.firstName ?? '', c.lastName ?? ''].some((v) =>
      norm(v).includes(q),
    ),
  );
}

export function filterProducts(list: Product[], search: string): Product[] {
  const q = norm(search);
  if (!q) return list;
  return list.filter((p) =>
    [p.name, p.sku ?? '', p.category ?? ''].some((v) => norm(v).includes(q)),
  );
}

export async function loadReference(
  store: TextStore,
  userId: string,
): Promise<ReferenceSnapshot | null> {
  try {
    const text = await store.read(referenceFile(userId));
    if (!text) return null;
    const s = JSON.parse(text) as Partial<ReferenceSnapshot>;
    return s &&
      s.business &&
      Array.isArray(s.customers) &&
      Array.isArray(s.products) &&
      Array.isArray(s.taxRates)
      ? (s as ReferenceSnapshot)
      : null;
  } catch {
    return null;
  }
}

export async function saveReference(store: TextStore, userId: string, s: ReferenceSnapshot) {
  await store.write(referenceFile(userId), JSON.stringify(s));
}
