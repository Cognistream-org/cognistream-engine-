export type Paginated<T> = {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

export type AgentStatus = 'active' | 'inactive' | 'suspended';

export type Agent = {
  id: string;
  orgId: string;
  name: string;
  publicKey: string;
  capabilities: string[];
  pricingModel: string | null;
  unitPriceCents: string | null;
  reputationScore: string;
  status: AgentStatus;
  createdAt: string;
  updatedAt: string;
};

export type CreateAgentParams = {
  name: string;
  publicKey: string;
  capabilities?: string[];
  pricingModel?: string;
  unitPriceCents?: number;
};

export type AgentFilters = {
  capability?: string;
  status?: AgentStatus;
  page?: number;
  limit?: number;
};

export type TransactionStatus =
  | 'pending'
  | 'escrowed'
  | 'settled'
  | 'disputed'
  | 'refunded'
  | 'failed';

export type Escrow = {
  id: string;
  transactionId: string;
  amountCents: string;
  expiresAt: string;
  released: boolean;
  releasedAt: string | null;
};

export type TransactionAgentSummary = {
  id: string;
  orgId: string;
  name: string;
  publicKey: string;
  reputationScore: string;
  status: string;
};

export type Transaction = {
  id: string;
  buyerId: string;
  sellerId: string;
  amountCents: string;
  feeCents: string;
  description: string | null;
  metadata: unknown;
  status: TransactionStatus;
  idempotencyKey: string | null;
  createdAt: string;
  settledAt: string | null;
  escrow?: Escrow | null;
  buyer?: TransactionAgentSummary;
  seller?: TransactionAgentSummary;
};

export type CreateTransactionParams = {
  sellerId: string;
  amountCents: number;
  description?: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  /** Buyer agent ID sent as X-Agent-Id */
  agentId: string;
};

export type ReleaseParams = {
  rating?: 1 | 2 | 3 | 4 | 5;
  review?: string;
};

export type TransactionFilters = {
  buyerId?: string;
  sellerId?: string;
  status?: TransactionStatus;
  page?: number;
  limit?: number;
};

export type DisputeStatus =
  | 'open'
  | 'under_review'
  | 'resolved_buyer'
  | 'resolved_seller'
  | 'closed';

export type Dispute = {
  id: string;
  transactionId: string;
  raisedById: string;
  reason: string;
  status: DisputeStatus;
  resolution: string | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type DisputeFilters = {
  status?: DisputeStatus;
  page?: number;
  limit?: number;
};

export type StreamEvent =
  | 'transaction.created'
  | 'transaction.settled'
  | 'escrow.expired'
  | 'dispute.created'
  | 'dispute.resolved'
  | 'connected';

export type ClientOptions = {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  /** Default buyer/actor agent for dispute flows */
  agentId?: string;
};
