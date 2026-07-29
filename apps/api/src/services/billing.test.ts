import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import { PRICING_TIERS } from '../config/pricing.js';
import { currentBillingPeriod } from '../lib/usage-counters.js';

const customersCreate = vi.fn();
const pricesCreate = vi.fn();
const subscriptionsCreate = vi.fn();
const subscriptionsUpdate = vi.fn();
const subscriptionsRetrieve = vi.fn();
const subscriptionsCancel = vi.fn();
const portalCreate = vi.fn();

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    subscription: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    usageRecord: {
      create: vi.fn(),
    },
  },
}));

vi.mock('../lib/stripe.js', () => ({
  getStripeClient: vi.fn(() => ({
    customers: { create: customersCreate },
    prices: { create: pricesCreate },
    subscriptions: {
      create: subscriptionsCreate,
      update: subscriptionsUpdate,
      retrieve: subscriptionsRetrieve,
      cancel: subscriptionsCancel,
    },
    billingPortal: { sessions: { create: portalCreate } },
  })),
}));

vi.mock('../security/audit-runtime.js', () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/uuid.js', () => ({
  createId: vi.fn(() => '01900000-0000-7000-8000-000000000099'),
}));

import { prisma } from '../lib/prisma.js';
import { recordAudit } from '../security/audit-runtime.js';
import {
  BillingConflictError,
  BillingNotFoundError,
  BillingStripeError,
  cancelSubscription,
  changeTier,
  checkLimits,
  createPortalSession,
  createSubscription,
  flushUsageToDatabase,
  getUsageSummary,
  recordApiCall,
  recordTransaction,
  recordAgentCreated,
  recordWebhookCreated,
  recordDisputeCreated,
  resetBillingBreakers,
  resumeSubscription,
} from './billing.js';
import { AppError } from '../lib/errors.js';

