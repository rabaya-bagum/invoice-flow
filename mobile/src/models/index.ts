import type { BusinessUpdate, CustomerInput, ProductInput } from '@invoiceflow/shared';

export interface Customer extends CustomerInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface Product extends ProductInput {
  id: string;
  createdAt: string;
  updatedAt: string;
}

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
  stripeChargesEnabled: boolean;
}

export interface Page<T> {
  items: T[];
  total: number;
}

export type { BusinessUpdate, CustomerInput, ProductInput };

export function customerDisplayName(c: Pick<Customer, 'firstName' | 'lastName' | 'companyName'>) {
  const person = [c.firstName, c.lastName].filter(Boolean).join(' ');
  return c.companyName || person || 'Unnamed customer';
}
