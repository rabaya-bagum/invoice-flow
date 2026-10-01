import type { ListQuery, ProductInput } from '@invoiceflow/shared';
import type { Queryable } from '../db';
import { likePattern } from './sql';

export interface Product extends ProductInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

const COLS = `id, name, description, price_minor AS "priceMinor", unit, tax_rate_bps AS "taxRateBps",
  sku, category, is_active AS "isActive", created_at AS "createdAt", updated_at AS "updatedAt"`;

const valuesOf = (p: ProductInput) => [
  p.name,
  p.description,
  p.priceMinor,
  p.unit,
  p.taxRateBps,
  p.sku,
  p.category,
  p.isActive,
];

export interface ProductRepository {
  list(
    businessId: string,
    q: ListQuery & { category?: string; includeInactive?: boolean },
  ): Promise<{ items: Product[]; total: number }>;
  get(businessId: string, id: string): Promise<Product | null>;
  create(businessId: string, input: ProductInput): Promise<Product>;
  update(businessId: string, id: string, input: ProductInput): Promise<Product | null>;
  delete(businessId: string, id: string): Promise<boolean>;
}

/** Postgres unique_violation, used for the (business_id, sku) index. */
export const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

export function createProductRepository(db: Queryable): ProductRepository {
  return {
    async list(businessId, q) {
      const params: unknown[] = [businessId];
      let where = 'business_id = $1';
      if (!q.includeInactive) where += ' AND is_active';
      if (q.category) {
        params.push(q.category);
        where += ` AND category = $${params.length}`;
      }
      if (q.search) {
        params.push(likePattern(q.search));
        where += ` AND concat_ws(' ', name, description, sku, category) ILIKE $${params.length}`;
      }
      const total = await db.query<{ n: string }>(
        `SELECT count(*) AS n FROM products WHERE ${where}`,
        params,
      );
      const rows = await db.query<Product>(
        `SELECT ${COLS} FROM products WHERE ${where}
         ORDER BY lower(name), id LIMIT ${q.limit} OFFSET ${q.offset}`,
        params,
      );
      return { items: rows.rows, total: Number(total.rows[0]?.n ?? 0) };
    },

    async get(businessId, id) {
      const r = await db.query<Product>(
        `SELECT ${COLS} FROM products WHERE id = $1 AND business_id = $2`,
        [id, businessId],
      );
      return r.rows[0] ?? null;
    },

    async create(businessId, input) {
      const r = await db.query<Product>(
        `INSERT INTO products (business_id, name, description, price_minor, unit, tax_rate_bps,
           sku, category, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${COLS}`,
        [businessId, ...valuesOf(input)],
      );
      return r.rows[0] as Product;
    },

    async update(businessId, id, input) {
      const r = await db.query<Product>(
        `UPDATE products SET name = $3, description = $4, price_minor = $5, unit = $6,
           tax_rate_bps = $7, sku = $8, category = $9, is_active = $10
         WHERE id = $1 AND business_id = $2 RETURNING ${COLS}`,
        [id, businessId, ...valuesOf(input)],
      );
      return r.rows[0] ?? null;
    },

    async delete(businessId, id) {
      // invoice_items.product_id is ON DELETE SET NULL, and items copy name/price, so this is safe.
      const r = await db.query('DELETE FROM products WHERE id = $1 AND business_id = $2', [
        id,
        businessId,
      ]);
      return (r.rowCount ?? 0) > 0;
    },
  };
}
