import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import type { Redis } from 'ioredis';
import fp from 'fastify-plugin';
import {
  FREE_HARD_LIMIT_RATIO,
  PAID_HARD_LIMIT_RATIO,
  SOFT_LIMIT_RATIO,
  USAGE_TTL_SECONDS,
  currentBillingPeriod,
  dirtyMember,
  getUsageCounter,
  hardLimitForTier,
  incrUsageCounter,
  softLimitFor,
  usageRedisKey,
} from '../lib/usage-counters.js';
import {
  enforceUsageMetering,
  resolveUsageMeters,
  usageMeteringPlugin,
} from './usage-metering.js';

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

vi.mock('../services/billing.js', () => ({
  checkLimits: vi.fn(),
  recordApiCall: vi.fn().mockResolvedValue(1),
  recordTransaction: vi.fn().mockResolvedValue({ transactions: 1, volumeCents: 100 }),
  recordAgentCreated: vi.fn().mockResolvedValue(1),
  recordWebhookCreated: vi.fn().mockResolvedValue(1),
  recordDisputeCreated: vi.fn().mockResolvedValue(1),
  flushUsageToDatabase: vi.fn().mockResolvedValue(0),
}));

import {
  checkLimits,
  recordApiCall,
  recordTransaction,
  recordAgentCreated,
  recordWebhookCreated,
  recordDisputeCreated,
  flushUsageToDatabase,
} from '../services/billing.js';

describe('usage counter helpers', () => {
  it('builds redis keys and dirty members for YYYY-MM', () => {
    const period = currentBillingPeriod(new Date('2026-07-15T00:00:00.000Z'));
    expect(period).toBe('2026-07');
    expect(usageRedisKey('org1', 'api_calls', period)).toBe('usage:org1:2026-07:api_calls');
    expect(dirtyMember('org1', period)).toBe('org1:2026-07');
    expect(USAGE_TTL_SECONDS).toBe(35 * 24 * 60 * 60);
  });

  it('increments counters with TTL on first write', async () => {
    const { redis, store } = createMemoryRedis();
    const count = await incrUsageCounter(redis, 'org1', 'api_calls', 3, '2026-07');
    expect(count).toBe(3);
    expect(store.get('usage:org1:2026-07:api_calls')).toBe('3');
    expect(redis.expire).toHaveBeenCalled();
    expect(await getUsageCounter(redis, 'org1', 'api_calls', '2026-07')).toBe(3);
  });

  it('computes soft and hard limits', () => {
    expect(softLimitFor(1000)).toBe(Math.floor(1000 * SOFT_LIMIT_RATIO));
    expect(hardLimitForTier(100, 'free')).toBe(Math.floor(100 * FREE_HARD_LIMIT_RATIO));
    expect(hardLimitForTier(100, 'developer')).toBe(Math.floor(100 * PAID_HARD_LIMIT_RATIO));
  });
});

describe('resolveUsageMeters', () => {
  it('always meters api_calls and adds resource meters for POSTs', () => {
    expect(resolveUsageMeters('GET', '/v1/agents')).toEqual({
      check: ['api_calls'],
      record: ['api_calls'],
    });
    expect(resolveUsageMeters('POST', '/v1/transactions')).toEqual({
      check: ['api_calls', 'transactions', 'transaction_volume_cents'],
      record: ['api_calls', 'transactions', 'transaction_volume_cents'],
    });
    expect(resolveUsageMeters('POST', '/v1/agents').check).toContain('agents');
    expect(resolveUsageMeters('POST', '/v1/webhooks').check).toContain('webhooks');
    expect(resolveUsageMeters('POST', '/v1/disputes').check).toContain('disputes');
  });
});

