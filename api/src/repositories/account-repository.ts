import type { SupabaseClient } from '@supabase/supabase-js';

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

/** Service-role access. Every query is scoped by the verified user id. */
export function createSupabaseAccountRepository(admin: SupabaseClient): AccountRepository {
  return {
    async findByUserId(userId) {
      const { data: profile, error: pErr } = await admin
        .from('profiles')
        .select('id, full_name')
        .eq('id', userId)
        .maybeSingle();
      if (pErr) throw pErr;
      if (!profile) return null;
      const { data: b, error: bErr } = await admin
        .from('business_profiles')
        .select('id, name, owner_name, email, default_currency, timezone, stripe_charges_enabled')
        .eq('owner_id', userId)
        .maybeSingle();
      if (bErr) throw bErr;
      if (!b) return null;
      return {
        user: { id: profile.id, fullName: profile.full_name },
        business: {
          id: b.id,
          name: b.name,
          ownerName: b.owner_name,
          email: b.email,
          defaultCurrency: b.default_currency,
          timezone: b.timezone,
          stripeChargesEnabled: b.stripe_charges_enabled,
        },
      };
    },

    async recordAudit(e) {
      const { error } = await admin.from('audit_logs').insert({
        business_id: e.businessId,
        user_id: e.userId,
        action: e.action,
        ip: e.ip ?? null,
        metadata: e.metadata ?? {},
      });
      if (error) throw error;
    },

    async deleteUser(userId) {
      // Cascades to profile, business and all tenant data via foreign keys.
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) throw error;
    },
  };
}
