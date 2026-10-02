import { normalizeDisplayOptions, type BusinessUpdate } from '@invoiceflow/shared';
import type { Queryable } from '../db';
import { buildSet } from './sql';

export interface BusinessProfile {
  id: string;
  name: string;
  ownerName: string | null;
  email: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
  website: string | null;
  taxNumber: string | null;
  paymentInstructions: string | null;
  logoPath: string | null;
  signaturePath: string | null;
  defaultCurrency: string;
  defaultTaxRateBps: number;
  defaultPaymentTermsDays: number;
  timezone: string;
  invoicePrefix: string;
  estimatePrefix: string;
  numberPadding: number;
  template: string;
  accentColor: string;
  displayOptions: Record<string, boolean>;
  stripeChargesEnabled: boolean;
}

const COLUMNS: Record<string, string> = {
  name: 'name',
  ownerName: 'owner_name',
  email: 'email',
  phone: 'phone',
  addressLine1: 'address_line1',
  addressLine2: 'address_line2',
  city: 'city',
  province: 'province',
  postalCode: 'postal_code',
  country: 'country',
  website: 'website',
  taxNumber: 'tax_number',
  paymentInstructions: 'payment_instructions',
  defaultCurrency: 'default_currency',
  defaultTaxRateBps: 'default_tax_rate_bps',
  defaultPaymentTermsDays: 'default_payment_terms_days',
  timezone: 'timezone',
  invoicePrefix: 'invoice_prefix',
  estimatePrefix: 'estimate_prefix',
  numberPadding: 'number_padding',
  template: 'template',
  accentColor: 'accent_color',
  displayOptions: 'display_options',
};

const SELECT = `
  id, name, owner_name AS "ownerName", email, phone, address_line1 AS "addressLine1",
  address_line2 AS "addressLine2", city, province, postal_code AS "postalCode", country,
  website, tax_number AS "taxNumber", payment_instructions AS "paymentInstructions", logo_path AS "logoPath", signature_path AS "signaturePath",
  default_currency AS "defaultCurrency", default_tax_rate_bps AS "defaultTaxRateBps",
  default_payment_terms_days AS "defaultPaymentTermsDays", timezone,
  invoice_prefix AS "invoicePrefix", estimate_prefix AS "estimatePrefix",
  number_padding AS "numberPadding", template, accent_color AS "accentColor",
  display_options AS "displayOptions", stripe_charges_enabled AS "stripeChargesEnabled"`;

export interface BusinessRepository {
  findIdByOwner(userId: string): Promise<string | null>;
  get(businessId: string): Promise<BusinessProfile | null>;
  update(businessId: string, patch: BusinessUpdate): Promise<BusinessProfile | null>;
  getStripeAccount(
    businessId: string,
  ): Promise<{ accountId: string | null; chargesEnabled: boolean } | null>;
  setStripeAccount(businessId: string, accountId: string): Promise<void>;
  setChargesEnabled(businessId: string, enabled: boolean): Promise<void>;
  /** Records where a logo/signature is stored (null removes it). */
  setAssetPath(businessId: string, kind: 'logo' | 'signature', key: string | null): Promise<void>;
}

/** Older rows may hold arbitrary keys; only the known on/off switches are ever served or rendered. */
const clean = (b: BusinessProfile | undefined): BusinessProfile | null =>
  b
    ? { ...b, displayOptions: normalizeDisplayOptions(b.displayOptions) as Record<string, boolean> }
    : null;

export function createBusinessRepository(db: Queryable): BusinessRepository {
  return {
    async findIdByOwner(userId) {
      const r = await db.query<{ id: string }>(
        'SELECT id FROM business_profiles WHERE owner_id = $1',
        [userId],
      );
      return r.rows[0]?.id ?? null;
    },

    async get(businessId) {
      const r = await db.query<BusinessProfile>(
        `SELECT ${SELECT} FROM business_profiles WHERE id = $1`,
        [businessId],
      );
      return clean(r.rows[0]);
    },

    async getStripeAccount(businessId) {
      const r = await db.query<{
        stripe_account_id: string | null;
        stripe_charges_enabled: boolean;
      }>('SELECT stripe_account_id, stripe_charges_enabled FROM business_profiles WHERE id = $1', [
        businessId,
      ]);
      const row = r.rows[0];
      return row
        ? { accountId: row.stripe_account_id, chargesEnabled: row.stripe_charges_enabled }
        : null;
    },

    async setStripeAccount(businessId, accountId) {
      await db.query('UPDATE business_profiles SET stripe_account_id = $2 WHERE id = $1', [
        businessId,
        accountId,
      ]);
    },

    async setChargesEnabled(businessId, enabled) {
      await db.query('UPDATE business_profiles SET stripe_charges_enabled = $2 WHERE id = $1', [
        businessId,
        enabled,
      ]);
    },

    async setAssetPath(businessId, kind, key) {
      const col = kind === 'logo' ? 'logo_path' : 'signature_path';
      await db.query(`UPDATE business_profiles SET ${col} = $2 WHERE id = $1`, [businessId, key]);
    },

    async update(businessId, patch) {
      const set = buildSet(patch as Record<string, unknown>, COLUMNS, 2);
      if (!set) return this.get(businessId);
      const r = await db.query<BusinessProfile>(
        `UPDATE business_profiles SET ${set.sql} WHERE id = $1 RETURNING ${SELECT}`,
        [businessId, ...set.values],
      );
      return clean(r.rows[0]);
    },
  };
}
