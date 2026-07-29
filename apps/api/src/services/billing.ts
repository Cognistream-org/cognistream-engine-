import type {
  Prisma,
  OrganizationTier,
  Subscription,
  UsageMeterType,
} from '@prisma/client';
import type { Redis } from 'ioredis';
import type Stripe from 'stripe';
import { PRICING_TIERS, type PricingTier } from '../config/pricing.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { getStripeClient } from '../lib/stripe.js';
import { createId } from '../lib/uuid.js';
import {
  currentBillingPeriod,
  getAllUsageCounters,
  getUsageCounter,
  hardLimitForTier,
  incrUsageCounter,
  popDirtyUsageMembers,
  softLimitFor,
  type BillingCycle,
  type UsageOperation,
} from '../lib/usage-counters.js';
import { getCircuitBreaker, resetCircuitBreakers } from '../resilience/circuit-breaker.js';
import { withRetry } from '../resilience/retry.js';
import { recordAudit } from '../security/audit-runtime.js';

export const BILLING_STRIPE_SERVICE = 'stripe';

const subscriptionSelect = {
  id: true,
  orgId: true,
  stripeSubscriptionId: true,
  stripeCustomerId: true,
  tier: true,
  status: true,
  trialEndsAt: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
  cancelAtPeriodEnd: true,
  canceledAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SubscriptionSelect;

export type SubscriptionRow = Prisma.SubscriptionGetPayload<{
  select: typeof subscriptionSelect;
}>;

export type BillingOptions = {
  requestId?: string;
  stripe?: Stripe;
  redis?: Redis;
  trialDays?: number;
  now?: () => Date;
};

export type LimitCheckResult = {
  allowed: boolean;
  reason?: string;
  currentUsage: number;
  limit: number;
  softWarning: boolean;
  overageQuantity: number;
  hardLimit: number;
};

export type UsageSummary = {
  orgId: string;
  billingPeriod: string;
  tier: OrganizationTier;
  meters: Record<UsageMeterType, { usage: number; limit: number; hardLimit: number }>;
};

export class BillingConflictError extends AppError {
  constructor(message: string, requestId = 'unknown') {
    super('BILLING_CONFLICT', message, 409, requestId);
    this.name = 'BillingConflictError';
  }
}

export class BillingNotFoundError extends AppError {
  constructor(message = 'Subscription not found', requestId = 'unknown') {
    super('BILLING_NOT_FOUND', message, 404, requestId);
    this.name = 'BillingNotFoundError';
  }
}

export class BillingStripeError extends AppError {
  constructor(message: string, requestId = 'unknown') {
    super('STRIPE_ERROR', message, 502, requestId);
    this.name = 'BillingStripeError';
  }
}

const OPERATION_LIMIT_KEY: Record<
  UsageOperation,
  keyof (typeof PRICING_TIERS)['free']['limits']
> = {
  api_calls: 'apiCallsPerMonth',
  transactions: 'transactionsPerMonth',
  transaction_volume_cents: 'transactionVolumeCentsPerMonth',
  agents: 'agents',
  webhooks: 'webhooks',
  disputes: 'disputesPerMonth',
};

function resolveStripe(options?: BillingOptions): Stripe {
  return options?.stripe ?? getStripeClient();
}

function resolveRedis(options?: BillingOptions): Redis {
  if (!options?.redis) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      'Redis is required for usage metering',
      500,
      options?.requestId ?? 'unknown',
    );
  }
  return options.redis;
}

function trialDaysFrom(options?: BillingOptions): number {
  if (typeof options?.trialDays === 'number') return options.trialDays;
  const raw = Number(process.env.TRIAL_DAYS ?? '14');
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : 14;
}

function nowFrom(options?: BillingOptions): Date {
  return options?.now?.() ?? new Date();
}

function isPricingTier(tier: string): tier is PricingTier {
  return tier in PRICING_TIERS;
}

function stripeRetryOptions() {
  return {
    maxAttempts: process.env.NODE_ENV === 'test' ? 3 : 6,
    backoffMs: process.env.NODE_ENV === 'test' ? ([1, 2, 4] as const) : undefined,
    shouldRetry: (error: unknown) => {
      if (error instanceof AppError && error.statusCode < 500) return false;
      return true;
    },
  };
}

