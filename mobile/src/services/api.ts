import type {
  EstimateWriteInput,
  InvoiceWriteInput,
  SendInvoiceInput,
  TaxRateInput,
} from '@invoiceflow/shared';
import { bytesToBase64 } from '../utils/base64';
import type {
  ActivityEntry,
  BusinessProfile,
  ConnectStatus,
  Payment,
  BusinessUpdate,
  Customer,
  CustomerInput,
  Invoice,
  Dashboard,
  DashboardPeriod,
  Estimate,
  EstimateSummary,
  InvoiceSummary,
  NotificationPage,
  Page,
  Product,
  ProductInput,
  TaxRate,
} from '../models';
import { classifyError, type ErrorKind } from '../utils/errors';

export class ApiError extends Error {
  constructor(
    public readonly kind: ErrorKind,
    public readonly status?: number,
    public readonly code?: string,
  ) {
    super(kind);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  /** Returns a fresh access token, or null when signed out. */
  getToken: () => Promise<string | null>;
  /** Forces a token refresh; called once after a 401 before giving up. */
  refreshToken: () => Promise<string | null>;
  onSessionExpired: () => void;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetchImpl ?? fetch;

  async function send(path: string, init: RequestInit, token: string | null): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
    try {
      return await doFetch(`${opts.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...((init.headers as Record<string, string> | undefined) ?? {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /** Sends the request (with one refresh-and-retry on 401) and returns the OK response. */
  async function execute(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await send(path, init, await opts.getToken());
      if (res.status === 401) {
        const fresh = await opts.refreshToken();
        if (fresh) res = await send(path, init, fresh);
      }
    } catch (err) {
      throw new ApiError(classifyError(err) === 'network' ? 'network' : 'unknown');
    }
    if (res.status === 401) {
      opts.onSessionExpired();
      throw new ApiError('session_expired', 401);
    }
    if (!res.ok) {
      let code: string | undefined;
      try {
        code = (await res.json())?.error?.code;
      } catch {
        /* non-JSON error body: ignore */
      }
      throw new ApiError(res.status >= 500 ? 'server' : 'unknown', res.status, code);
    }
    return res;
  }

  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await execute(path, init);
    return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
  }

  const qs = (params: Record<string, string | number | boolean | undefined>) => {
    const parts = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    return parts.length ? `?${parts.join('&')}` : '';
  };
  const body = (method: string, data: unknown): RequestInit => ({
    method,
    body: JSON.stringify(data),
  });

  return {
    getMe: () => request<MeResponse>('/v1/me'),
    listEstimates: (p: InvoiceListParams) =>
      request<Page<EstimateSummary>>(`/v1/estimates${qs({ ...p })}`),
    getEstimate: (id: string) => request<Estimate>(`/v1/estimates/${id}`),
    createEstimate: (input: EstimateWriteInput) =>
      request<Estimate>('/v1/estimates', body('POST', input)),
    updateEstimate: (id: string, input: EstimateWriteInput) =>
      request<Estimate>(`/v1/estimates/${id}`, body('PUT', input)),
    deleteEstimate: (id: string) => request<void>(`/v1/estimates/${id}`, { method: 'DELETE' }),
    transitionEstimate: (id: string, to: 'sent' | 'accepted' | 'rejected') =>
      request<Estimate>(`/v1/estimates/${id}/transition`, body('POST', { to })),
    convertEstimate: (id: string) =>
      request<{ estimate: Estimate; invoice: Invoice }>(`/v1/estimates/${id}/convert`, {
        method: 'POST',
      }),
    createEstimateShareLink: (id: string) =>
      request<{ url: string }>(`/v1/estimates/${id}/share-link`, { method: 'POST' }),
    sendEstimate: (id: string, input: SendInvoiceInput) =>
      request<{ estimate: Estimate; sentTo: string }>(
        `/v1/estimates/${id}/send`,
        body('POST', input),
      ),
    downloadEstimatePdf: async (id: string) =>
      new Uint8Array(
        await (await execute(`/v1/estimates/${id}/pdf`, { method: 'POST' })).arrayBuffer(),
      ),
    getDashboard: (period: DashboardPeriod = 'all') =>
      request<Dashboard>(`/v1/dashboard${qs({ period })}`),
    deleteAccount: () => request<void>('/v1/me', body('DELETE', { confirm: 'DELETE' })),

    getBusiness: () => request<BusinessProfile>('/v1/business'),
    updateBusiness: (patch: BusinessUpdate) =>
      request<BusinessProfile>('/v1/business', body('PUT', patch)),

    listCustomers: (p: ListParams) => request<Page<Customer>>(`/v1/customers${qs({ ...p })}`),
    getCustomer: (id: string) => request<Customer>(`/v1/customers/${id}`),
    createCustomer: (input: CustomerInput) =>
      request<Customer>('/v1/customers', body('POST', input)),
    updateCustomer: (id: string, input: CustomerInput) =>
      request<Customer>(`/v1/customers/${id}`, body('PUT', input)),
    deleteCustomer: (id: string) => request<void>(`/v1/customers/${id}`, { method: 'DELETE' }),

    listInvoices: (p: InvoiceListParams) =>
      request<Page<InvoiceSummary>>(`/v1/invoices${qs({ ...p })}`),
    getInvoice: (id: string) => request<Invoice>(`/v1/invoices/${id}`),
    createInvoice: (input: InvoiceWriteInput & { id?: string }) =>
      request<Invoice>('/v1/invoices', body('POST', input)),
    updateInvoice: (id: string, input: InvoiceWriteInput) =>
      request<Invoice>(`/v1/invoices/${id}`, body('PUT', input)),
    deleteInvoice: (id: string) => request<void>(`/v1/invoices/${id}`, { method: 'DELETE' }),
    transitionInvoice: (id: string, to: 'sent' | 'cancelled') =>
      request<Invoice>(`/v1/invoices/${id}/transition`, body('POST', { to })),
    getInvoiceActivity: (id: string) =>
      request<{ items: ActivityEntry[] }>(`/v1/invoices/${id}/activity`),
    listCustomerInvoices: (customerId: string, p: { limit?: number; offset?: number } = {}) =>
      request<Page<InvoiceSummary>>(`/v1/customers/${customerId}/invoices${qs({ ...p })}`),

    sendInvoice: (id: string, input: SendInvoiceInput) =>
      request<{ invoice: Invoice; sentTo: string }>(`/v1/invoices/${id}/send`, body('POST', input)),
    createShareLink: (id: string) =>
      request<{ url: string }>(`/v1/invoices/${id}/share-link`, { method: 'POST' }),
    downloadInvoicePdf: async (id: string) =>
      new Uint8Array(
        await (await execute(`/v1/invoices/${id}/pdf`, { method: 'POST' })).arrayBuffer(),
      ),

    uploadBusinessAsset: (kind: 'logo' | 'signature', data: Blob, contentType: string) =>
      request<void>(`/v1/business/${kind}`, {
        method: 'PUT',
        body: data,
        headers: { 'Content-Type': contentType },
      }),
    deleteBusinessAsset: (kind: 'logo' | 'signature') =>
      request<void>(`/v1/business/${kind}`, { method: 'DELETE' }),
    /** The stored logo/signature as a data: URI for <Image>, or null if none is set. */
    getBusinessAssetUri: async (kind: 'logo' | 'signature'): Promise<string | null> => {
      try {
        const res = await execute(`/v1/business/${kind}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        return `data:${res.headers.get('content-type') ?? 'image/png'};base64,${bytesToBase64(bytes)}`;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }
    },

    getConnectStatus: () => request<ConnectStatus>('/v1/payments/connect/status'),
    startConnectOnboarding: () =>
      request<{ url: string }>('/v1/payments/connect/onboard', { method: 'POST' }),
    listPayments: (p: { status?: string; search?: string; limit?: number; offset?: number }) =>
      request<Page<Payment>>(`/v1/payments${qs({ ...p })}`),
    getPayment: (id: string) => request<Payment>(`/v1/payments/${id}`),
    refundPayment: (id: string, amountMinor?: number) =>
      request<{ requested: number }>(
        `/v1/payments/${id}/refund`,
        body('POST', amountMinor ? { amountMinor } : {}),
      ),

    listNotifications: (p: { unread?: boolean; limit?: number; offset?: number } = {}) =>
      request<NotificationPage>(`/v1/notifications${qs({ ...p })}`),
    markNotificationRead: (id: string) =>
      request<void>(`/v1/notifications/${id}/read`, { method: 'POST' }),
    markAllNotificationsRead: () =>
      request<{ updated: number }>('/v1/notifications/read-all', { method: 'POST' }),
    registerPushToken: (token: string, platform: 'ios' | 'android') =>
      request<void>('/v1/push-tokens', body('POST', { token, platform })),
    removePushToken: (token: string) => request<void>('/v1/push-tokens', body('DELETE', { token })),

    listTaxRates: () => request<{ items: TaxRate[] }>('/v1/tax-rates'),
    createTaxRate: (input: TaxRateInput) => request<TaxRate>('/v1/tax-rates', body('POST', input)),
    updateTaxRate: (id: string, input: TaxRateInput) =>
      request<TaxRate>(`/v1/tax-rates/${id}`, body('PUT', input)),
    deleteTaxRate: (id: string) => request<void>(`/v1/tax-rates/${id}`, { method: 'DELETE' }),

    listProducts: (p: ListParams) => request<Page<Product>>(`/v1/products${qs({ ...p })}`),
    getProduct: (id: string) => request<Product>(`/v1/products/${id}`),
    createProduct: (input: ProductInput) => request<Product>('/v1/products', body('POST', input)),
    updateProduct: (id: string, input: ProductInput) =>
      request<Product>(`/v1/products/${id}`, body('PUT', input)),
    deleteProduct: (id: string) => request<void>(`/v1/products/${id}`, { method: 'DELETE' }),
  };
}

export interface InvoiceListParams extends ListParams {
  status?: string;
  from?: string;
  to?: string;
  customerId?: string;
}

export interface ListParams {
  search?: string;
  limit?: number;
  offset?: number;
  category?: string;
  includeInactive?: boolean;
}

export type ApiClient = ReturnType<typeof createApiClient>;

export interface MeResponse {
  email?: string;
  user: { id: string; fullName: string | null };
  business: {
    id: string;
    name: string;
    defaultCurrency: string;
    timezone: string;
    stripeChargesEnabled: boolean;
  };
}
