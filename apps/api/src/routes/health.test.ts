import { describe, expect, it, vi, beforeEach } from 'vitest';
import pino from 'pino';
import type { Env } from '../config.js';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $disconnect: vi.fn(),
  },
  checkDatabase: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({
  createRedisClient: vi.fn(() => ({
    status: 'ready',
    quit: vi.fn(),
    on: vi.fn(),
  })),
  checkRedis: vi.fn(),
}));

import { buildApp } from '../app.js';
import { checkDatabase } from '../lib/prisma.js';
import { checkRedis } from '../lib/redis.js';

const env: Env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  API_HOST: '127.0.0.1',
  API_PORT: 3001,
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
};

describe('GET /health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 200 when database and redis are up', async () => {
    vi.mocked(checkDatabase).mockResolvedValue(true);
    vi.mocked(checkRedis).mockResolvedValue(true);

    const app = await buildApp(env, pino({ level: 'silent' }));

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      services: { database: 'up', redis: 'up' },
    });

    await app.close();
  });

  it('returns 503 when a dependency is down', async () => {
    vi.mocked(checkDatabase).mockResolvedValue(true);
    vi.mocked(checkRedis).mockResolvedValue(false);

    const app = await buildApp(env, pino({ level: 'silent' }));

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'degraded',
      services: { database: 'up', redis: 'down' },
    });

    await app.close();
  });
});