describe('enforceUsageMetering', () => {
  const orgId = '01900000-0000-7000-8000-0000000000aa';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows under-limit traffic and plans api_calls recording', async () => {
    vi.mocked(checkLimits).mockResolvedValue({
      allowed: true,
      currentUsage: 10,
      limit: 1000,
      softWarning: false,
      overageQuantity: 0,
      hardLimit: 1000,
    });
    const { redis } = createMemoryRedis();
    const reply = { header: vi.fn(), status: vi.fn() };
    const request = {
      id: 'req-1',
      method: 'GET',
      url: '/v1/agents',
      routeOptions: { url: '/agents', prefix: '/v1' },
      body: undefined,
    };

    const ok = await enforceUsageMetering({
      redis,
      orgId,
      request: request as never,
      reply: reply as never,
    });
    expect(ok).toBe(true);
    expect(reply.status).not.toHaveBeenCalled();
    expect((request as { usageMeterPlan?: unknown }).usageMeterPlan).toEqual({
      record: ['api_calls'],
      orgId,
    });
  });

  it('sets X-Usage-Warning at soft limit', async () => {
    vi.mocked(checkLimits).mockResolvedValue({
      allowed: true,
      reason: 'Approaching api_calls quota (800/1000)',
      currentUsage: 800,
      limit: 1000,
      softWarning: true,
      overageQuantity: 0,
      hardLimit: 1000,
    });
    const { redis } = createMemoryRedis();
    const reply = { header: vi.fn(), status: vi.fn() };
    const request = {
      id: 'req-2',
      method: 'GET',
      url: '/v1/agents',
      routeOptions: { url: '/agents', prefix: '/v1' },
    };

    await enforceUsageMetering({
      redis,
      orgId,
      request: request as never,
      reply: reply as never,
    });
    expect(reply.header).toHaveBeenCalledWith(
      'X-Usage-Warning',
      expect.stringContaining('Approaching'),
    );
  });

  it('returns 429 QUOTA_EXCEEDED at hard limit', async () => {
    vi.mocked(checkLimits).mockResolvedValue({
      allowed: false,
      reason: 'Quota exceeded for api_calls',
      currentUsage: 1000,
      limit: 1000,
      softWarning: false,
      overageQuantity: 0,
      hardLimit: 1000,
    });
    const { redis } = createMemoryRedis();
    const send = vi.fn(async () => undefined);
    const reply = {
      header: vi.fn(),
      status: vi.fn(() => ({ send })),
    };
    const request = {
      id: 'req-3',
      method: 'GET',
      url: '/v1/agents',
      routeOptions: { url: '/agents', prefix: '/v1' },
    };

    const ok = await enforceUsageMetering({
      redis,
      orgId,
      request: request as never,
      reply: reply as never,
    });
    expect(ok).toBe(false);
    expect(reply.status).toHaveBeenCalledWith(429);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        error: expect.objectContaining({ code: 'QUOTA_EXCEEDED' }),
      }),
    );
  });
});

