import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { useAuth } from './src/store/auth';

// Test files must call jest.mock('./src/store/auth') themselves (jest only hoists it per file).

export function setupApi(api: Record<string, jest.Mock>) {
  (useAuth as jest.Mock).mockReturnValue({ api });
  return api;
}

export function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

export const nav = () => ({
  navigate: jest.fn(),
  goBack: jest.fn(),
  popToTop: jest.fn(),
  replace: jest.fn(),
});

export const business = {
  id: 'b1',
  name: 'Acme',
  ownerName: null,
  email: null,
  phone: null,
  addressLine1: null,
  addressLine2: null,
  city: null,
  province: null,
  postalCode: null,
  country: null,
  website: null,
  taxNumber: null,
  paymentInstructions: null,
  logoPath: null,
  signaturePath: null,
  defaultCurrency: 'USD',
  defaultTaxRateBps: 500,
  defaultPaymentTermsDays: 14,
  timezone: 'UTC',
  invoicePrefix: 'INV-',
  estimatePrefix: 'EST-',
  numberPadding: 4,
  template: 'classic',
  accentColor: '#2563EB',
  stripeChargesEnabled: false,
};

export const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111';

export const invoiceSummary = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  number: 'INV-0001',
  status: 'sent',
  displayStatus: 'sent',
  customerId: CUSTOMER_ID,
  customerName: 'Acme Ltd',
  issueDate: '2026-10-01',
  dueDate: '2026-10-15',
  currency: 'USD',
  totalMinor: 105_000,
  amountPaidMinor: 0,
  balanceDueMinor: 105_000,
  updatedAt: '',
  ...over,
});

export const invoiceDetail = (over: Record<string, unknown> = {}) => ({
  ...invoiceSummary(),
  customerEmail: 'billing@acme.test',
  taxInclusive: false,
  discountType: null,
  discountValue: null,
  feesMinor: 0,
  subtotalMinor: 100_000,
  discountTotalMinor: 0,
  taxTotalMinor: 5_000,
  notes: null,
  terms: null,
  version: 2,
  sentAt: null,
  editable: true,
  warnings: [],
  taxBreakdown: [{ name: 'GST', rateBps: 500, taxableAmount: 100_000, tax: 5_000 }],
  items: [
    {
      id: 'it1',
      productId: null,
      description: 'Web Development',
      quantityMilli: 10_000,
      unitPriceMinor: 10_000,
      taxes: [{ name: 'GST', rateBps: 500 }],
      lineTotalMinor: 100_000,
      discountMinor: 0,
      taxMinor: 5_000,
    },
  ],
  ...over,
});

export const estimateSummary = (over: Record<string, unknown> = {}) => ({
  id: 'e1',
  number: 'EST-0001',
  status: 'draft',
  displayStatus: 'draft',
  customerId: CUSTOMER_ID,
  customerName: 'Acme Ltd',
  issueDate: '2026-10-01',
  expiryDate: '2026-10-31',
  currency: 'USD',
  totalMinor: 105_000,
  convertedInvoiceId: null,
  updatedAt: '',
  ...over,
});

export const estimateDetail = (over: Record<string, unknown> = {}) => ({
  ...estimateSummary(),
  customerEmail: 'billing@acme.test',
  taxInclusive: false,
  discountType: null,
  discountValue: null,
  feesMinor: 0,
  subtotalMinor: 100_000,
  discountTotalMinor: 0,
  taxTotalMinor: 5_000,
  notes: null,
  terms: null,
  version: 2,
  viewedAt: null,
  decidedAt: null,
  decidedByName: null,
  editable: true,
  convertible: true,
  taxBreakdown: [{ name: 'GST', rateBps: 500, taxableAmount: 100_000, tax: 5_000 }],
  items: [
    {
      id: 'it1',
      productId: null,
      description: 'Web Development',
      quantityMilli: 10_000,
      unitPriceMinor: 10_000,
      taxes: [{ name: 'GST', rateBps: 500 }],
      lineTotalMinor: 100_000,
      discountMinor: 0,
      taxMinor: 5_000,
    },
  ],
  ...over,
});