function createMemoryRedis() {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const redis = {
    status: 'ready' as const,
    connect: vi.fn(async () => undefined),
    incrby: vi.fn(async (key: string, by: number) => {
      const next = (Number.parseInt(store.get(key) ?? '0', 10) || 0) + by;
      store.set(key, String(next));
      return next;
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    expire: vi.fn(async () => 1),
    sadd: vi.fn(async (key: string, member: string) => {
      const set = sets.get(key) ?? new Set<string>();
      set.add(member);
      sets.set(key, set);
      return 1;
    }),
    spop: vi.fn(async (key: string) => {
      const set = sets.get(key);
      if (!set || set.size === 0) return null;
      const value = set.values().next().value as string;
      set.delete(value);
      return value;
    }),
  };
  return { redis: redis as unknown as Redis, store, sets };
}

const orgId = '01900000-0000-7000-8000-0000000000aa';
const subscriptionId = '01900000-0000-7000-8000-000000000099';

const baseSubscription = {
  id: subscriptionId,
  orgId,
  stripeSubscriptionId: 'sub_123',
  stripeCustomerId: 'cus_123',
  tier: 'developer' as const,
  status: 'active' as const,
  trialEndsAt: null,
  currentPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
  currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
  cancelAtPeriodEnd: false,
  canceledAt: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-01T00:00:00.000Z'),
};

describe('billing service — subscriptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBillingBreakers();
    customersCreate.mockResolvedValue({ id: 'cus_123' });
    pricesCreate.mockResolvedValue({ id: 'price_123' });
    subscriptionsCreate.mockResolvedValue({
      id: 'sub_123',
      status: 'trialing',
      trial_end: Math.floor(Date.now() / 1000) + 86400,
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    });
  });

  it('createSubscription creates Stripe customer + subscription for paid tier', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: orgId,
      name: 'Acme',
      slug: 'acme',
      tier: 'free',
    } as never);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.subscription.create).mockResolvedValue({
      ...baseSubscription,
      status: 'trialing',
    } as never);
    vi.mocked(prisma.organization.update).mockResolvedValue({ id: orgId } as never);

    const result = await createSubscription(orgId, 'developer', 'monthly');
    expect(result.stripeSubscriptionId).toBe('sub_123');
    expect(customersCreate).toHaveBeenCalled();
    expect(subscriptionsCreate).toHaveBeenCalled();
    expect(prisma.organization.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { tier: 'developer' } }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.subscription_created' }),
    );
  });

  it('createSubscription free tier skips Stripe subscription', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: orgId,
      name: 'Acme',
      slug: 'acme',
      tier: 'free',
    } as never);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.subscription.create).mockResolvedValue({
      ...baseSubscription,
      tier: 'free',
      stripeSubscriptionId: null,
      status: 'active',
    } as never);
    vi.mocked(prisma.organization.update).mockResolvedValue({ id: orgId } as never);

    await createSubscription(orgId, 'free', 'monthly');
    expect(customersCreate).toHaveBeenCalled();
    expect(subscriptionsCreate).not.toHaveBeenCalled();
  });

  it('createSubscription rejects duplicate active subscription', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: orgId,
      name: 'Acme',
      slug: 'acme',
      tier: 'free',
    } as never);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(baseSubscription as never);

    await expect(createSubscription(orgId, 'developer', 'monthly')).rejects.toBeInstanceOf(
      BillingConflictError,
    );
  });

  it('changeTier upgrades with proration', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(baseSubscription as never);
    subscriptionsRetrieve.mockResolvedValue({
      items: { data: [{ id: 'si_1' }] },
    });
    subscriptionsUpdate.mockResolvedValue({
      status: 'active',
      current_period_start: Math.floor(Date.now() / 1000),
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
    });
    vi.mocked(prisma.subscription.update).mockResolvedValue({
      ...baseSubscription,
      tier: 'enterprise',
    } as never);
    vi.mocked(prisma.organization.update).mockResolvedValue({ id: orgId } as never);

    const result = await changeTier(orgId, 'enterprise');
    expect(result.tier).toBe('enterprise');
    expect(subscriptionsUpdate).toHaveBeenCalledWith(
      'sub_123',
      expect.objectContaining({
        proration_behavior: 'create_prorations',
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.tier_changed' }),
    );
  });

  it('changeTier downgrades to free and cancels Stripe sub', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(baseSubscription as never);
    subscriptionsCancel.mockResolvedValue({ id: 'sub_123', status: 'canceled' });
    vi.mocked(prisma.subscription.update).mockResolvedValue({
      ...baseSubscription,
      tier: 'free',
      stripeSubscriptionId: null,
    } as never);
    vi.mocked(prisma.organization.update).mockResolvedValue({ id: orgId } as never);

    await changeTier(orgId, 'free');
    expect(subscriptionsCancel).toHaveBeenCalled();
  });

  it('cancelSubscription sets cancel_at_period_end', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(baseSubscription as never);
    subscriptionsUpdate.mockResolvedValue({ id: 'sub_123' });
    vi.mocked(prisma.subscription.update).mockResolvedValue({
      ...baseSubscription,
      cancelAtPeriodEnd: true,
    } as never);

    const result = await cancelSubscription(orgId);
    expect(result.cancelAtPeriodEnd).toBe(true);
    expect(subscriptionsUpdate).toHaveBeenCalledWith(
      'sub_123',
      expect.objectContaining({ cancel_at_period_end: true }),
    );
  });

  it('resumeSubscription clears cancel_at_period_end', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      ...baseSubscription,
      cancelAtPeriodEnd: true,
    } as never);
    subscriptionsUpdate.mockResolvedValue({ id: 'sub_123' });
    vi.mocked(prisma.subscription.update).mockResolvedValue({
      ...baseSubscription,
      cancelAtPeriodEnd: false,
    } as never);

    const result = await resumeSubscription(orgId);
    expect(result.cancelAtPeriodEnd).toBe(false);
    expect(subscriptionsUpdate).toHaveBeenCalledWith(
      'sub_123',
      expect.objectContaining({ cancel_at_period_end: false }),
    );
  });

  it('createPortalSession returns Stripe portal URL', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: subscriptionId,
      stripeCustomerId: 'cus_123',
    } as never);
    portalCreate.mockResolvedValue({ url: 'https://billing.stripe.com/session/test' });

    const url = await createPortalSession(orgId, 'https://app.example/billing');
    expect(url).toBe('https://billing.stripe.com/session/test');
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'billing.portal_session_created' }),
    );
  });

  it('createPortalSession requires customer', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: subscriptionId,
      stripeCustomerId: null,
    } as never);
    await expect(
      createPortalSession(orgId, 'https://app.example/billing'),
    ).rejects.toBeInstanceOf(BillingNotFoundError);
  });

  it('wraps Stripe errors', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: orgId,
      name: 'Acme',
      slug: 'acme',
      tier: 'free',
    } as never);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);
    customersCreate.mockRejectedValue(new Error('stripe boom'));

    await expect(createSubscription(orgId, 'developer', 'monthly')).rejects.toBeInstanceOf(
      BillingStripeError,
    );
  });
});