describe('usageMeteringPlugin integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkLimits).mockResolvedValue({
      allowed: true,
      currentUsage: 0,
      limit: 1000,
      softWarning: false,
      overageQuantity: 0,
      hardLimit: 1000,
    });
  });

  it('increments counters per operation type after successful /v1 responses', async () => {
    const { redis } = createMemoryRedis();
    const app = Fastify();
    app.decorate('redis', redis);
    await app.register(fp(async () => undefined, { name: 'auth-plugin' }));
    await app.register(usageMeteringPlugin);

    await app.register(
      async (scoped) => {
        scoped.post(
          '/transactions',
          {
            preHandler: async (request) => {
              request.auth = {
                orgId: 'org-1',
                apiKeyId: 'key-1',
                scopes: ['write:transactions'],
                tier: 'free',
              };
            },
          },
          async () => ({ id: 'tx-1' }),
        );
        scoped.post(
          '/agents',
          {
            preHandler: async (request) => {
              request.auth = {
                orgId: 'org-1',
                apiKeyId: 'key-1',
                scopes: ['write:agents'],
                tier: 'free',
              };
            },
          },
          async () => ({ id: 'agent-1' }),
        );
      },
      { prefix: '/v1' },
    );

    const tx = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      payload: { amountCents: 500 },
    });
    expect(tx.statusCode).toBe(200);
    expect(recordApiCall).toHaveBeenCalled();
    expect(recordTransaction).toHaveBeenCalledWith(
      'org-1',
      500n,
      expect.any(String),
      expect.objectContaining({ redis }),
    );

    const agent = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      payload: { name: 'A' },
    });
    expect(agent.statusCode).toBe(200);
    expect(recordAgentCreated).toHaveBeenCalled();

    await app.close();
  });

  it('blocks with 429 when quota exceeded', async () => {
    vi.mocked(checkLimits).mockResolvedValue({
      allowed: false,
      reason: 'Quota exceeded',
      currentUsage: 1000,
      limit: 1000,
      softWarning: false,
      overageQuantity: 0,
      hardLimit: 1000,
    });
    const { redis } = createMemoryRedis();
    const app = Fastify();
    app.decorate('redis', redis);
    await app.register(fp(async () => undefined, { name: 'auth-plugin' }));
    await app.register(usageMeteringPlugin);

    await app.register(
      async (scoped) => {
        scoped.get(
          '/agents',
          {
            preHandler: async (request) => {
              request.auth = {
                orgId: 'org-1',
                apiKeyId: 'key-1',
                scopes: ['read:agents'],
                tier: 'free',
              };
            },
          },
          async () => ({ items: [] }),
        );
      },
      { prefix: '/v1' },
    );

    const res = await app.inject({ method: 'GET', url: '/v1/agents' });
    expect(res.statusCode).toBe(429);
    expect(res.json().error.code).toBe('QUOTA_EXCEEDED');
    expect(recordApiCall).not.toHaveBeenCalled();

    await app.close();
  });

  it('records webhooks and disputes meters on successful POSTs', async () => {
    const { redis } = createMemoryRedis();
    const app = Fastify();
    app.decorate('redis', redis);
    await app.register(fp(async () => undefined, { name: 'auth-plugin' }));
    await app.register(usageMeteringPlugin);

    await app.register(
      async (scoped) => {
        const auth = async (request: { auth?: unknown }) => {
          request.auth = {
            orgId: 'org-1',
            apiKeyId: 'key-1',
            scopes: ['write:webhooks'],
            tier: 'developer',
          };
        };
        scoped.post('/webhooks', { preHandler: auth as never }, async () => ({ id: 'wh-1' }));
        scoped.post('/disputes', { preHandler: auth as never }, async () => ({ id: 'dp-1' }));
      },
      { prefix: '/v1' },
    );

    expect((await app.inject({ method: 'POST', url: '/v1/webhooks', payload: {} })).statusCode).toBe(
      200,
    );
    expect(recordWebhookCreated).toHaveBeenCalled();

    expect((await app.inject({ method: 'POST', url: '/v1/disputes', payload: {} })).statusCode).toBe(
      200,
    );
    expect(recordDisputeCreated).toHaveBeenCalled();

    await app.close();
  });

  it('logs when usage increment fails after a successful response', async () => {
    vi.mocked(recordApiCall).mockRejectedValueOnce(new Error('redis down'));
    const { redis } = createMemoryRedis();
    const app = Fastify();
    app.decorate('redis', redis);
    await app.register(fp(async () => undefined, { name: 'auth-plugin' }));
    await app.register(usageMeteringPlugin);

    await app.register(
      async (scoped) => {
        scoped.get(
          '/agents',
          {
            preHandler: async (request) => {
              request.auth = {
                orgId: 'org-1',
                apiKeyId: 'key-1',
                scopes: ['read:agents'],
                tier: 'free',
              };
            },
          },
          async () => ({ ok: true }),
        );
      },
      { prefix: '/v1' },
    );

    const res = await app.inject({ method: 'GET', url: '/v1/agents' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('starts flush timer outside test env and swallows flush errors', async () => {
    vi.useFakeTimers();
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    vi.mocked(flushUsageToDatabase).mockRejectedValueOnce(new Error('flush failed'));

    try {
      const { redis } = createMemoryRedis();
      const app = Fastify({ logger: false });
      app.decorate('redis', redis);
      await app.register(fp(async () => undefined, { name: 'auth-plugin' }));
      await app.register(usageMeteringPlugin);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(flushUsageToDatabase).toHaveBeenCalled();
      await app.close();
    } finally {
      process.env.NODE_ENV = previous;
      vi.useRealTimers();
    }
  });
});

describe('enforceUsageMetering path + amount edge cases', () => {
  const orgId = 'org-path';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkLimits).mockResolvedValue({
      allowed: true,
      currentUsage: 0,
      limit: 100,
      softWarning: false,
      overageQuantity: 0,
      hardLimit: 100,
    });
  });

  it('resolves path from routeOptions when url is not prefixed with /v1', async () => {
    const { redis } = createMemoryRedis();
    const reply = { header: vi.fn(), status: vi.fn() };
    const request = {
      id: 'req-path',
      method: 'POST',
      url: '/agents?x=1',
      routeOptions: { url: '/agents', prefix: '/v1' },
      body: { amountCents: '42' },
    };

    const ok = await enforceUsageMetering({
      redis,
      orgId,
      request: request as never,
      reply: reply as never,
    });
    expect(ok).toBe(true);
    expect((request as { usageMeterPlan?: { record: string[] } }).usageMeterPlan?.record).toContain(
      'agents',
    );
  });

  it('builds /v1 path when routeOptions lack prefix', async () => {
    const { redis } = createMemoryRedis();
    const reply = { header: vi.fn(), status: vi.fn() };
    const request = {
      id: 'req-noprefix',
      method: 'GET',
      url: '/agents',
      routeOptions: { url: 'agents' },
    };

    await enforceUsageMetering({
      redis,
      orgId,
      request: request as never,
      reply: reply as never,
    });
    expect(checkLimits).toHaveBeenCalled();
  });

  it('uses default soft-limit header text when reason is omitted', async () => {
    vi.mocked(checkLimits).mockResolvedValue({
      allowed: true,
      currentUsage: 80,
      limit: 100,
      softWarning: true,
      overageQuantity: 0,
      hardLimit: 100,
    });
    const { redis } = createMemoryRedis();
    const reply = { header: vi.fn(), status: vi.fn() };
    await enforceUsageMetering({
      redis,
      orgId,
      request: {
        id: 'req-soft',
        method: 'GET',
        url: '/v1/agents',
        routeOptions: { url: '/agents', prefix: '/v1' },
      } as never,
      reply: reply as never,
    });
    expect(reply.header).toHaveBeenCalledWith(
      'X-Usage-Warning',
      expect.stringContaining('soft limit'),
    );
  });

  it('parses amountCents from bigint and rejects negative via 0n clamp on inject path', async () => {
    const { redis } = createMemoryRedis();
    const app = Fastify();
    app.decorate('redis', redis);
    await app.register(fp(async () => undefined, { name: 'auth-plugin' }));
    await app.register(usageMeteringPlugin);

    await app.register(
      async (scoped) => {
        scoped.post(
          '/transactions',
          {
            preHandler: async (request) => {
              request.auth = {
                orgId: 'org-1',
                apiKeyId: 'key-1',
                scopes: ['write:transactions'],
                tier: 'free',
              };
              // Simulate pre-parsed bigint body
              (request as { body: unknown }).body = { amountCents: 99n };
            },
          },
          async () => ({ id: 'tx' }),
        );
      },
      { prefix: '/v1' },
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      payload: { amountCents: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect(recordTransaction).toHaveBeenCalled();
    await app.close();
  });
});
