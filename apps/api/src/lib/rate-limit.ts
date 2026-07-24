import type { FastifyReply, FastifyRequest } from 'fastify';
import type { OrganizationTier } from '@prisma/client';
import type { Redis } from 'ioredis';
import { errorBody } from './errors.js';

const WINDOW_SECONDS = 60;

export const TIER_LIMITS: Record<OrganizationTier, number> = {
  free: 100,
  developer: 1000,
  enterprise: 10_000,
};

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
  const limit = TIER_LIMITS[tier];
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
      reply.header('Retry-After', String(WINDOW_SECONDS));
      await reply.status(429).send(
        errorBody('RATE_LIMITED', 'Rate limit exceeded', requestId),
      );
      return false;
    }

    reply.header('X-RateLimit-Limit', String(limit));
    reply.header('X-RateLimit-Remaining', String(Math.max(0, limit - maxCount)));
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
