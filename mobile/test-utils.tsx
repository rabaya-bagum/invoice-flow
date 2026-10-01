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
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
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
