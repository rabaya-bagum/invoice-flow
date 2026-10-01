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

export type { DisplayStatus, InvoiceStatus } from '@invoiceflow/shared';

export interface TaxRate {
  id: string;
  name: string;
  rateBps: number;
  isDefault: boolean;
}

export interface InvoiceSummary {
  id: string;
  number: string;
  status: import('@invoiceflow/shared').InvoiceStatus;
  displayStatus: import('@invoiceflow/shared').DisplayStatus;
  customerId: string;
  customerName: string;
  issueDate: string;
  dueDate: string;
  currency: string;
  totalMinor: number;
  amountPaidMinor: number;
  balanceDueMinor: number;
  updatedAt: string;
}

export interface InvoiceItem {
  id: string;
  productId: string | null;
  description: string;
  quantityMilli: number;
  unitPriceMinor: number;
  taxes: Array<{ name: string; rateBps: number }>;
  lineTotalMinor: number;
  discountMinor: number;
  taxMinor: number;
}

export interface Invoice extends InvoiceSummary {
  customerEmail: string | null;
  taxInclusive: boolean;
  discountType: 'percent' | 'fixed' | null;
  discountValue: number | null;
  feesMinor: number;
  subtotalMinor: number;
  discountTotalMinor: number;
  taxTotalMinor: number;
  notes: string | null;
  terms: string | null;
  version: number;
  sentAt: string | null;
  items: InvoiceItem[];
  taxBreakdown: Array<{ name: string; rateBps: number; taxableAmount: number; tax: number }>;
  warnings: string[];
  editable: boolean;
}

export interface ActivityEntry {
  id: string;
  type: string;
  message: string | null;
  createdAt: string;
}

export type PaymentStatus = 'pending' | 'successful' | 'failed' | 'refunded';

export interface Payment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  amountMinor: number;
  refundedMinor: number;
  currency: string;
  status: PaymentStatus;
  method: 'card' | 'apple_pay' | 'google_pay' | 'other' | null;
  stripePaymentIntentId: string | null;
  receiptUrl: string | null;
  failureCode: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface ConnectStatus {
  configured: boolean;
  connected: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  requirementsDue: string[];
}
