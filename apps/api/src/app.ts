import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Env } from './config.js';
import { createRedisClient } from './lib/redis.js';
import { healthRoutes } from './routes/health.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

export async function buildApp(env: Env, logger: Logger) {
  const app = Fastify({
    loggerInstance: logger,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(sensible);

  const redis = createRedisClient(env.REDIS_URL, logger);
  app.decorate('redis', redis);

  app.addHook('onClose', async () => {
    try {
      if (redis.status === 'ready') {
        await redis.quit();
      } else {
        redis.disconnect();
      }
    } catch {
      redis.disconnect();
    }
  });

  await app.register(healthRoutes);

  return app;
}