async function callStripe<T>(fn: () => Promise<T>, requestId: string): Promise<T> {
  const breaker = getCircuitBreaker(BILLING_STRIPE_SERVICE, { failureThreshold: 5 });
  return withRetry(async () => breaker.execute(fn, requestId), stripeRetryOptions());
}


/**
 * Stripe API 2026+ exposes billing period on subscription items, not the root Subscription.
 * Prefer items; fall back to legacy root fields (mocks / older responses).
 */
function stripeSubscriptionPeriod(
  sub: Stripe.Subscription,
  fallbackCycle: BillingCycle = 'monthly',
  from = new Date(),
): { start: Date; end: Date } {
  const item = sub.items?.data?.[0];
  if (
    item &&
    typeof item.current_period_start === 'number' &&
    typeof item.current_period_end === 'number'
  ) {
    return {
      start: new Date(item.current_period_start * 1000),
      end: new Date(item.current_period_end * 1000),
    };
  }
  const legacy = sub as Stripe.Subscription & {
    current_period_start?: number;
    current_period_end?: number;
  };
  if (
    typeof legacy.current_period_start === 'number' &&
    typeof legacy.current_period_end === 'number'
  ) {
    return {
      start: new Date(legacy.current_period_start * 1000),
      end: new Date(legacy.current_period_end * 1000),
    };
  }
  return periodBounds(fallbackCycle, from);
}

function periodBounds(cycle: BillingCycle, from: Date): { start: Date; end: Date } {
  const start = new Date(from);
  const end = new Date(from);
  if (cycle === 'yearly') {
    end.setUTCFullYear(end.getUTCFullYear() + 1);
  } else {
    end.setUTCMonth(end.getUTCMonth() + 1);
  }
  return { start, end };
}

function unitAmountForTier(tier: PricingTier, cycle: BillingCycle): number {
  const config = PRICING_TIERS[tier];
  return cycle === 'yearly' ? config.yearlyPriceCents : config.monthlyPriceCents;
}

async function createStripePrice(
  stripe: Stripe,
  tier: PricingTier,
  cycle: BillingCycle,
  requestId: string,
): Promise<Stripe.Price> {
  const unitAmount = unitAmountForTier(tier, cycle);
  return callStripe(
    () =>
      stripe.prices.create({
        currency: 'usd',
        unit_amount: unitAmount,
        recurring: { interval: cycle === 'yearly' ? 'year' : 'month' },
        product_data: {
          name: `CogniStream ${PRICING_TIERS[tier].name}`,
          metadata: { tier, cycle },
        },
        metadata: { tier, cycle },
      }),
    requestId,
  );
}

/**
 * Create Stripe customer + subscription (paid) or free DB subscription.
 */
