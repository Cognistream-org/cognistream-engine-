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

export type OrganizationTier = 'free' | 'developer' | 'enterprise';
export type BillingCycle = 'monthly' | 'yearly';

export type Subscription = {
  id: string;
  orgId: string;
  tier: OrganizationTier;
  status: string;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  trialEndsAt: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Invoice = {
  id: string;
  orgId: string;
  subscriptionId: string | null;
  stripeInvoiceId: string | null;
  invoiceNumber: string;
  status: string;
  amountDueCents: string;
  amountPaidCents: string;
  currency: string;
  pdfUrl: string | null;
  hostedUrl: string | null;
  dueDate: string | null;
  paidAt: string | null;
  lineItems: unknown;
  createdAt: string;
  updatedAt: string;
};

export type BillingPricing = {
  name: string;
  monthlyPriceCents: number;
  yearlyPriceCents: number;
  limits: Record<string, number>;
  features: Record<string, boolean>;
  platformFeeBasisPoints: number;
  overage: { apiCallCents: number; transactionCents: number } | null;
};

export type BillingProfile = {
  organization: {
    id: string;
    name: string;
    slug: string;
    tier: OrganizationTier;
    balanceCents: string;
  };
  subscription: Subscription | null;
  pricing: BillingPricing;
};

export type CheckoutParams = {
  tier: Exclude<OrganizationTier, 'free'>;
  cycle?: BillingCycle;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey?: string;
};

export type CheckoutSession = {
  url: string;
  sessionId: string;
};

export type PortalParams = {
  returnUrl: string;
};

export type ChangeTierParams = {
  tier: OrganizationTier;
  cycle?: BillingCycle;
  idempotencyKey?: string;
};

export type UsageMeter = {
  usage: number;
  limit: number;
  hardLimit: number;
};

export type UsageSummary = {
  orgId: string;
  billingPeriod: string;
  tier: OrganizationTier;
  meters: Record<string, UsageMeter>;
};

export type BillingLimits = {
  tier: OrganizationTier;
  limits: Record<string, number>;
  usage: Record<string, UsageMeter>;
  softLimitRatio: number;
  hardLimitRatio: number;
};

export type InvoiceFilters = {
  page?: number;
  limit?: number;
};

export type StripeConnectAccount = {
  id: string;
  orgId: string;
  stripeAccountId: string;
  status: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  onboardingUrl: string | null;
  onboardingUrlExpiresAt: string | null;
  defaultCurrency: string;
  country: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateConnectAccountParams = {
  country: string;
  idempotencyKey?: string;
};

export type ConnectOnboardingParams = {
  returnUrl: string;
  refreshUrl: string;
  idempotencyKey?: string;
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
