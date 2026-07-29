import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import type { Env } from './config.js';
import { createRedisClient } from './lib/redis.js';
import { registerErrorHandler } from './lib/error-handler.js';
import { createId } from './lib/uuid.js';
import { getActiveTraceIds } from './telemetry/tracing.js';
import { initMetrics } from './telemetry/metrics.js';
import { metricsRoutes } from './telemetry/metrics-route.js';
import { authPlugin } from './plugins/auth.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { websocketPlugin } from './plugins/websocket.js';
import { apiMaturityPlugin } from './plugins/api-maturity.js';
import { healthRoutes } from './routes/health.js';
import { agentRoutes } from './routes/agents.js';
import { apiKeyRoutes } from './routes/api-keys.js';
import { transactionRoutes } from './routes/transactions.js';
import { disputeRoutes } from './routes/disputes.js';
import { overviewRoutes } from './routes/overview.js';
import { initAuditRuntime, stopAuditRuntime } from './security/audit-runtime.js';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

export async function buildApp(env: Env, logger: Logger): Promise<FastifyInstance> {
  // Ensure Prisma encryption extension sees the same keys as loadEnv
  process.env.ENCRYPTION_KEYS = env.ENCRYPTION_KEYS;
  initMetrics({ collectDefaultMetrics: env.NODE_ENV !== 'test' });

  const app = Fastify({
    loggerInstance: logger,
    requestIdHeader: 'x-request-id',
    genReqId: () => createId(),
  });

  await app.register(sensible);
  registerErrorHandler(app as never);

  // Ensure every request log includes requestId + active OTEL trace/span ids.
  app.addHook('onRequest', async (request) => {
    const { traceId, spanId } = getActiveTraceIds();
    request.log = request.log.child({
      requestId: String(request.id),
      ...(traceId ? { traceId } : {}),
      ...(spanId ? { spanId } : {}),
    });
  });

  const redis = createRedisClient(env.REDIS_URL, logger);
  app.decorate('redis', redis);

  initAuditRuntime({
    redis,
    auditHmacKey: env.AUDIT_HMAC_KEY,
    logger,
    startWorker: env.NODE_ENV !== 'test',
  });

  app.addHook('onClose', async () => {
    await stopAuditRuntime();
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

  await app.register(apiMaturityPlugin);
  await app.register(authPlugin);
  await app.register(rateLimitPlugin);
  await app.register(websocketPlugin);

  await app.register(healthRoutes, { version: env.APP_VERSION });
  await app.register(metricsRoutes, { allowlist: env.METRICS_IP_ALLOWLIST });
  await app.register(agentRoutes, { prefix: '/v1' });
  await app.register(apiKeyRoutes, { prefix: '/v1' });
  await app.register(transactionRoutes, { prefix: '/v1' });
  await app.register(disputeRoutes, { prefix: '/v1' });
  await app.register(overviewRoutes, { prefix: '/v1' });

  return app as unknown as FastifyInstance;
}