export async function createSubscription(
  orgId: string,
  tier: OrganizationTier,
  cycle: BillingCycle,
  options: BillingOptions = {},
): Promise<SubscriptionRow> {
  const requestId = options.requestId ?? 'unknown';
  if (!isPricingTier(tier)) {
    throw new AppError('VALIDATION_ERROR', `Unknown tier: ${tier}`, 422, requestId);
  }
  if (cycle !== 'monthly' && cycle !== 'yearly') {
    throw new AppError('VALIDATION_ERROR', 'cycle must be monthly or yearly', 422, requestId);
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, slug: true, tier: true },
  });
  if (!org) {
    throw new AppError('NOT_FOUND', 'Organization not found', 404, requestId);
  }

  const existing = await prisma.subscription.findUnique({
    where: { orgId },
    select: subscriptionSelect,
  });
  if (existing && existing.status !== 'canceled') {
    throw new BillingConflictError('Organization already has an active subscription', requestId);
  }

  const stripe = resolveStripe(options);
  const now = nowFrom(options);
  const trialDays = trialDaysFrom(options);
  const { start, end } = periodBounds(cycle, now);

  let customerId: string | null = existing?.stripeCustomerId ?? null;
  let stripeSubscriptionId: string | null = null;
  let status: Subscription['status'] = tier === 'free' ? 'active' : 'trialing';
  let trialEndsAt: Date | null = null;
  let periodStart = start;
  let periodEnd = end;

  try {
    if (!customerId) {
      const customer = await callStripe(
        () =>
          stripe.customers.create({
            name: org.name,
            metadata: { orgId, slug: org.slug },
          }),
        requestId,
      );
      customerId = customer.id;
    }

    if (tier !== 'free') {
      const price = await createStripePrice(stripe, tier, cycle, requestId);
      const stripeSub = await callStripe(
        () =>
          stripe.subscriptions.create({
            customer: customerId!,
            items: [{ price: price.id }],
            trial_period_days: trialDays > 0 ? trialDays : undefined,
            metadata: { orgId, tier, cycle },
            proration_behavior: 'create_prorations',
          }),
        requestId,
      );
      stripeSubscriptionId = stripeSub.id;
      status = stripeSub.status === 'trialing' ? 'trialing' : 'active';
      trialEndsAt = stripeSub.trial_end ? new Date(stripeSub.trial_end * 1000) : null;
      ({ start: periodStart, end: periodEnd } = stripeSubscriptionPeriod(stripeSub, cycle));
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : 'Stripe subscription failed';
    throw new BillingStripeError(message, requestId);
  }

  const data = {
    tier,
    status,
    stripeCustomerId: customerId,
    stripeSubscriptionId,
    trialEndsAt,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: false,
    canceledAt: null as Date | null,
  };

  const record = existing
    ? await prisma.subscription.update({
        where: { id: existing.id },
        data,
        select: subscriptionSelect,
      })
    : await prisma.subscription.create({
        data: {
          id: createId(),
          orgId,
          ...data,
        },
        select: subscriptionSelect,
      });

  await prisma.organization.update({
    where: { id: orgId },
    data: { tier },
    select: { id: true },
  });

  void recordAudit({
    orgId,
    action: 'billing.subscription_created',
    entityType: 'subscription',
    entityId: record.id,
    actorType: 'system',
    result: 'success',
    changes: { tier, cycle, status: record.status },
  });

  return record;
}

/**
 * Prorated upgrade/downgrade via Stripe (or free-tier local switch).
 */
