import type { Queryable } from '../db';

export interface Business {
  id: string;
  name: string;
  ownerName: string | null;
  email: string | null;
  defaultCurrency: string;
  timezone: string;
  stripeChargesEnabled: boolean;
}

export interface Account {
  user: { id: string; fullName: string | null };
  business: Business;
}

export interface AuditEntry {
  businessId: string | null;
  userId: string;
  action: string;
  ip?: string;
  metadata?: Record<string, unknown>;
}

export interface AccountRepository {
  findByUserId(userId: string): Promise<Account | null>;
  recordAudit(entry: AuditEntry): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

/**
 * @param deleteAuthUser removes the Supabase Auth user (service role). The foreign-key cascade
 *   then removes the profile, business and all tenant data.
 */
export function createAccountRepository(
  db: Queryable,
  deleteAuthUser: (userId: string) => Promise<void>,
): AccountRepository {
  return {
    async findByUserId(userId) {
      const r = await db.query<{
        user_id: string;
        full_name: string | null;
        id: string;
        name: string;
        owner_name: string | null;
        email: string | null;
        default_currency: string;
        timezone: string;
        stripe_charges_enabled: boolean;
      }>(
        `SELECT p.id AS user_id, p.full_name, b.id, b.name, b.owner_name, b.email,
                b.default_currency, b.timezone, b.stripe_charges_enabled
         FROM profiles p JOIN business_profiles b ON b.owner_id = p.id
         WHERE p.id = $1`,
        [userId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        user: { id: row.user_id, fullName: row.full_name },
        business: {
          id: row.id,
          name: row.name,
          ownerName: row.owner_name,
          email: row.email,
          defaultCurrency: row.default_currency,
          timezone: row.timezone,
          stripeChargesEnabled: row.stripe_charges_enabled,
        },
      };
    },

    async recordAudit(e) {
      await db.query(
        `INSERT INTO audit_logs (business_id, user_id, action, ip, metadata)
         VALUES ($1, $2, $3, $4, $5)`,
        [e.businessId, e.userId, e.action, e.ip ?? null, JSON.stringify(e.metadata ?? {})],
      );
    },

    deleteUser: deleteAuthUser,
  };
}
