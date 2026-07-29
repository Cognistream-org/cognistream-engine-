import type { AxiosInstance } from 'axios';
import type {
  ConnectOnboardingParams,
  CreateConnectAccountParams,
  StripeConnectAccount,
} from '../types.js';

export type ConnectHttpDeps = {
  request: <T>(fn: () => Promise<{ data: T }>) => Promise<T>;
  http: AxiosInstance;
  idempotencyKey: (provided?: string) => string;
};

export function createStripeConnectResource(deps: ConnectHttpDeps) {
  const { request, http, idempotencyKey } = deps;

  return {
    createAccount(params: CreateConnectAccountParams): Promise<StripeConnectAccount> {
      const { idempotencyKey: key, ...body } = params;
      return request(() =>
        http.post<StripeConnectAccount>('/v1/stripe/connect', body, {
          headers: { 'X-Idempotency-Key': idempotencyKey(key) },
        }),
      );
    },

    getAccount(): Promise<StripeConnectAccount> {
      return request(() => http.get<StripeConnectAccount>('/v1/stripe/connect'));
    },

    createOnboardingLink(
      params: ConnectOnboardingParams,
    ): Promise<{ url: string }> {
      const { idempotencyKey: key, ...body } = params;
      return request(() =>
        http.post<{ url: string }>('/v1/stripe/connect/onboarding', body, {
          headers: { 'X-Idempotency-Key': idempotencyKey(key) },
        }),
      );
    },

    disconnect(idempotencyKeyValue?: string): Promise<void> {
      return request(() =>
        http.delete<void>('/v1/stripe/connect', {
          headers: { 'X-Idempotency-Key': idempotencyKey(idempotencyKeyValue) },
        }),
      );
    },
  };
}

export type StripeConnectResource = ReturnType<typeof createStripeConnectResource>;