export async function changeTier(
  orgId: string,
  newTier: OrganizationTier,
  options: BillingOptions & { cycle?: BillingCycle } = {},
): Promise<SubscriptionRow> {
  const requestId = options.requestId ?? 'unknown';
  if (!isPricingTier(newTier)) {
    throw new AppError('VALIDATION_ERROR', `Unknown tier: ${newTier}`, 422, requestId);
  }

  const subscription = await prisma.subscription.findUnique({
    where: { orgId },
    select: subscriptionSelect,
  });
  if (!subscription) {
    throw new BillingNotFoundError('Subscription not found', requestId);
  }
  if (subscription.tier === newTier) {
    return subscription;
  }

  const cycle = options.cycle ?? 'monthly';
  const stripe = resolveStripe(options);

  let stripeSubscriptionId = subscription.stripeSubscriptionId;
  let status = subscription.status;
  let periodStart = subscription.currentPeriodStart;
  let periodEnd = subscription.currentPeriodEnd;
  let trialEndsAt = subscription.trialEndsAt;
  let customerId = subscription.stripeCustomerId;

  try {
    if (newTier === 'free') {
      if (stripeSubscriptionId) {
        await callStripe(
          () =>
            stripe.subscriptions.cancel(stripeSubscriptionId!, {
              prorate: true,
            }),
          requestId,
        );
      }
      stripeSubscriptionId = null;
      status = 'active';
      trialEndsAt = null;
    } else if (!stripeSubscriptionId) {
      if (!customerId) {
        const org = await prisma.organization.findUnique({
          where: { id: orgId },
          select: { name: true, slug: true },
        });
        const customer = await callStripe(
          () =>
            stripe.customers.create({
              name: org?.name ?? orgId,
              metadata: { orgId, slug: org?.slug ?? '' },
            }),
          requestId,
        );
        customerId = customer.id;
      }
      const price = await createStripePrice(stripe, newTier, cycle, requestId);
      const stripeSub = await callStripe(
        () =>
          stripe.subscriptions.create({
            customer: customerId!,
            items: [{ price: price.id }],
            metadata: { orgId, tier: newTier, cycle },
          }),
        requestId,
      );
      stripeSubscriptionId = stripeSub.id;
      status = 'active';
      ({ start: periodStart, end: periodEnd } = stripeSubscriptionPeriod(stripeSub, cycle));
    } else {
      const stripeSub = await callStripe(
        () => stripe.subscriptions.retrieve(stripeSubscriptionId!),
        requestId,
      );
      const itemId = stripeSub.items.data[0]?.id;
      if (!itemId) {
        throw new BillingStripeError('Stripe subscription has no items', requestId);
      }
      const price = await createStripePrice(stripe, newTier, cycle, requestId);
      const updated = await callStripe(
        () =>
          stripe.subscriptions.update(stripeSubscriptionId!, {
            items: [{ id: itemId, price: price.id }],
            proration_behavior: 'create_prorations',
            metadata: { orgId, tier: newTier, cycle },
            cancel_at_period_end: false,
          }),
        requestId,
      );
      status = updated.status === 'trialing' ? 'trialing' : 'active';
      ({ start: periodStart, end: periodEnd } = stripeSubscriptionPeriod(updated, cycle));
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : 'Tier change failed';
    throw new BillingStripeError(message, requestId);
  }

  const previousTier = subscription.tier;
  const record = await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      tier: newTier,
      status,
      stripeCustomerId: customerId,
      stripeSubscriptionId,
      trialEndsAt,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      canceledAt: null,
    },
    select: subscriptionSelect,
  });

  await prisma.organization.update({
    where: { id: orgId },
    data: { tier: newTier },
    select: { id: true },
  });

  void recordAudit({
    orgId,
    action: 'billing.tier_changed',
    entityType: 'subscription',
    entityId: record.id,
    actorType: 'system',
    result: 'success',
    changes: { previousTier, newTier },
  });

  return record;
}

export async function cancelSubscription(
  orgId: string,
  options: BillingOptions = {},
): Promise<SubscriptionRow> {
  const requestId = options.requestId ?? 'unknown';
  const subscription = await prisma.subscription.findUnique({
    where: { orgId },
    select: subscriptionSelect,
  });
  if (!subscription) {
    throw new BillingNotFoundError('Subscription not found', requestId);
  }

  const stripe = resolveStripe(options);
  if (subscription.stripeSubscriptionId) {
    try {
      await callStripe(
        () =>
          stripe.subscriptions.update(subscription.stripeSubscriptionId!, {
            cancel_at_period_end: true,
          }),
        requestId,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      const message = error instanceof Error ? error.message : 'Cancel failed';
      throw new BillingStripeError(message, requestId);
    }
  }

  const record = await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      cancelAtPeriodEnd: true,
      canceledAt: nowFrom(options),
    },
    select: subscriptionSelect,
  });

  void recordAudit({
    orgId,
    action: 'billing.subscription_canceled',
    entityType: 'subscription',
    entityId: record.id,
    actorType: 'system',
    result: 'success',
    changes: { cancelAtPeriodEnd: true },
  });

  return record;
}

export async function resumeSubscription(
  orgId: string,
  options: BillingOptions = {},
): Promise<SubscriptionRow> {
  const requestId = options.requestId ?? 'unknown';
  const subscription = await prisma.subscription.findUnique({
    where: { orgId },
    select: subscriptionSelect,
  });
  if (!subscription) {
    throw new BillingNotFoundError('Subscription not found', requestId);
  }

  const stripe = resolveStripe(options);
  if (subscription.stripeSubscriptionId) {
    try {
      await callStripe(
        () =>
          stripe.subscriptions.update(subscription.stripeSubscriptionId!, {
            cancel_at_period_end: false,
          }),
        requestId,
      );
    } catch (error) {
      if (error instanceof AppError) throw error;
      const message = error instanceof Error ? error.message : 'Resume failed';
      throw new BillingStripeError(message, requestId);
    }
  }

  const record = await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      cancelAtPeriodEnd: false,
      canceledAt: null,
      status: subscription.status === 'canceled' ? 'active' : subscription.status,
    },
    select: subscriptionSelect,
  });

  void recordAudit({
    orgId,
    action: 'billing.subscription_resumed',
    entityType: 'subscription',
    entityId: record.id,
    actorType: 'system',
    result: 'success',
    changes: { cancelAtPeriodEnd: false },
  });

  return record;
}

