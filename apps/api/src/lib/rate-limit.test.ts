import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { enforceRateLimit, TIER_LIMITS } from './rate-limit.js';

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
