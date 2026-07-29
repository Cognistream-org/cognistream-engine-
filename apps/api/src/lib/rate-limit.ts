import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OrganizationTier } from '@cognistream/shared';
import type { Redis } from 'ioredis';
import { errorBody } from './errors.js';
import { recordRateLimitHit } from '../telemetry/index.js';

const WINDOW_SECONDS = 60;

export const TIER_LIMITS = {
  free: 100,
  developer: 1000,
  enterprise: 10_000,
} as const satisfies Record<OrganizationTier, number>;

function resolveTierLimit(tier: OrganizationTier): number {
  switch (tier) {
    case 'free':
      return 100;
    case 'developer':
      return 1000;
    case 'enterprise':
      return 10_000;
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}

async function ensureRedis(redis: Redis): Promise<void> {
  if (redis.status !== 'ready') {
    await redis.connect();
  }
}

async function incrWindow(redis: Redis, key: string): Promise<number> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, WINDOW_SECONDS);
  }
  return count;
}

/** Stricter limit for POST /v1/transactions — 10 creates per minute per org. */
export const TRANSACTION_CREATE_LIMIT_PER_MINUTE =
  process.env.NODE_ENV === 'test' ? 1_000 : 10;

export async function enforceTransactionCreateLimit(options: {
  redis: Redis;
  orgId: string;
  request: FastifyRequest;
  reply: FastifyReply;
}): Promise<boolean> {
  const { redis, orgId, request, reply } = options;
  const requestId = String(request.id);
  const window = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const key = `ratelimit:txcreate:${orgId}:${window}`;

  try {
    await ensureRedis(redis);
    const count = await incrWindow(redis, key);
    if (count > TRANSACTION_CREATE_LIMIT_PER_MINUTE) {
      recordRateLimitHit('POST /v1/transactions', orgId);
      reply.header('Retry-After', String(WINDOW_SECONDS));
      await reply.status(429).send(
        errorBody('RATE_LIMITED', 'Transaction create rate limit exceeded', requestId),
      );
      return false;
    }
    reply.header('X-RateLimit-Limit', String(TRANSACTION_CREATE_LIMIT_PER_MINUTE));
    reply.header(
      'X-RateLimit-Remaining',
      String(Math.max(0, TRANSACTION_CREATE_LIMIT_PER_MINUTE - count)),
    );
    const windowEnd =
      (Math.floor(Date.now() / (WINDOW_SECONDS * 1000)) + 1) * WINDOW_SECONDS;
    reply.header('X-RateLimit-Reset', String(windowEnd));
    return true;
  } catch (error) {
    request.log.error({ err: error }, 'Transaction rate limiter unavailable');
    reply.header('Retry-After', String(WINDOW_SECONDS));
    await reply.status(429).send(
      errorBody('RATE_LIMITER_UNAVAILABLE', 'Rate limiter unavailable', requestId),
    );
    return false;
  }
}

export async function enforceRateLimit(options: {
  redis: Redis;
  orgId: string;
  apiKeyId: string;
  tier: OrganizationTier;
  agentId?: string;
  route: string;
  request: FastifyRequest;
  reply: FastifyReply;
}): Promise<boolean> {
  const { redis, orgId, tier, agentId, route, request, reply } = options;
  const limit = resolveTierLimit(tier);
  const window = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const requestId = String(request.id);

  try {
    await ensureRedis(redis);

    const orgKey = `ratelimit:org:${orgId}:${window}`;
    const endpointKey = `ratelimit:endpoint:${orgId}:${route}:${window}`;
    const counts: number[] = [];

    counts.push(await incrWindow(redis, orgKey));
    counts.push(await incrWindow(redis, endpointKey));

    if (agentId) {
      const agentKey = `ratelimit:agent:${agentId}:${window}`;
      counts.push(await incrWindow(redis, agentKey));
    }

    const maxCount = Math.max(...counts);
    if (maxCount > limit) {
      recordRateLimitHit(route, orgId);
      reply.header('Retry-After', String(WINDOW_SECONDS));
      await reply.status(429).send(
        errorBody('RATE_LIMITED', 'Rate limit exceeded', requestId),
      );
      return false;
    }

    reply.header('X-RateLimit-Limit', String(limit));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, limit - maxCount)));
    const windowEnd =
      (Math.floor(Date.now() / (WINDOW_SECONDS * 1000)) + 1) * WINDOW_SECONDS;
    reply.header('X-RateLimit-Reset', String(windowEnd));
    return true;
  } catch (error) {
    request.log.error({ err: error }, 'Rate limiter unavailable');
    reply.header('Retry-After', String(WINDOW_SECONDS));
    await reply.status(429).send(
      errorBody('RATE_LIMITER_UNAVAILABLE', 'Rate limiter unavailable', requestId),
    );
    return false;
  }
}
