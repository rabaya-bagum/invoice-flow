import {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  EstimateWriteInput,
  InvoiceWriteInput,
  SendInvoiceInput,
  TaxRateInput,
} from '@invoiceflow/shared';
import type { BusinessUpdate, CustomerInput, DashboardPeriod, ProductInput } from '../models';
import { useOffline } from '../offline/context';
import { filterCustomers, filterProducts } from '../offline/reference';
import { useAuth } from '../store/auth';
import { classifyError } from '../utils/errors';

export const PAGE_SIZE = 25;

export const keys = {
  business: ['business'] as const,
  customers: ['customers'] as const,
  customer: (id: string) => ['customers', 'detail', id] as const,
  products: ['products'] as const,
  product: (id: string) => ['products', 'detail', id] as const,
  invoices: ['invoices'] as const,
  estimates: ['estimates'] as const,
  // Nested under invoices so any invoice/payment mutation refreshes the dashboard too.
  dashboard: (period: string) => ['invoices', 'dashboard', period] as const,
  taxRates: ['tax-rates'] as const,
  asset: (kind: string) => ['business-asset', kind] as const,
  payments: ['payments'] as const,
  connect: ['connect-status'] as const,
  notifications: ['notifications'] as const,
};

/** Only retry transient failures; a 4xx will not fix itself. */
export function shouldRetry(count: number, err: unknown) {
  const kind = (err as { kind?: string })?.kind;
  return (kind === 'network' || kind === 'server') && count < 2;
}

export function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: shouldRetry, staleTime: 30_000 } },
  });
}

/**
 * Runs `live`; if there is no connection and a saved copy exists, answers from the copy instead (so a
 * draft can be written offline). Any other error is still an error.
 */
async function orSavedCopy<T>(
  live: () => Promise<T>,
  saved: () => Promise<T | undefined>,
): Promise<T> {
  try {
    return await live();
  } catch (e) {
    const copy = classifyError(e) === 'network' ? await saved() : undefined;
    if (copy !== undefined) return copy;
    throw e;
  }
}

export function useBusiness() {
  const { api } = useAuth();
  const offline = useOffline();
  return useQuery({
    queryKey: keys.business,
    queryFn: () =>
      orSavedCopy(
        () => api.getBusiness(),
        async () => (await offline.getSnapshot())?.business,
      ),
  });
}

export function useUpdateBusiness() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: BusinessUpdate) => api.updateBusiness(patch),
    onSuccess: (data) => qc.setQueryData(keys.business, data),
  });
}

export function useCustomers(search: string) {
  const { api } = useAuth();
  const offline = useOffline();
  return useInfiniteQuery({
    queryKey: [...keys.customers, 'list', search],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      orSavedCopy(
        () => api.listCustomers({ search, limit: PAGE_SIZE, offset: pageParam }),
        async () => {
          const all = (await offline.getSnapshot())?.customers;
          if (!all) return undefined;
          const items = filterCustomers(all, search);
          return { items: items.slice(pageParam, pageParam + PAGE_SIZE), total: items.length };
        },
      ),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
}

export function useCustomer(id: string | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: keys.customer(id ?? ''),
    queryFn: () => api.getCustomer(id as string),
    enabled: Boolean(id),
  });
}

export function useSaveCustomer(id?: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomerInput) =>
      id ? api.updateCustomer(id, input) : api.createCustomer(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.customers }),
  });
}

export function useDeleteCustomer() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCustomer(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.customers }),
  });
}

export function useProducts(search: string) {
  const { api } = useAuth();
  const offline = useOffline();
  return useInfiniteQuery({
    queryKey: [...keys.products, 'list', search],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      orSavedCopy(
        () =>
          api.listProducts({ search, limit: PAGE_SIZE, offset: pageParam, includeInactive: true }),
        async () => {
          const all = (await offline.getSnapshot())?.products;
          if (!all) return undefined;
          const items = filterProducts(all, search);
          return { items: items.slice(pageParam, pageParam + PAGE_SIZE), total: items.length };
        },
      ),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
}

export function useProduct(id: string | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: keys.product(id ?? ''),
    queryFn: () => api.getProduct(id as string),
    enabled: Boolean(id),
  });
}

export function useSaveProduct(id?: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ProductInput) =>
      id ? api.updateProduct(id, input) : api.createProduct(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.products }),
  });
}

export function useDeleteProduct() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteProduct(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.products }),
  });
}

// ------------------------------------------------------------------ invoices & tax rates
export interface InvoiceFilters {
  search: string;
  status?: string;
  from?: string;
  to?: string;
}

export function useInvoices(f: InvoiceFilters) {
  const { api } = useAuth();
  return useInfiniteQuery({
    queryKey: [...keys.invoices, 'list', f],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.listInvoices({ ...f, limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
}

export function useCustomerInvoices(customerId: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: [...keys.invoices, 'customer', customerId],
    queryFn: () => api.listCustomerInvoices(customerId, { limit: 50 }),
  });
}

export function useInvoice(id: string | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: [...keys.invoices, 'detail', id ?? ''],
    queryFn: () => api.getInvoice(id as string),
    enabled: Boolean(id),
  });
}

