import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Env } from './config.js';
import { createRedisClient } from './lib/redis.js';
import { registerErrorHandler } from './lib/error-handler.js';
import { authPlugin } from './plugins/auth.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';
import { apiKeyRoutes } from './routes/api-keys.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

export async function buildApp(env: Env, logger: Logger): Promise<FastifyInstance> {
  const app = Fastify({
    loggerInstance: logger,
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
  });

  await app.register(sensible);
  registerErrorHandler(app as never);

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

  await app.register(authPlugin);
  await app.register(rateLimitPlugin);

  await app.register(healthRoutes);
  await app.register(agentRoutes, { prefix: '/v1' });
  await app.register(apiKeyRoutes, { prefix: '/v1' });

  return app as unknown as FastifyInstance;
}