export async function createPortalSession(
  orgId: string,
  returnUrl: string,
  options: BillingOptions = {},
): Promise<string> {
  const requestId = options.requestId ?? 'unknown';
  if (!/^https?:\/\//i.test(returnUrl)) {
    throw new AppError('VALIDATION_ERROR', 'returnUrl must be an absolute URL', 422, requestId);
  }

  const subscription = await prisma.subscription.findUnique({
    where: { orgId },
    select: { id: true, stripeCustomerId: true },
  });
  if (!subscription?.stripeCustomerId) {
    throw new BillingNotFoundError('Stripe customer not found for organization', requestId);
  }

  const stripe = resolveStripe(options);
  try {
    const session = await callStripe(
      () =>
        stripe.billingPortal.sessions.create({
          customer: subscription.stripeCustomerId!,
          return_url: returnUrl,
        }),
      requestId,
    );

    void recordAudit({
      orgId,
      action: 'billing.portal_session_created',
      entityType: 'subscription',
      entityId: subscription.id,
      actorType: 'system',
      result: 'success',
    });

    return session.url;
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : 'Portal session failed';
    throw new BillingStripeError(message, requestId);
  }
}

async function resolveTier(orgId: string): Promise<OrganizationTier> {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
      select: { tier: true },
    });
    if (subscription) return subscription.tier;
  } catch {
    // Subscription table may be unavailable during partial migrations; fall through.
  }

  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { tier: true },
    });
    return org?.tier ?? 'free';
  } catch {
    return 'free';
  }
}

export async function recordApiCall(
  orgId: string,
  options: BillingOptions = {},
): Promise<number> {
  const redis = resolveRedis(options);
  return incrUsageCounter(redis, orgId, 'api_calls', 1);
}

export async function recordTransaction(
  orgId: string,
  amountCents: bigint,
  txId: string,
  options: BillingOptions = {},
): Promise<{ transactions: number; volumeCents: number }> {
  if (amountCents < 0n) {
    throw new AppError(
      'VALIDATION_ERROR',
      'amountCents must be non-negative',
      422,
      options.requestId ?? 'unknown',
    );
  }
  if (amountCents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new AppError(
      'VALIDATION_ERROR',
      'amountCents exceeds safe integer range',
      422,
      options.requestId ?? 'unknown',
    );
  }

  const redis = resolveRedis(options);
  const volume = Number(amountCents);
  const transactions = await incrUsageCounter(redis, orgId, 'transactions', 1);
  const volumeCents =
    volume > 0
      ? await incrUsageCounter(redis, orgId, 'transaction_volume_cents', volume)
      : await getUsageCounter(redis, orgId, 'transaction_volume_cents');

  void persistUsageSnapshot(orgId, 'transactions', 1, amountCents, 'transaction', txId).catch(
    () => undefined,
  );

  return { transactions, volumeCents };
}

export async function recordAgentCreated(
  orgId: string,
  agentId: string,
  options: BillingOptions = {},
): Promise<number> {
  const redis = resolveRedis(options);
  const count = await incrUsageCounter(redis, orgId, 'agents', 1);
  void persistUsageSnapshot(orgId, 'agents', 1, null, 'agent', agentId).catch(() => undefined);
  return count;
}

export async function recordWebhookCreated(
  orgId: string,
  webhookId: string,
  options: BillingOptions = {},
): Promise<number> {
  const redis = resolveRedis(options);
  const count = await incrUsageCounter(redis, orgId, 'webhooks', 1);
  void persistUsageSnapshot(orgId, 'webhooks', 1, null, 'webhook', webhookId).catch(
    () => undefined,
  );
  return count;
}

