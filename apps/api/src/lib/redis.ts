import { Redis } from 'ioredis';
import type { Logger } from 'pino';

export function createRedisClient(url: string, logger: Logger): Redis {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  redis.on('error', (error: Error) => {
    logger.error({ err: error }, 'Redis client error');
  });

  return redis;
}

export async function checkRedis(redis: Redis): Promise<boolean> {
  try {
    if (redis.status !== 'ready') {
      await redis.connect();
    }
    const result = await redis.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