describe('billing service — usage + limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBillingBreakers();
  });

  it('records api calls and transactions in Redis', async () => {
    const { redis, store } = createMemoryRedis();
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ id: subscriptionId } as never);
    vi.mocked(prisma.usageRecord.create).mockResolvedValue({ id: 'ur_1' } as never);

    await recordApiCall(orgId, { redis });
    const period = Object.keys([...store.keys()] as string[]) && currentBillingPeriod();
    expect(await recordApiCall(orgId, { redis })).toBeGreaterThan(0);

    const tx = await recordTransaction(orgId, 2_500n, 'tx-1', { redis });
    expect(tx.transactions).toBeGreaterThan(0);
    expect(tx.volumeCents).toBeGreaterThanOrEqual(2500);
    expect(store.size).toBeGreaterThan(0);
    expect(period).toMatch(/^\d{4}-\d{2}$/);
  });

  it('recordAgentCreated increments agents meter', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ id: subscriptionId } as never);
    vi.mocked(prisma.usageRecord.create).mockResolvedValue({ id: 'ur_1' } as never);
    await expect(recordAgentCreated(orgId, 'agent-1', { redis })).resolves.toBe(1);
  });

  it('getUsageSummary returns per-meter usage and limits', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: subscriptionId,
      tier: 'free',
    } as never);
    await recordApiCall(orgId, { redis });
    await recordApiCall(orgId, { redis });

    const summary = await getUsageSummary(orgId, { redis });
    expect(summary.tier).toBe('free');
    expect(summary.meters.api_calls.usage).toBe(2);
    expect(summary.meters.api_calls.limit).toBe(PRICING_TIERS.free.limits.apiCallsPerMonth);
  });

  it('checkLimits soft-warns at 80% and hard-stops free at 100%', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      tier: 'free',
    } as never);

    const limit = PRICING_TIERS.free.limits.apiCallsPerMonth;
    const soft = Math.floor(limit * 0.8);
    for (let i = 0; i < soft; i += 1) {
      await recordApiCall(orgId, { redis });
    }

    const softResult = await checkLimits(orgId, 'api_calls', { redis });
    expect(softResult.softWarning).toBe(true);
    expect(softResult.allowed).toBe(true);

    for (let i = soft; i < limit; i += 1) {
      await recordApiCall(orgId, { redis });
    }
    const hard = await checkLimits(orgId, 'api_calls', { redis });
    expect(hard.allowed).toBe(false);
    expect(hard.hardLimit).toBe(limit);
  });

  it('checkLimits allows paid overage up to 120% then hard-stops', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      tier: 'developer',
    } as never);

    const limit = PRICING_TIERS.developer.limits.transactionsPerMonth;
    const hardLimit = Math.floor(limit * 1.2);

    // Jump via incrby mock by writing directly
    const key = `usage:${orgId}:${currentBillingPeriod()}:transactions`;
    await redis.incrby(key, limit + 10);
    const overage = await checkLimits(orgId, 'transactions', { redis });
    expect(overage.allowed).toBe(true);
    expect(overage.overageQuantity).toBe(10);

    await redis.incrby(key, hardLimit - (limit + 10));
    const blocked = await checkLimits(orgId, 'transactions', { redis });
    expect(blocked.allowed).toBe(false);
    expect(blocked.hardLimit).toBe(hardLimit);
  });

  it('checkLimits covers all meter operations for enterprise', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      tier: 'enterprise',
    } as never);

    for (const operation of [
      'api_calls',
      'transactions',
      'transaction_volume_cents',
      'agents',
      'webhooks',
      'disputes',
    ] as const) {
      const result = await checkLimits(orgId, operation, { redis });
      expect(result.allowed).toBe(true);
      expect(result.limit).toBeGreaterThan(0);
    }
  });

  it('flushUsageToDatabase writes UsageRecord rows for dirty orgs', async () => {
    const { redis, sets } = createMemoryRedis();
    sets.set('usage:dirty', new Set([`${orgId}:${currentBillingPeriod()}`]));
    await redis.incrby(`usage:${orgId}:${currentBillingPeriod()}:api_calls`, 5);

    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ id: subscriptionId } as never);
    vi.mocked(prisma.usageRecord.create).mockResolvedValue({ id: 'ur_1' } as never);

    const written = await flushUsageToDatabase(redis, 10);
    expect(written).toBeGreaterThan(0);
    expect(prisma.usageRecord.create).toHaveBeenCalled();
  });
});

