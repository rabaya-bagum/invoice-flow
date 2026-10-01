import {
  QueryClient,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { InvoiceWriteInput, SendInvoiceInput, TaxRateInput } from '@invoiceflow/shared';
import type { BusinessUpdate, CustomerInput, ProductInput } from '../models';
import { useAuth } from '../store/auth';

export const PAGE_SIZE = 25;

export const keys = {
  business: ['business'] as const,
  customers: ['customers'] as const,
  customer: (id: string) => ['customers', 'detail', id] as const,
  products: ['products'] as const,
  product: (id: string) => ['products', 'detail', id] as const,
  invoices: ['invoices'] as const,
  taxRates: ['tax-rates'] as const,
  asset: (kind: string) => ['business-asset', kind] as const,
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

export function useBusiness() {
  const { api } = useAuth();
  return useQuery({ queryKey: keys.business, queryFn: api.getBusiness });
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
  return useInfiniteQuery({
    queryKey: [...keys.customers, 'list', search],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => api.listCustomers({ search, limit: PAGE_SIZE, offset: pageParam }),
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
  return useInfiniteQuery({
    queryKey: [...keys.products, 'list', search],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.listProducts({ search, limit: PAGE_SIZE, offset: pageParam, includeInactive: true }),
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
    mutationFn: (input: InvoiceWriteInput) =>
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
  return useQuery({
    queryKey: keys.taxRates,
    queryFn: async () => (await api.listTaxRates()).items,
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
