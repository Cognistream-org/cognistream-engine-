import { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { observeRedisOperation } from '../telemetry/metrics.js';

type RedisCommand = {
  name?: { toLowerCase?: () => string } | string;
};

export function createRedisClient(url: string, logger: Logger): Redis {
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  redis.on('error', (error: Error) => {
    logger.error({ err: error }, 'Redis client error');
  });

  // Instrument command latency without wrapping every public method.
  if (typeof redis.sendCommand === 'function') {
    const originalSendCommand = redis.sendCommand.bind(redis);
    redis.sendCommand = ((command: RedisCommand, ...rest: unknown[]) => {
      const start = process.hrtime.bigint();
      const nameRaw = command?.name;
      const operation =
        typeof nameRaw === 'string'
          ? nameRaw.toLowerCase()
          : typeof nameRaw?.toLowerCase === 'function'
            ? nameRaw.toLowerCase()
            : 'unknown';

      const result = originalSendCommand(command as never, ...(rest as never[]));
      const finish = () => {
        const seconds = Number(process.hrtime.bigint() - start) / 1e9;
        observeRedisOperation(operation, seconds);
      };

      if (result && typeof (result as Promise<unknown>).then === 'function') {
        return (result as Promise<unknown>).finally(finish);
      }
      finish();
      return result;
    }) as typeof redis.sendCommand;
  }

  return redis;
}

export type RedisCheckResult = {
  ok: boolean;
  latencyMs: number;
};

export async function checkRedisDetailed(redis: Redis): Promise<RedisCheckResult> {
  const start = process.hrtime.bigint();
  try {
    if (redis.status !== 'ready') {
      await redis.connect();
    }
    const result = await redis.ping();
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    return {
      ok: result === 'PONG',
      latencyMs: Math.round(latencyMs * 100) / 100,
    };
  } catch {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    return { ok: false, latencyMs: Math.round(latencyMs * 100) / 100 };
  }
}

export async function checkRedis(redis: Redis): Promise<boolean> {
  const result = await checkRedisDetailed(redis);
  return result.ok;
}