export async function recordDisputeCreated(
  orgId: string,
  disputeId: string,
  options: BillingOptions = {},
): Promise<number> {
  const redis = resolveRedis(options);
  const count = await incrUsageCounter(redis, orgId, 'disputes', 1);
  void persistUsageSnapshot(orgId, 'disputes', 1, null, 'dispute', disputeId).catch(
    () => undefined,
  );
  return count;
}

async function persistUsageSnapshot(
  orgId: string,
  meterType: UsageMeterType,
  quantity: number,
  amountCents: bigint | null,
  source: string,
  sourceId: string | null,
): Promise<void> {
  const subscription = await prisma.subscription.findUnique({
    where: { orgId },
    select: { id: true },
  });
  if (!subscription) return;

  await prisma.usageRecord.create({
    data: {
      id: createId(),
      orgId,
      subscriptionId: subscription.id,
      meterType,
      quantity,
      amountCents: amountCents ?? undefined,
      billingPeriod: currentBillingPeriod(),
      source,
      sourceId: sourceId ?? undefined,
    },
    select: { id: true },
  });
}

export async function getUsageSummary(
  orgId: string,
  options: BillingOptions = {},
): Promise<UsageSummary> {
  const redis = resolveRedis(options);
  const tier = await resolveTier(orgId);
  const period = currentBillingPeriod(nowFrom(options));
  const usage = await getAllUsageCounters(redis, orgId, period);
  const limits = PRICING_TIERS[tier].limits;

  return {
    orgId,
    billingPeriod: period,
    tier,
    meters: {
      api_calls: {
        usage: usage.api_calls,
        limit: limits.apiCallsPerMonth,
        hardLimit: hardLimitForTier(limits.apiCallsPerMonth, tier),
      },
      transactions: {
        usage: usage.transactions,
        limit: limits.transactionsPerMonth,
        hardLimit: hardLimitForTier(limits.transactionsPerMonth, tier),
      },
      transaction_volume_cents: {
        usage: usage.transaction_volume_cents,
        limit: limits.transactionVolumeCentsPerMonth,
        hardLimit: hardLimitForTier(limits.transactionVolumeCentsPerMonth, tier),
      },
      agents: {
        usage: usage.agents,
        limit: limits.agents,
        hardLimit: hardLimitForTier(limits.agents, tier),
      },
      webhooks: {
        usage: usage.webhooks,
        limit: limits.webhooks,
        hardLimit: hardLimitForTier(limits.webhooks, tier),
      },
      disputes: {
        usage: usage.disputes,
        limit: limits.disputesPerMonth,
        hardLimit: hardLimitForTier(limits.disputesPerMonth, tier),
      },
    },
  };
}

/**
 * Soft limit at 80%. Free hard-stops at 100%. Paid allows overage to 120% then hard-stops.
 */
export async function checkLimits(
  orgId: string,
  operation: UsageOperation,
  options: BillingOptions = {},
): Promise<LimitCheckResult> {
  const redis = resolveRedis(options);
  const tier = await resolveTier(orgId);
  const limitKey = OPERATION_LIMIT_KEY[operation];
  const limit = PRICING_TIERS[tier].limits[limitKey];
  const hardLimit = hardLimitForTier(limit, tier);
  const soft = softLimitFor(limit);
  const currentUsage = await getUsageCounter(
    redis,
    orgId,
    operation,
    currentBillingPeriod(nowFrom(options)),
  );

  const overageQuantity = Math.max(0, currentUsage - limit);
  const softWarning = currentUsage >= soft && currentUsage < hardLimit;
  const allowed = currentUsage < hardLimit;

  let reason: string | undefined;
  if (!allowed) {
    reason = `Quota exceeded for ${operation} (usage ${currentUsage} >= hard limit ${hardLimit})`;
  } else if (overageQuantity > 0) {
    reason =
      tier === 'free'
        ? undefined
        : `Overage for ${operation}: ${overageQuantity} units billable`;
  } else if (softWarning) {
    reason = `Approaching ${operation} quota (${currentUsage}/${limit})`;
  }

  return {
    allowed,
    reason,
    currentUsage,
    limit,
    softWarning,
    overageQuantity: tier === 'free' ? 0 : overageQuantity,
    hardLimit,
  };
}

