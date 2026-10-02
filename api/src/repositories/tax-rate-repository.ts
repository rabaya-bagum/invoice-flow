import type { TaxRateInput } from '@invoiceflow/shared';
import type { Database } from '../db';

export interface TaxRate extends TaxRateInput {
  id: string;
}

const COLS = `id, name, rate_bps AS "rateBps", is_default AS "isDefault"`;

export interface TaxRateRepository {
  list(businessId: string): Promise<TaxRate[]>;
  create(businessId: string, input: TaxRateInput): Promise<TaxRate>;
  update(businessId: string, id: string, input: TaxRateInput): Promise<TaxRate | null>;
  delete(businessId: string, id: string): Promise<boolean>;
}

export function createTaxRateRepository(db: Database): TaxRateRepository {
  return {
    async list(businessId) {
      const r = await db.query<TaxRate>(
        `SELECT ${COLS} FROM tax_rates WHERE business_id = $1 ORDER BY lower(name)`,
        [businessId],
      );
      return r.rows;
    },

    create: (businessId, input) =>
      db.transaction(async (tx) => {
        // Setting a new default first clears the old one (partial unique index allows only one).
        if (input.isDefault)
          await tx.query('UPDATE tax_rates SET is_default = false WHERE business_id = $1', [
            businessId,
          ]);
        const r = await tx.query<TaxRate>(
          `INSERT INTO tax_rates (business_id, name, rate_bps, is_default) VALUES ($1, $2, $3, $4) RETURNING ${COLS}`,
          [businessId, input.name, input.rateBps, input.isDefault],
        );
        return r.rows[0] as TaxRate;
      }),

    update: (businessId, id, input) =>
      db.transaction(async (tx) => {
        // Check (and lock) the target first: a missing id must not clear the current default.
        const target = await tx.query(
          'SELECT 1 FROM tax_rates WHERE id = $1 AND business_id = $2 FOR UPDATE',
          [id, businessId],
        );
        if ((target.rowCount ?? 0) === 0) return null;
        if (input.isDefault) {
          await tx.query(
            'UPDATE tax_rates SET is_default = false WHERE business_id = $1 AND id <> $2',
            [businessId, id],
          );
        }
        const r = await tx.query<TaxRate>(
          `UPDATE tax_rates SET name = $3, rate_bps = $4, is_default = $5
           WHERE id = $1 AND business_id = $2 RETURNING ${COLS}`,
          [id, businessId, input.name, input.rateBps, input.isDefault],
        );
        return r.rows[0] ?? null;
      }),

    async delete(businessId, id) {
      // Invoice items keep their own name/rate snapshot, so deleting a rate never alters invoices.
      const r = await db.query('DELETE FROM tax_rates WHERE id = $1 AND business_id = $2', [
        id,
        businessId,
      ]);
      return (r.rowCount ?? 0) > 0;
    },
  };
}