export function useInvoiceActivity(id: string | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: [...keys.invoices, 'activity', id ?? ''],
    queryFn: () => api.getInvoiceActivity(id as string),
    enabled: Boolean(id),
  });
}

export function useSaveInvoice(id?: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InvoiceWriteInput & { id?: string }) =>
      id ? api.updateInvoice(id, input) : api.createInvoice(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invoices }),
  });
}

export function useDeleteInvoice() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteInvoice(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invoices }),
  });
}

export function useTransitionInvoice() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; to: 'sent' | 'cancelled' }) => api.transitionInvoice(v.id, v.to),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invoices }),
  });
}

export function useTaxRates() {
  const { api } = useAuth();
  const offline = useOffline();
  return useQuery({
    queryKey: keys.taxRates,
    queryFn: () =>
      orSavedCopy(
        async () => (await api.listTaxRates()).items,
        async () => (await offline.getSnapshot())?.taxRates,
      ),
  });
}

export function useSaveTaxRate(id?: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: TaxRateInput) =>
      id ? api.updateTaxRate(id, input) : api.createTaxRate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.taxRates }),
  });
}

export function useDeleteTaxRate() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteTaxRate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.taxRates }),
  });
}

/** Logo / signature as a data URI. `path` is part of the key so a new upload refetches. */
export function useBusinessAsset(kind: 'logo' | 'signature', path: string | null) {
  const { api } = useAuth();
  return useQuery({
    queryKey: [...keys.asset(kind), path],
    queryFn: () => api.getBusinessAssetUri(kind),
    enabled: Boolean(path),
    staleTime: Infinity,
  });
}

export function useUploadBusinessAsset(kind: 'logo' | 'signature') {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { blob: Blob; contentType: string }) =>
      api.uploadBusinessAsset(kind, v.blob, v.contentType),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.business }),
  });
}

export function useDeleteBusinessAsset(kind: 'logo' | 'signature') {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.deleteBusinessAsset(kind),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.business }),
  });
}

export function useSendInvoice(id: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendInvoiceInput) => api.sendInvoice(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invoices }),
  });
}

// ------------------------------------------------------------------ online payments
export function usePayments(f: { status?: string; search: string }) {
  const { api } = useAuth();
  return useInfiniteQuery({
    queryKey: [...keys.payments, 'list', f],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.listPayments({ ...f, limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
}

export function usePayment(id: string) {
  const { api } = useAuth();
  return useQuery({
    queryKey: [...keys.payments, 'detail', id],
    queryFn: () => api.getPayment(id),
  });
}

export function useRefundPayment(id: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (amountMinor?: number) => api.refundPayment(id, amountMinor),
    // The refund is confirmed by Stripe's webhook, so refetch shortly after instead of assuming.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.payments });
      void qc.invalidateQueries({ queryKey: keys.invoices });
    },
  });
}

export function useConnectStatus() {
  const { api } = useAuth();
  return useQuery({ queryKey: keys.connect, queryFn: api.getConnectStatus, staleTime: 0 });
}

export function useStartConnectOnboarding() {
  const { api } = useAuth();
  return useMutation({ mutationFn: () => api.startConnectOnboarding() });
}

// ------------------------------------------------------------------ notifications
export function useNotifications() {
  const { api } = useAuth();
  return useQuery({
    queryKey: keys.notifications,
    queryFn: () => api.listNotifications({ limit: 50 }),
    staleTime: 15_000,
  });
}

export function useMarkNotificationRead() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
}

export function useMarkAllNotificationsRead() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.markAllNotificationsRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
}

// ------------------------------------------------------------------ dashboard
export function useDashboard(period: DashboardPeriod) {
  const { api } = useAuth();
  return useQuery({
    queryKey: keys.dashboard(period),
    queryFn: () => api.getDashboard(period),
    staleTime: 15_000,
  });
}

// ------------------------------------------------------------------ estimates
export function useEstimates(f: InvoiceFilters) {
  const { api } = useAuth();
  return useInfiniteQuery({
    queryKey: [...keys.estimates, 'list', f],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.listEstimates({ ...f, limit: PAGE_SIZE, offset: pageParam }),
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
}

export function useEstimate(id: string | undefined) {
  const { api } = useAuth();
  return useQuery({
    queryKey: [...keys.estimates, 'detail', id ?? ''],
    queryFn: () => api.getEstimate(id as string),
    enabled: Boolean(id),
  });
}

export function useSaveEstimate(id?: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EstimateWriteInput) =>
      id ? api.updateEstimate(id, input) : api.createEstimate(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.estimates }),
  });
}

export function useDeleteEstimate() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteEstimate(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.estimates }),
  });
}

export function useTransitionEstimate() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; to: 'sent' | 'accepted' | 'rejected' }) =>
      api.transitionEstimate(v.id, v.to),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.estimates }),
  });
}

/** Converting creates an invoice, so both lists (and the dashboard) must refresh. */
export function useConvertEstimate() {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.convertEstimate(id),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.estimates }),
        qc.invalidateQueries({ queryKey: keys.invoices }),
      ]),
  });
}

export function useSendEstimate(id: string) {
  const { api } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SendInvoiceInput) => api.sendEstimate(id, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.estimates }),
  });
}
