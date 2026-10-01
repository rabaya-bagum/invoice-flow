import type { CustomerInput, ListQuery } from '@invoiceflow/shared';
import type { Queryable } from '../db';
import { likePattern } from './sql';

export interface Customer extends CustomerInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

const COLS = `id, first_name AS "firstName", last_name AS "lastName", company_name AS "companyName",
  email, phone, address_line1 AS "addressLine1", address_line2 AS "addressLine2", city, province,
  postal_code AS "postalCode", country, notes, created_at AS "createdAt", updated_at AS "updatedAt"`;

const WRITE_COLS = [
  'first_name',
  'last_name',
  'company_name',
  'email',
  'phone',
  'address_line1',
  'address_line2',
  'city',
  'province',
  'postal_code',
  'country',
  'notes',
];

const valuesOf = (c: CustomerInput) => [
  c.firstName,
  c.lastName,
  c.companyName,
  c.email,
  c.phone,
  c.addressLine1,
  c.addressLine2,
  c.city,
  c.province,
  c.postalCode,
  c.country,
  c.notes,
];

export interface CustomerRepository {
  list(businessId: string, q: ListQuery): Promise<{ items: Customer[]; total: number }>;
  get(businessId: string, id: string): Promise<Customer | null>;
  create(businessId: string, input: CustomerInput): Promise<Customer>;
  update(businessId: string, id: string, input: CustomerInput): Promise<Customer | null>;
  /** Soft delete: invoices keep pointing at the customer. Returns false if not found. */
  softDelete(businessId: string, id: string): Promise<boolean>;
}

/** Every query is scoped by business_id and ignores soft-deleted rows. */
export function createCustomerRepository(db: Queryable): CustomerRepository {
  return {
    async list(businessId, q) {
      const params: unknown[] = [businessId];
      let where = 'business_id = $1 AND deleted_at IS NULL';
      if (q.search) {
        params.push(likePattern(q.search));
        where += ` AND concat_ws(' ', first_name, last_name, company_name, email, phone) ILIKE $2`;
      }
      const total = await db.query<{ n: string }>(
        `SELECT count(*) AS n FROM customers WHERE ${where}`,
        params,
      );
      const rows = await db.query<Customer>(
        `SELECT ${COLS} FROM customers WHERE ${where}
         ORDER BY lower(coalesce(company_name, last_name, first_name)),
                  lower(coalesce(first_name, '')), created_at, id
         LIMIT ${q.limit} OFFSET ${q.offset}`,
        params,
      );
      return { items: rows.rows, total: Number(total.rows[0]?.n ?? 0) };
    },

    async get(businessId, id) {
      const r = await db.query<Customer>(
        `SELECT ${COLS} FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
        [id, businessId],
      );
      return r.rows[0] ?? null;
    },

    async create(businessId, input) {
      const placeholders = WRITE_COLS.map((_, i) => `$${i + 2}`).join(', ');
      const r = await db.query<Customer>(
        `INSERT INTO customers (business_id, ${WRITE_COLS.join(', ')})
         VALUES ($1, ${placeholders}) RETURNING ${COLS}`,
        [businessId, ...valuesOf(input)],
      );
      return r.rows[0] as Customer;
    },

    async update(businessId, id, input) {
      const set = WRITE_COLS.map((c, i) => `${c} = $${i + 3}`).join(', ');
      const r = await db.query<Customer>(
        `UPDATE customers SET ${set}
         WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL RETURNING ${COLS}`,
        [id, businessId, ...valuesOf(input)],
      );
      return r.rows[0] ?? null;
    },

    async softDelete(businessId, id) {
      const r = await db.query(
        `UPDATE customers SET deleted_at = now()
         WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
        [id, businessId],
      );
      return (r.rowCount ?? 0) > 0;
    },
  };
}
