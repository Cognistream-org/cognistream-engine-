import { afterEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import type { Env } from './config.js';

const quit = vi.fn();
const disconnect = vi.fn();
let redisStatus = 'ready';

vi.mock('./lib/prisma.js', () => ({
  prisma: { $queryRaw: vi.fn(), $disconnect: vi.fn() },
  checkDatabase: vi.fn(),
  checkDatabaseDetailed: vi.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
}));

vi.mock('./lib/redis.js', () => ({
  createRedisClient: vi.fn(() => ({
    get status() {
      return redisStatus;
    },
    quit,
    disconnect,
    on: vi.fn(),
    sendCommand: vi.fn(),
  })),
  checkRedis: vi.fn(),
  checkRedisDetailed: vi.fn().mockResolvedValue({ ok: true, latencyMs: 1 }),
}));

import { buildApp } from './app.js';

const env: Env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  API_HOST: '127.0.0.1',
  API_PORT: 3001,
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  OTEL_ENABLED: false,
  OTEL_SERVICE_NAME: 'cognistream-api-test',
  METRICS_IP_ALLOWLIST: ['127.0.0.1'],
  APP_VERSION: '0.1.0-test',
};

describe('buildApp redis onClose', () => {
  afterEach(() => {
    vi.clearAllMocks();
    redisStatus = 'ready';
  });

  it('quits redis when ready', async () => {
    redisStatus = 'ready';
    quit.mockResolvedValue('OK');
    const app = await buildApp(env, pino({ level: 'silent' }));
    await app.close();
    expect(quit).toHaveBeenCalled();
  });

  it('disconnects redis when not ready', async () => {
    redisStatus = 'wait';
    const app = await buildApp(env, pino({ level: 'silent' }));
    await app.close();
    expect(disconnect).toHaveBeenCalled();
  });

  it('falls back to disconnect when quit throws', async () => {
    redisStatus = 'ready';
    quit.mockRejectedValue(new Error('quit failed'));
    const app = await buildApp(env, pino({ level: 'silent' }));
    await app.close();
    expect(disconnect).toHaveBeenCalled();
  });
});
