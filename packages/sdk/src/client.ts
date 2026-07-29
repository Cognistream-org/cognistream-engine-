import axios, {
  type AxiosError,
  type AxiosInstance,
  type InternalAxiosRequestConfig,
} from 'axios';
import { randomUUID } from 'node:crypto';
import { mapAxiosError } from './errors.js';
import { createBillingResource, type BillingResource } from './resources/billing.js';
import {
  createStripeConnectResource,
  type StripeConnectResource,
} from './resources/stripe-connect.js';
import { WebSocketClient } from './websocket.js';
import type {
  Agent,
  AgentFilters,
  ClientOptions,
  CreateAgentParams,
  CreateTransactionParams,
  Dispute,
  DisputeFilters,
  Paginated,
  ReleaseParams,
  StreamEvent,
  Transaction,
  TransactionFilters,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.cognistream.io';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 3;

type RetryConfig = InternalAxiosRequestConfig & { __retryCount?: number };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toQuery(params?: Record<string, string | number | undefined>): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function resolveIdempotencyKey(provided?: string): string {
  return provided && provided.length > 0 ? provided : randomUUID();
}

export class CogniStreamClient {
  private readonly http: AxiosInstance;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly defaultAgentId?: string;
  private streamClient: WebSocketClient | null = null;
  private readonly streamHandlers = new Map<string, Set<(payload: unknown) => void>>();

  readonly billing: BillingResource;
  readonly connect: StripeConnectResource;

  constructor(options: ClientOptions) {
    if (!options.apiKey || options.apiKey.length < 16) {
      throw new Error('apiKey is required');
    }
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.defaultAgentId = options.agentId;

    this.http = axios.create({
      baseURL: this.baseUrl,
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      headers: {
        'X-API-Key': this.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'cognistream-sdk/0.1.0',
      },
    });

    this.http.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const config = error.config as RetryConfig | undefined;
        if (!config) {
          return Promise.reject(error);
        }

        const status = error.response?.status;
        const retryCount = config.__retryCount ?? 0;
        const shouldRetry =
          status !== undefined && status >= 500 && retryCount < this.maxRetries;

        if (!shouldRetry) {
          return Promise.reject(error);
        }

        config.__retryCount = retryCount + 1;
        await sleep(200 * 2 ** retryCount);
        return this.http.request(config);
      },
    );

    const deps = {
      request: this.request.bind(this),
      http: this.http,
      toQuery,
      idempotencyKey: resolveIdempotencyKey,
    };
    this.billing = createBillingResource(deps);
    this.connect = createStripeConnectResource(deps);
  }

  private async request<T>(fn: () => Promise<{ data: T }>): Promise<T> {
    try {
      const { data } = await fn();
      return data;
    } catch (error) {
      mapAxiosError(error);
    }
  }

  async createAgent(params: CreateAgentParams): Promise<Agent> {
    return this.request(() => this.http.post<Agent>('/v1/agents', params));
  }

  async listAgents(filters?: AgentFilters): Promise<Paginated<Agent>> {
    const qs = toQuery({
      capability: filters?.capability,
      status: filters?.status,
      page: filters?.page,
      limit: filters?.limit,
    });
    return this.request(() => this.http.get<Paginated<Agent>>(`/v1/agents${qs}`));
  }

  async getAgent(id: string): Promise<Agent> {
    return this.request(() => this.http.get<Agent>(`/v1/agents/${id}`));
  }

  async activateAgent(id: string): Promise<Agent> {
    return this.request(() => this.http.post<Agent>(`/v1/agents/${id}/activate`));
  }

  async deactivateAgent(id: string): Promise<Agent> {
    return this.request(() => this.http.post<Agent>(`/v1/agents/${id}/deactivate`));
  }

  async createTransaction(params: CreateTransactionParams): Promise<Transaction> {
    const { agentId, idempotencyKey, ...body } = params;
    const headers: Record<string, string> = { 'X-Agent-Id': agentId };
    if (idempotencyKey) {
      headers['X-Idempotency-Key'] = idempotencyKey;
    }
    const data = await this.request(() =>
      this.http.post<{ transaction: Transaction }>('/v1/transactions', body, { headers }),
    );
    return data.transaction;
  }

  async releaseEscrow(
    transactionId: string,
    params?: ReleaseParams,
  ): Promise<Transaction> {
    const data = await this.request(() =>
      this.http.post<{ transaction: Transaction }>(
        `/v1/transactions/${transactionId}/release`,
        params ?? {},
      ),
    );
    return data.transaction;
  }

  async getTransaction(id: string): Promise<Transaction> {
    const data = await this.request(() =>
      this.http.get<{ transaction: Transaction }>(`/v1/transactions/${id}`),
    );
    return data.transaction;
  }

  async listTransactions(
    filters?: TransactionFilters,
  ): Promise<Paginated<Transaction>> {
    const qs = toQuery({
      buyerId: filters?.buyerId,
      sellerId: filters?.sellerId,
      status: filters?.status,
      page: filters?.page,
      limit: filters?.limit,
    });
    return this.request(() =>
      this.http.get<Paginated<Transaction>>(`/v1/transactions${qs}`),
    );
  }

  async raiseDispute(transactionId: string, reason: string): Promise<Dispute> {
    if (!this.defaultAgentId) {
      throw new Error('agentId is required on CogniStreamClient to raise disputes');
    }
    const data = await this.request(() =>
      this.http.post<{ dispute: Dispute }>(
        `/v1/transactions/${transactionId}/dispute`,
        { reason },
        { headers: { 'X-Agent-Id': this.defaultAgentId } },
      ),
    );
    return data.dispute;
  }

  async listDisputes(filters?: DisputeFilters): Promise<Paginated<Dispute>> {
    const qs = toQuery({
      status: filters?.status,
      page: filters?.page,
      limit: filters?.limit,
    });
    return this.request(() => this.http.get<Paginated<Dispute>>(`/v1/disputes${qs}`));
  }

  connectStream(): WebSocketClient {
    if (this.streamClient) {
      this.streamClient.close();
    }
    this.streamClient = new WebSocketClient({
      apiKey: this.apiKey,
      baseUrl: this.baseUrl,
    });
    for (const [event, handlers] of this.streamHandlers) {
      for (const handler of handlers) {
        this.streamClient.on(event, handler);
      }
    }
    this.streamClient.connect();
    return this.streamClient;
  }

  on(event: StreamEvent | string, handler: (payload: unknown) => void): void {
    const set = this.streamHandlers.get(event) ?? new Set<(payload: unknown) => void>();
    set.add(handler);
    this.streamHandlers.set(event, set);
    this.streamClient?.on(event, handler);
  }
}