describe('billing service — coverage gaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBillingBreakers();
    customersCreate.mockResolvedValue({ id: 'cus_new' });
    pricesCreate.mockResolvedValue({ id: 'price_new' });
    subscriptionsCreate.mockResolvedValue({
      id: 'sub_new',
      status: 'active',
      trial_end: null,
      items: {
        data: [
          {
            id: 'si_period',
            current_period_start: 1_700_000_000,
            current_period_end: 1_700_086_400,
          },
        ],
      },
    });
  });

  it('should reject createSubscription with unknown tier', async () => {
    await expect(
      createSubscription(orgId, 'gold' as never, 'monthly'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('should reject createSubscription with invalid cycle', async () => {
    await expect(
      createSubscription(orgId, 'developer', 'weekly' as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('should reject createSubscription when organization is missing', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);
    await expect(createSubscription(orgId, 'developer', 'monthly')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('should recreate subscription from canceled row and reuse Stripe customer', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: orgId,
      name: 'Acme',
      slug: 'acme',
      tier: 'free',
    } as never);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      ...baseSubscription,
      status: 'canceled',
      stripeSubscriptionId: null,
    } as never);
    vi.mocked(prisma.subscription.update).mockResolvedValue({
      ...baseSubscription,
      status: 'active',
      tier: 'developer',
    } as never);
    vi.mocked(prisma.organization.update).mockResolvedValue({ id: orgId } as never);

    await createSubscription(orgId, 'developer', 'yearly', { trialDays: 0 });
    expect(customersCreate).not.toHaveBeenCalled();
    expect(pricesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        unit_amount: PRICING_TIERS.developer.yearlyPriceCents,
        recurring: { interval: 'year' },
      }),
    );
    expect(prisma.subscription.update).toHaveBeenCalled();
  });

  it('should use Stripe item period bounds when present on create', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: orgId,
      name: 'Acme',
      slug: 'acme',
      tier: 'free',
    } as never);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.subscription.create).mockImplementation((async ({ data }: { data: unknown }) => {
      expect((data as { currentPeriodStart: Date }).currentPeriodStart).toEqual(
        new Date(1_700_000_000 * 1000),
      );
      return { ...baseSubscription, ...(data as object) };
    }) as never);
    vi.mocked(prisma.organization.update).mockResolvedValue({ id: orgId } as never);

    await createSubscription(orgId, 'developer', 'monthly');
    expect(prisma.subscription.create).toHaveBeenCalled();
  });

  it('should fall back to yearly periodBounds when Stripe omits period fields', async () => {
    subscriptionsCreate.mockResolvedValue({
      id: 'sub_nop',
      status: 'active',
      trial_end: null,
      items: { data: [{ id: 'si_1' }] },
    });
    const fixedNow = new Date('2026-01-15T00:00:00.000Z');
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: orgId,
      name: 'Acme',
      slug: 'acme',
      tier: 'free',
    } as never);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.subscription.create).mockImplementation((async ({ data }: { data: unknown }) => {
      const end = (data as { currentPeriodEnd: Date }).currentPeriodEnd;
      expect(end.getUTCFullYear()).toBe(2027);
      return { ...baseSubscription, ...(data as object) };
    }) as never);
    vi.mocked(prisma.organization.update).mockResolvedValue({ id: orgId } as never);

    await createSubscription(orgId, 'enterprise', 'yearly', { now: () => fixedNow });
  });

  it('should return early from changeTier when tier is unchanged', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(baseSubscription as never);
    const result = await changeTier(orgId, 'developer');
    expect(result).toEqual(baseSubscription);
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('should reject changeTier for unknown tier and missing subscription', async () => {
    await expect(changeTier(orgId, 'gold' as never)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);
    await expect(changeTier(orgId, 'enterprise')).rejects.toBeInstanceOf(BillingNotFoundError);
  });

  it('should upgrade free subscription without Stripe id by creating customer and sub', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      ...baseSubscription,
      tier: 'free',
      stripeSubscriptionId: null,
      stripeCustomerId: null,
    } as never);
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      name: 'Acme',
      slug: 'acme',
    } as never);
    vi.mocked(prisma.subscription.update).mockResolvedValue({
      ...baseSubscription,
      tier: 'developer',
      stripeSubscriptionId: 'sub_new',
    } as never);
    vi.mocked(prisma.organization.update).mockResolvedValue({ id: orgId } as never);

    const result = await changeTier(orgId, 'developer');
    expect(customersCreate).toHaveBeenCalled();
    expect(subscriptionsCreate).toHaveBeenCalled();
    expect(result.tier).toBe('developer');
  });

  it('should reject changeTier when Stripe subscription has no items', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(baseSubscription as never);
    subscriptionsRetrieve.mockResolvedValue({ items: { data: [] } });

    await expect(changeTier(orgId, 'enterprise')).rejects.toBeInstanceOf(BillingStripeError);
  });

  it('should wrap unexpected Stripe errors from changeTier', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(baseSubscription as never);
    subscriptionsRetrieve.mockRejectedValue(new Error('network'));

    await expect(changeTier(orgId, 'enterprise')).rejects.toBeInstanceOf(BillingStripeError);
  });

  it('should reject cancelSubscription when subscription missing', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);
    await expect(cancelSubscription(orgId)).rejects.toBeInstanceOf(BillingNotFoundError);
  });

  it('should wrap Stripe errors from cancelSubscription', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(baseSubscription as never);
    subscriptionsUpdate.mockRejectedValue(new Error('cancel failed'));
    await expect(cancelSubscription(orgId)).rejects.toBeInstanceOf(BillingStripeError);
  });

  it('should cancel locally when there is no Stripe subscription id', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      ...baseSubscription,
      stripeSubscriptionId: null,
    } as never);
    vi.mocked(prisma.subscription.update).mockResolvedValue({
      ...baseSubscription,
      cancelAtPeriodEnd: true,
      stripeSubscriptionId: null,
    } as never);

    const result = await cancelSubscription(orgId);
    expect(result.cancelAtPeriodEnd).toBe(true);
    expect(subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('should reject resumeSubscription when subscription missing', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(null);
    await expect(resumeSubscription(orgId)).rejects.toBeInstanceOf(BillingNotFoundError);
  });

  it('should wrap Stripe errors from resumeSubscription', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue(baseSubscription as never);
    subscriptionsUpdate.mockRejectedValue(new Error('resume failed'));
    await expect(resumeSubscription(orgId)).rejects.toBeInstanceOf(BillingStripeError);
  });

  it('should set status active when resuming a canceled subscription', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      ...baseSubscription,
      status: 'canceled',
      cancelAtPeriodEnd: true,
    } as never);
    subscriptionsUpdate.mockResolvedValue({ id: 'sub_123' });
    vi.mocked(prisma.subscription.update).mockResolvedValue({
      ...baseSubscription,
      status: 'active',
      cancelAtPeriodEnd: false,
    } as never);

    const result = await resumeSubscription(orgId);
    expect(result.status).toBe('active');
    expect(prisma.subscription.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'active', cancelAtPeriodEnd: false }),
      }),
    );
  });

  it('should reject portal session with relative returnUrl', async () => {
    await expect(createPortalSession(orgId, '/billing')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('should wrap Stripe errors from createPortalSession', async () => {
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({
      id: subscriptionId,
      stripeCustomerId: 'cus_123',
    } as never);
    portalCreate.mockRejectedValue(new Error('portal down'));
    await expect(
      createPortalSession(orgId, 'https://app.example/billing'),
    ).rejects.toBeInstanceOf(BillingStripeError);
  });

  it('should require Redis for recordApiCall', async () => {
    await expect(recordApiCall(orgId)).rejects.toBeInstanceOf(AppError);
  });

  it('should reject recordTransaction with negative or unsafe amounts', async () => {
    const { redis } = createMemoryRedis();
    await expect(recordTransaction(orgId, -1n, 'tx', { redis })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(
      recordTransaction(orgId, BigInt(Number.MAX_SAFE_INTEGER) + 1n, 'tx', { redis }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('should record zero-amount transaction without volume increment', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ id: subscriptionId } as never);
    vi.mocked(prisma.usageRecord.create).mockResolvedValue({ id: 'ur' } as never);

    const result = await recordTransaction(orgId, 0n, 'tx-zero', { redis });
    expect(result.transactions).toBe(1);
    expect(result.volumeCents).toBe(0);
  });

  it('should record webhook and dispute creation meters', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ id: subscriptionId } as never);
    vi.mocked(prisma.usageRecord.create).mockResolvedValue({ id: 'ur' } as never);

    await expect(recordWebhookCreated(orgId, 'wh-1', { redis })).resolves.toBe(1);
    await expect(recordDisputeCreated(orgId, 'dp-1', { redis })).resolves.toBe(1);
  });

  it('should fall back to org tier then free when subscription lookup fails', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findUnique)
      .mockRejectedValueOnce(new Error('missing table'))
      .mockRejectedValueOnce(new Error('missing table'));
    vi.mocked(prisma.organization.findUnique)
      .mockResolvedValueOnce({ tier: 'enterprise' } as never)
      .mockRejectedValueOnce(new Error('org down'));

    const summary = await getUsageSummary(orgId, { redis });
    expect(summary.tier).toBe('enterprise');

    const freeSummary = await getUsageSummary(orgId, { redis });
    expect(freeSummary.tier).toBe('free');
  });

  it('should soft-warn at exactly 80% and allow one under hard limit', async () => {
    const { redis } = createMemoryRedis();
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ tier: 'free' } as never);
    const limit = PRICING_TIERS.free.limits.apiCallsPerMonth;
    const soft = Math.floor(limit * 0.8);
    const key = `usage:${orgId}:${currentBillingPeriod()}:api_calls`;

    await redis.incrby(key, soft - 1);
    const underSoft = await checkLimits(orgId, 'api_calls', { redis });
    expect(underSoft.softWarning).toBe(false);

    await redis.incrby(key, 1);
    const atSoft = await checkLimits(orgId, 'api_calls', { redis });
    expect(atSoft.softWarning).toBe(true);
    expect(atSoft.allowed).toBe(true);

    await redis.incrby(key, limit - soft - 1);
    const oneUnder = await checkLimits(orgId, 'api_calls', { redis });
    expect(oneUnder.currentUsage).toBe(limit - 1);
    expect(oneUnder.allowed).toBe(true);

    await redis.incrby(key, 1);
    const atLimit = await checkLimits(orgId, 'api_calls', { redis });
    expect(atLimit.allowed).toBe(false);
  });

  it('should flush transaction_volume_cents with amountCents set', async () => {
    const { redis, sets } = createMemoryRedis();
    const period = currentBillingPeriod();
    sets.set('usage:dirty', new Set([`${orgId}:${period}`]));
    await redis.incrby(`usage:${orgId}:${period}:transaction_volume_cents`, 999);
    vi.mocked(prisma.subscription.findUnique).mockResolvedValue({ id: subscriptionId } as never);
    vi.mocked(prisma.usageRecord.create).mockResolvedValue({ id: 'ur' } as never);

    await flushUsageToDatabase(redis, 5);
    expect(prisma.usageRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          meterType: 'transaction_volume_cents',
          amountCents: 999n,
          source: 'redis_flush',
        }),
      }),
    );
  });
});
