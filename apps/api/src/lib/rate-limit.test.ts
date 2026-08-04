import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  enforceRateLimit,
  enforceStripeWebhookIpLimit,
  enforceTransactionCreateLimit,
  resolveClientIp,
  TIER_LIMITS,
  TRANSACTION_CREATE_LIMIT_PER_MINUTE,
} from './rate-limit.js';

function mockRedis(overrides: Partial<Redis> = {}): Redis {
  return {
    status: 'ready',
    connect: vi.fn(),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    ...overrides,
  } as unknown as Redis;
}

function mockReqReply() {
  const headers: Record<string, string> = {};
  const reply = {
    header: vi.fn((k: string, v: string) => {
      headers[k.toLowerCase()] = v;
      return reply;
    }),
    status: vi.fn(() => reply),
    send: vi.fn(async () => reply),
  } as unknown as FastifyReply;
  const request = {
    id: 'req-1',
    log: { error: vi.fn(), warn: vi.fn() },
  } as unknown as FastifyRequest;
  return { request, reply, headers };
}

describe('enforceRateLimit', () => {
  it('allows requests under the tier limit', async () => {
    const redis = mockRedis();
    const { request, reply } = mockReqReply();
    const ok = await enforceRateLimit({
      redis,
      orgId: 'org',
      apiKeyId: 'key',
      tier: 'free',
      route: 'GET:/v1/agents',
      request,
      reply,
    });
    expect(ok).toBe(true);
    expect(TIER_LIMITS.free).toBe(100);
  });

  it('increments agent window when agentId is present', async () => {
    const incr = vi.fn(async () => 1);
    const redis = mockRedis({ incr } as Partial<Redis>);
    const { request, reply } = mockReqReply();
    await enforceRateLimit({
      redis,
      orgId: 'org',
      apiKeyId: 'key',
      tier: 'developer',
      agentId: 'agent-1',
      route: 'GET:/v1/agents',
      request,
      reply,
    });
    expect(incr).toHaveBeenCalledTimes(3);
  });

  it('fail-closes when Redis throws', async () => {
    const redis = mockRedis({
      incr: vi.fn(async () => {
        throw new Error('redis down');
      }),
    } as Partial<Redis>);
    const { request, reply, headers } = mockReqReply();
    const ok = await enforceRateLimit({
      redis,
      orgId: 'org',
      apiKeyId: 'key',
      tier: 'free',
      route: 'GET:/v1/agents',
      request,
      reply,
    });
    expect(ok).toBe(false);
    expect(headers['retry-after']).toBe('60');
    expect(reply.status).toHaveBeenCalledWith(429);
  });

  it('returns 429 when count exceeds limit', async () => {
    const redis = mockRedis({
      incr: vi.fn(async () => 101),
    } as Partial<Redis>);
    const { request, reply } = mockReqReply();
    const ok = await enforceRateLimit({
      redis,
      orgId: 'org',
      apiKeyId: 'key',
      tier: 'free',
      route: 'GET:/v1/agents',
      request,
      reply,
    });
    expect(ok).toBe(false);
    expect(reply.status).toHaveBeenCalledWith(429);
  });
});

describe('enforceTransactionCreateLimit', () => {
  it('allows under 10 creates per minute', async () => {
    const redis = mockRedis({ incr: vi.fn(async () => 3) } as Partial<Redis>);
    const { request, reply } = mockReqReply();
    const ok = await enforceTransactionCreateLimit({
      redis,
      orgId: 'org',
      request,
      reply,
    });
    expect(ok).toBe(true);
    expect(TRANSACTION_CREATE_LIMIT_PER_MINUTE).toBeGreaterThanOrEqual(10);
  });

  it('rejects above create limit', async () => {
    const redis = mockRedis({
      incr: vi.fn(async () => TRANSACTION_CREATE_LIMIT_PER_MINUTE + 1),
    } as Partial<Redis>);
    const { request, reply } = mockReqReply();
    const ok = await enforceTransactionCreateLimit({
      redis,
      orgId: 'org',
      request,
      reply,
    });
    expect(ok).toBe(false);
    expect(reply.status).toHaveBeenCalledWith(429);
  });
});

describe('resolveClientIp', () => {
  it('prefers the first X-Forwarded-For hop', () => {
    const request = {
      ip: '10.0.0.1',
      headers: { 'x-forwarded-for': '203.0.113.10, 10.0.0.1' },
    } as unknown as FastifyRequest;
    expect(resolveClientIp(request)).toBe('203.0.113.10');
  });

  it('falls back to request.ip', () => {
    const request = {
      ip: '127.0.0.1',
      headers: {},
    } as unknown as FastifyRequest;
    expect(resolveClientIp(request)).toBe('127.0.0.1');
  });
});

describe('enforceStripeWebhookIpLimit', () => {
  it('allows requests under the per-IP limit', async () => {
    const redis = mockRedis({ incr: vi.fn(async () => 1) } as Partial<Redis>);
    const { request, reply, headers } = mockReqReply();
    (request as { ip?: string }).ip = '203.0.113.5';
    (request as { headers: Record<string, string> }).headers = {};

    const ok = await enforceStripeWebhookIpLimit({ redis, request, reply });
    expect(ok).toBe(true);
    expect(headers['x-ratelimit-limit']).toBeDefined();
  });

  it('returns 429 with Retry-After when exceeded', async () => {
    const redis = mockRedis({
      incr: vi.fn(async () => 10_001),
    } as Partial<Redis>);
    const { request, reply, headers } = mockReqReply();
    (request as { ip?: string }).ip = '203.0.113.5';
    (request as { headers: Record<string, string> }).headers = {};

    const ok = await enforceStripeWebhookIpLimit({ redis, request, reply });
    expect(ok).toBe(false);
    expect(reply.status).toHaveBeenCalledWith(429);
    expect(headers['retry-after']).toBe('60');
  });

  it('fail-closes when Redis is unavailable', async () => {
    const redis = mockRedis({
      incr: vi.fn(async () => {
        throw new Error('redis down');
      }),
    } as Partial<Redis>);
    const { request, reply, headers } = mockReqReply();
    (request as { ip?: string }).ip = '203.0.113.5';
    (request as { headers: Record<string, string> }).headers = {};

    const ok = await enforceStripeWebhookIpLimit({ redis, request, reply });
    expect(ok).toBe(false);
    expect(reply.status).toHaveBeenCalledWith(429);
    expect(headers['retry-after']).toBe('60');
  });
});
