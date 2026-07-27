import { freemem, totalmem } from 'node:os';
import { statfs } from 'node:fs/promises';
import type { FastifyPluginAsync } from 'fastify';
import type { HealthCheck, HealthDependencyCheck } from '@cognistream/shared';
import { checkDatabaseDetailed } from '../lib/prisma.js';
import { checkRedisDetailed } from '../lib/redis.js';

const startedAt = Date.now();
const DEEP_TIMEOUT_MS = 5_000;

function uptimeSeconds(): number {
  return Math.round(((Date.now() - startedAt) / 1000) * 100) / 100;
}

function aggregateStatus(
  checks: Array<HealthDependencyCheck | undefined>,
): HealthCheck['status'] {
  const defined = checks.filter((c): c is HealthDependencyCheck => Boolean(c));
  if (defined.length === 0) {
    return 'ok';
  }
  const ups = defined.filter((c) => c.status === 'up').length;
  if (ups === defined.length) return 'ok';
  if (ups === 0) return 'error';
  return 'degraded';
}

async function checkDisk(): Promise<HealthDependencyCheck> {
  const start = process.hrtime.bigint();
  try {
    // Prefer filesystem stats; fall back to memory pressure as a coarse signal.
    const root = process.platform === 'win32' ? process.cwd().slice(0, 3) : '/';
    const stats = await statfs(root);
    const freeBytes = Number(stats.bfree) * Number(stats.bsize);
    const totalBytes = Number(stats.blocks) * Number(stats.bsize);
    const freeRatio = totalBytes > 0 ? freeBytes / totalBytes : 1;
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    const memFreeRatio = freemem() / totalmem();

    const ok = freeRatio > 0.05 && memFreeRatio > 0.02;
    return {
      status: ok ? 'up' : 'down',
      latencyMs: Math.round(latencyMs * 100) / 100,
      detail: ok ? undefined : 'Low disk or memory headroom',
    };
  } catch (error) {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    return {
      status: 'down',
      latencyMs: Math.round(latencyMs * 100) / 100,
      detail: error instanceof Error ? error.message : 'disk check failed',
    };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

export const healthRoutes: FastifyPluginAsync<{ version: string }> = async (app, opts) => {
  const version = opts.version ?? '0.1.0';

  /** Liveness — process is up; no dependency I/O. */
  app.get('/health', async (_request, reply) => {
    const body: HealthCheck = {
      status: 'ok',
      checks: {},
      version,
      uptime: uptimeSeconds(),
      timestamp: new Date().toISOString(),
    };
    return reply.status(200).send(body);
  });

  /** Readiness — database + Redis must respond. */
  app.get('/health/ready', async (_request, reply) => {
    const [database, redis] = await Promise.all([
      checkDatabaseDetailed(),
      checkRedisDetailed(app.redis),
    ]);

    const checks = {
      database: {
        status: database.ok ? ('up' as const) : ('down' as const),
        latencyMs: database.latencyMs,
      },
      redis: {
        status: redis.ok ? ('up' as const) : ('down' as const),
        latencyMs: redis.latencyMs,
      },
    };

    const status = aggregateStatus([checks.database, checks.redis]);
    const body: HealthCheck = {
      status,
      checks,
      version,
      uptime: uptimeSeconds(),
      timestamp: new Date().toISOString(),
      services: {
        database: checks.database.status,
        redis: checks.redis.status,
      },
    };

    return reply.status(status === 'ok' ? 200 : 503).send(body);
  });

  /** Deep — DB query + Redis ping + disk, hard-capped at 5s. */
  app.get('/health/deep', async (_request, reply) => {
    try {
      const result = await withTimeout(
        (async () => {
          const [database, redis, disk] = await Promise.all([
            checkDatabaseDetailed(),
            checkRedisDetailed(app.redis),
            checkDisk(),
          ]);
          return { database, redis, disk };
        })(),
        DEEP_TIMEOUT_MS,
      );

      const checks = {
        database: {
          status: result.database.ok ? ('up' as const) : ('down' as const),
          latencyMs: result.database.latencyMs,
        },
        redis: {
          status: result.redis.ok ? ('up' as const) : ('down' as const),
          latencyMs: result.redis.latencyMs,
        },
        disk: result.disk,
      };

      const status = aggregateStatus([checks.database, checks.redis, checks.disk]);
      const body: HealthCheck = {
        status,
        checks,
        version,
        uptime: uptimeSeconds(),
        timestamp: new Date().toISOString(),
        services: {
          database: checks.database.status,
          redis: checks.redis.status,
        },
      };

      return reply.status(status === 'ok' ? 200 : 503).send(body);
    } catch {
      const body: HealthCheck = {
        status: 'error',
        checks: {
          database: { status: 'down', detail: 'timeout or failure' },
          redis: { status: 'down', detail: 'timeout or failure' },
          disk: { status: 'down', detail: 'timeout or failure' },
        },
        version,
        uptime: uptimeSeconds(),
        timestamp: new Date().toISOString(),
      };
      return reply.status(503).send(body);
    }
  });
};