/**
 * Flush dirty Redis usage counters into UsageRecord rows (background job).
 */
export async function flushUsageToDatabase(
  redis: Redis,
  limit = 50,
): Promise<number> {
  const dirty = await popDirtyUsageMembers(redis, limit);
  let written = 0;

  for (const { orgId, period } of dirty) {
    const subscription = await prisma.subscription.findUnique({
      where: { orgId },
      select: { id: true },
    });
    if (!subscription) continue;

    const usage = await getAllUsageCounters(redis, orgId, period);
    for (const [meterType, quantity] of Object.entries(usage) as Array<
      [UsageMeterType, number]
    >) {
      if (quantity <= 0) continue;
      await prisma.usageRecord.create({
        data: {
          id: createId(),
          orgId,
          subscriptionId: subscription.id,
          meterType,
          quantity,
          amountCents:
            meterType === 'transaction_volume_cents' ? BigInt(quantity) : undefined,
          billingPeriod: period,
          source: 'redis_flush',
          sourceId: null,
        },
        select: { id: true },
      });
      written += 1;
    }
  }

  return written;
}

export async function getSubscription(
  orgId: string,
  _options: BillingOptions = {},
): Promise<SubscriptionRow | null> {
  return prisma.subscription.findUnique({
    where: { orgId },
    select: subscriptionSelect,
  });
}

export async function getBillingProfile(
  orgId: string,
  options: BillingOptions = {},
): Promise<{
  organization: {
    id: string;
    name: string;
    slug: string;
    tier: OrganizationTier;
    balanceCents: bigint;
  };
  subscription: SubscriptionRow | null;
  pricing: (typeof PRICING_TIERS)[PricingTier];
}> {
  const requestId = options.requestId ?? 'unknown';
  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, slug: true, tier: true, balanceCents: true },
  });
  if (!org) {
    throw new AppError('NOT_FOUND', 'Organization not found', 404, requestId);
  }
  const subscription = await getSubscription(orgId, options);
  const tier = (subscription?.tier ?? org.tier) as PricingTier;
  return {
    organization: org,
    subscription,
    pricing: PRICING_TIERS[tier],
  };
}

/**
 * Stripe Hosted Checkout for paid tiers (no custom payment forms).
 */
export async function createCheckoutSession(
  orgId: string,
  tier: OrganizationTier,
  cycle: BillingCycle,
  successUrl: string,
  cancelUrl: string,
  options: BillingOptions = {},
): Promise<{ url: string; sessionId: string }> {
  const requestId = options.requestId ?? 'unknown';
  if (tier === 'free') {
    throw new AppError(
      'VALIDATION_ERROR',
      'Checkout is only available for paid tiers',
      422,
      requestId,
    );
  }
  if (!(tier in PRICING_TIERS)) {
    throw new AppError('VALIDATION_ERROR', `Unknown tier: ${tier}`, 422, requestId);
  }

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true, slug: true },
  });
  if (!org) {
    throw new AppError('NOT_FOUND', 'Organization not found', 404, requestId);
  }

  const existing = await prisma.subscription.findUnique({
    where: { orgId },
    select: { stripeCustomerId: true },
  });

  const stripe = resolveStripe(options);
  let customerId = existing?.stripeCustomerId ?? null;

  try {
    if (!customerId) {
      const customer = await callStripe(
        () =>
          stripe.customers.create({
            name: org.name,
            metadata: { orgId, slug: org.slug },
          }),
        requestId,
      );
      customerId = customer.id;
      if (existing) {
        await prisma.subscription.update({
          where: { orgId },
          data: { stripeCustomerId: customerId },
          select: { id: true },
        });
      }
    }

    const unitAmount =
      cycle === 'yearly'
        ? PRICING_TIERS[tier as PricingTier].yearlyPriceCents
        : PRICING_TIERS[tier as PricingTier].monthlyPriceCents;

    const session = await callStripe(
      () =>
        stripe.checkout.sessions.create({
          mode: 'subscription',
          customer: customerId!,
          success_url: successUrl,
          cancel_url: cancelUrl,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: 'usd',
                unit_amount: unitAmount,
                recurring: { interval: cycle === 'yearly' ? 'year' : 'month' },
                product_data: {
                  name: `CogniStream ${PRICING_TIERS[tier as PricingTier].name}`,
                  metadata: { tier, cycle },
                },
              },
            },
          ],
          metadata: { orgId, tier, cycle },
          subscription_data: {
            metadata: { orgId, tier, cycle },
          },
        }),
      requestId,
    );

    if (!session.url) {
      throw new BillingStripeError('Checkout session missing URL', requestId);
    }

    void recordAudit({
      orgId,
      action: 'billing.checkout_created',
      entityType: 'organization',
      entityId: orgId,
      actorType: 'system',
      result: 'success',
      changes: { tier, cycle, sessionId: session.id },
    });

    return { url: session.url, sessionId: session.id };
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message = error instanceof Error ? error.message : 'Checkout session failed';
    throw new BillingStripeError(message, requestId);
  }
}

