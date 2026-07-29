import type { AxiosInstance } from 'axios';
import type {
  BillingLimits,
  BillingProfile,
  ChangeTierParams,
  CheckoutParams,
  CheckoutSession,
  Invoice,
  InvoiceFilters,
  Paginated,
  PortalParams,
  Subscription,
  UsageSummary,
} from '../types.js';

export type BillingHttpDeps = {
  request: <T>(fn: () => Promise<{ data: T }>) => Promise<T>;
  http: AxiosInstance;
  toQuery: (params?: Record<string, string | number | undefined>) => string;
  idempotencyKey: (provided?: string) => string;
};

export function createBillingResource(deps: BillingHttpDeps) {
  const { request, http, toQuery, idempotencyKey } = deps;

  return {
    getProfile(): Promise<BillingProfile> {
      return request(() => http.get<BillingProfile>('/v1/billing/profile'));
    },

    checkout(params: CheckoutParams): Promise<CheckoutSession> {
      const { idempotencyKey: key, ...body } = params;
      return request(() =>
        http.post<CheckoutSession>('/v1/billing/checkout', body, {
          headers: { 'X-Idempotency-Key': idempotencyKey(key) },
        }),
      );
    },

    getPortal(params: PortalParams): Promise<{ url: string }> {
      const qs = toQuery({ returnUrl: params.returnUrl });
      return request(() => http.get<{ url: string }>(`/v1/billing/portal${qs}`));
    },

    getSubscription(): Promise<Subscription> {
      return request(() => http.get<Subscription>('/v1/billing/subscription'));
    },

    changeTier(params: ChangeTierParams): Promise<Subscription> {
      const { idempotencyKey: key, ...body } = params;
      return request(() =>
        http.patch<Subscription>('/v1/billing/subscription', body, {
          headers: { 'X-Idempotency-Key': idempotencyKey(key) },
        }),
      );
    },

    cancelSubscription(idempotencyKeyValue?: string): Promise<Subscription> {
      return request(() =>
        http.delete<Subscription>('/v1/billing/subscription', {
          headers: { 'X-Idempotency-Key': idempotencyKey(idempotencyKeyValue) },
        }),
      );
    },

    listInvoices(filters?: InvoiceFilters): Promise<Paginated<Invoice>> {
      const qs = toQuery({
        page: filters?.page,
        limit: filters?.limit,
      });
      return request(() => http.get<Paginated<Invoice>>(`/v1/billing/invoices${qs}`));
    },

    getInvoice(id: string): Promise<Invoice> {
      return request(() => http.get<Invoice>(`/v1/billing/invoices/${id}`));
    },

    getUsage(): Promise<UsageSummary> {
      return request(() => http.get<UsageSummary>('/v1/billing/usage'));
    },

    getLimits(): Promise<BillingLimits> {
      return request(() => http.get<BillingLimits>('/v1/billing/limits'));
    },
  };
}

export type BillingResource = ReturnType<typeof createBillingResource>;
