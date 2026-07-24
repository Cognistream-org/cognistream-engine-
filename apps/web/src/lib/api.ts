import type {
  AgentResponse,
  ApiKeyMetadata,
  CreatedApiKey,
  TransactionResponse,
} from '@cognistream/shared';

export interface PaginatedMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginatedMeta;
}

export interface OverviewResponse {
  organization: {
    id: string;
    name: string;
    slug: string;
    tier: string;
    balanceCents: string;
  };
  stats: {
    transactionsThisMonth: number;
    volumeCentsThisMonth: string;
    activeAgents: number;
  };
}

/** Client-side fetch via BFF proxy (reads httpOnly session cookie server-side). */
export function proxyUrl(path: string): string {
  const normalized = path.startsWith('/') ? path.slice(1) : path;
  return `/api/${normalized}`;
}

export async function clientFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(proxyUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      typeof body?.error?.message === 'string'
        ? body.error.message
        : `Request failed (${res.status})`;
    throw new Error(message);
  }

  return res.json() as Promise<T>;
}

export type AgentsListResponse = PaginatedResponse<AgentResponse>;
export type TransactionsListResponse = PaginatedResponse<TransactionResponse>;
export type ApiKeysListResponse = PaginatedResponse<ApiKeyMetadata>;

export interface TransactionDetailResponse {
  transaction: TransactionResponse;
}

export interface ReleaseEscrowResponse {
  transaction: TransactionResponse;
}

export async function fetchOverview(): Promise<OverviewResponse> {
  return clientFetch<OverviewResponse>('v1/overview');
}

export async function fetchAgents(params?: Record<string, string>): Promise<AgentsListResponse> {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  return clientFetch<AgentsListResponse>(`v1/agents${qs}`);
}

export async function fetchTransactions(
  params?: Record<string, string>,
): Promise<TransactionsListResponse> {
  const qs = params ? `?${new URLSearchParams(params)}` : '';
  return clientFetch<TransactionsListResponse>(`v1/transactions${qs}`);
}

export async function fetchTransaction(id: string): Promise<TransactionDetailResponse> {
  return clientFetch<TransactionDetailResponse>(`v1/transactions/${id}`);
}

export async function fetchApiKeys(): Promise<ApiKeysListResponse> {
  return clientFetch<ApiKeysListResponse>('v1/api-keys');
}

export async function createApiKey(body: {
  name: string;
  scopes?: string[];
}): Promise<CreatedApiKey> {
  return clientFetch<CreatedApiKey>('v1/api-keys', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function revokeApiKey(id: string): Promise<ApiKeyMetadata> {
  return clientFetch<ApiKeyMetadata>(`v1/api-keys/${id}`, { method: 'DELETE' });
}

export async function activateAgent(id: string): Promise<AgentResponse> {
  return clientFetch<AgentResponse>(`v1/agents/${id}/activate`, { method: 'POST' });
}

export async function deactivateAgent(id: string): Promise<AgentResponse> {
  return clientFetch<AgentResponse>(`v1/agents/${id}/deactivate`, { method: 'POST' });
}

export async function releaseEscrow(id: string): Promise<ReleaseEscrowResponse> {
  return clientFetch<ReleaseEscrowResponse>(`v1/transactions/${id}/release`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