export async function listInvoices(
  orgId: string,
  query: { page: number; limit: number },
): Promise<{
  items: Array<{
    id: string;
    orgId: string;
    subscriptionId: string | null;
    stripeInvoiceId: string | null;
    invoiceNumber: string;
    status: string;
    amountDueCents: bigint;
    amountPaidCents: bigint;
    currency: string;
    pdfUrl: string | null;
    hostedUrl: string | null;
    dueDate: Date | null;
    paidAt: Date | null;
    lineItems: unknown;
    createdAt: Date;
    updatedAt: Date;
  }>;
  total: number;
  page: number;
  limit: number;
}> {
  const where = { orgId };
  const [total, items] = await prisma.$transaction([
    prisma.invoice.count({ where }),
    prisma.invoice.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        orgId: true,
        subscriptionId: true,
        stripeInvoiceId: true,
        invoiceNumber: true,
        status: true,
        amountDueCents: true,
        amountPaidCents: true,
        currency: true,
        pdfUrl: true,
        hostedUrl: true,
        dueDate: true,
        paidAt: true,
        lineItems: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);
  return { items, total, page: query.page, limit: query.limit };
}

export async function getInvoice(
  orgId: string,
  invoiceId: string,
  requestId = 'unknown',
): Promise<{
  id: string;
  orgId: string;
  subscriptionId: string | null;
  stripeInvoiceId: string | null;
  invoiceNumber: string;
  status: string;
  amountDueCents: bigint;
  amountPaidCents: bigint;
  currency: string;
  pdfUrl: string | null;
  hostedUrl: string | null;
  dueDate: Date | null;
  paidAt: Date | null;
  lineItems: unknown;
  createdAt: Date;
  updatedAt: Date;
}> {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, orgId },
    select: {
      id: true,
      orgId: true,
      subscriptionId: true,
      stripeInvoiceId: true,
      invoiceNumber: true,
      status: true,
      amountDueCents: true,
      amountPaidCents: true,
      currency: true,
      pdfUrl: true,
      hostedUrl: true,
      dueDate: true,
      paidAt: true,
      lineItems: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  if (!invoice) {
    throw new BillingNotFoundError('Invoice not found', requestId);
  }
  return invoice;
}

export async function getLimits(
  orgId: string,
  options: BillingOptions = {},
): Promise<{
  tier: OrganizationTier;
  limits: (typeof PRICING_TIERS)[PricingTier]['limits'];
  usage: UsageSummary['meters'];
  softLimitRatio: number;
  hardLimitRatio: number;
}> {
  const summary = await getUsageSummary(orgId, options);
  return {
    tier: summary.tier,
    limits: PRICING_TIERS[summary.tier].limits,
    usage: summary.meters,
    softLimitRatio: 0.8,
    hardLimitRatio: summary.tier === 'free' ? 1.0 : 1.2,
  };
}

export function resetBillingBreakers(): void {
  resetCircuitBreakers();
}
