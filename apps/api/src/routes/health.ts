import type { FastifyPluginAsync } from 'fastify';
import type { HealthCheck } from '@cognistream/shared';
import { checkDatabase } from '../lib/prisma.js';
import { checkRedis } from '../lib/redis.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', async (_request, reply) => {
    const [databaseUp, redisUp] = await Promise.all([
      checkDatabase(),
      checkRedis(app.redis),
    ]);

    const status: HealthCheck['status'] =
      databaseUp && redisUp ? 'ok' : databaseUp || redisUp ? 'degraded' : 'error';

    const body: HealthCheck = {
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: databaseUp ? 'up' : 'down',
        redis: redisUp ? 'up' : 'down',
      },
    };

    const httpStatus = status === 'ok' ? 200 : status === 'degraded' ? 503 : 503;
    return reply.status(httpStatus).send(body);
  });
};
