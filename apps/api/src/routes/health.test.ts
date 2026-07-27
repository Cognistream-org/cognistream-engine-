import { describe, expect, it, vi, beforeEach } from 'vitest';
import pino from 'pino';
import type { Env } from '../config.js';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: vi.fn(),
    $disconnect: vi.fn(),
  },
  checkDatabase: vi.fn(),
  checkDatabaseDetailed: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({
  createRedisClient: vi.fn(() => ({
    status: 'ready',
    quit: vi.fn(),
    on: vi.fn(),
    sendCommand: vi.fn(),
  })),
  checkRedis: vi.fn(),
  checkRedisDetailed: vi.fn(),
}));

import { buildApp } from '../app.js';
import { checkDatabaseDetailed } from '../lib/prisma.js';
import { checkRedisDetailed } from '../lib/redis.js';

const env: Env = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  API_HOST: '127.0.0.1',
  API_PORT: 3001,
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  OTEL_ENABLED: false,
  OTEL_SERVICE_NAME: 'cognistream-api-test',
  METRICS_IP_ALLOWLIST: ['127.0.0.1', '::1'],
  APP_VERSION: '0.1.0-test',
};

describe('health endpoints v2', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /health is liveness-only (no dependency checks)', async () => {
    const app = await buildApp(env, pino({ level: 'silent' }));
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      checks: {},
      version: '0.1.0-test',
    });
    expect(typeof response.json().uptime).toBe('number');
    expect(checkDatabaseDetailed).not.toHaveBeenCalled();
    expect(checkRedisDetailed).not.toHaveBeenCalled();

    await app.close();
  });

  it('GET /health/ready returns 200 when database and redis are up', async () => {
    vi.mocked(checkDatabaseDetailed).mockResolvedValue({ ok: true, latencyMs: 1.2 });
    vi.mocked(checkRedisDetailed).mockResolvedValue({ ok: true, latencyMs: 0.4 });

    const app = await buildApp(env, pino({ level: 'silent' }));
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: 'ok',
      checks: {
        database: { status: 'up' },
        redis: { status: 'up' },
      },
      version: '0.1.0-test',
    });

    await app.close();
  });

  it('GET /health/ready returns 503 when a dependency is down', async () => {
    vi.mocked(checkDatabaseDetailed).mockResolvedValue({ ok: true, latencyMs: 1 });
    vi.mocked(checkRedisDetailed).mockResolvedValue({ ok: false, latencyMs: 5 });

    const app = await buildApp(env, pino({ level: 'silent' }));
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'degraded',
      checks: {
        database: { status: 'up' },
        redis: { status: 'down' },
      },
    });

    await app.close();
  });

  it('GET /health/ready returns error when both dependencies are down', async () => {
    vi.mocked(checkDatabaseDetailed).mockResolvedValue({ ok: false, latencyMs: 2 });
    vi.mocked(checkRedisDetailed).mockResolvedValue({ ok: false, latencyMs: 3 });

    const app = await buildApp(env, pino({ level: 'silent' }));
    const response = await app.inject({ method: 'GET', url: '/health/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.json().status).toBe('error');

    await app.close();
  });

  it('GET /health/deep includes disk check', async () => {
    vi.mocked(checkDatabaseDetailed).mockResolvedValue({ ok: true, latencyMs: 1 });
    vi.mocked(checkRedisDetailed).mockResolvedValue({ ok: true, latencyMs: 1 });

    const app = await buildApp(env, pino({ level: 'silent' }));
    const response = await app.inject({ method: 'GET', url: '/health/deep' });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.checks.database.status).toBe('up');
    expect(body.checks.redis.status).toBe('up');
    expect(body.checks.disk.status).toBe('up');

    await app.close();
  });

  it('GET /health/deep returns 503 on timeout', async () => {
    vi.mocked(checkDatabaseDetailed).mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true, latencyMs: 1 }), 10_000)),
    );
    vi.mocked(checkRedisDetailed).mockResolvedValue({ ok: true, latencyMs: 1 });

    const app = await buildApp(env, pino({ level: 'silent' }));
    const response = await app.inject({ method: 'GET', url: '/health/deep' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      status: 'error',
      checks: {
        database: { status: 'down' },
        redis: { status: 'down' },
        disk: { status: 'down' },
      },
    });

    await app.close();
  });

  it('GET /health/deep returns 503 when deep checks report down', async () => {
    vi.mocked(checkDatabaseDetailed).mockResolvedValue({ ok: false, latencyMs: 1 });
    vi.mocked(checkRedisDetailed).mockResolvedValue({ ok: true, latencyMs: 1 });

    const app = await buildApp(env, pino({ level: 'silent' }));
    const response = await app.inject({ method: 'GET', url: '/health/deep' });

    expect(response.statusCode).toBe(503);
    expect(['degraded', 'error']).toContain(response.json().status);

    await app.close();
  });
});

describe('GET /metrics', () => {
  it('allows localhost and returns prometheus text', async () => {
    const app = await buildApp(env, pino({ level: 'silent' }));
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '127.0.0.1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('cognistream_transactions_total');
    expect(response.headers['content-type']).toContain('text/plain');

    await app.close();
  });

  it('rejects non-allowlisted IPs', async () => {
    const app = await buildApp(env, pino({ level: 'silent' }));
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '8.8.8.8',
    });

    expect(response.statusCode).toBe(403);

    await app.close();
  });

  it('honors x-forwarded-for string header for allowlisting', async () => {
    const app = await buildApp(env, pino({ level: 'silent' }));
    const allowed = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '8.8.8.8',
      headers: { 'x-forwarded-for': '127.0.0.1, 10.0.0.1' },
    });
    expect(allowed.statusCode).toBe(200);

    const denied = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '127.0.0.1',
      headers: { 'x-forwarded-for': '8.8.8.8' },
    });
    expect(denied.statusCode).toBe(403);

    await app.close();
  });

  it('honors x-forwarded-for array header', async () => {
    const app = await buildApp(env, pino({ level: 'silent' }));
    const response = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '8.8.8.8',
      headers: { 'x-forwarded-for': ['127.0.0.1', '10.0.0.2'] },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('uses default allowlist when METRICS_IP_ALLOWLIST is empty', async () => {
    const app = await buildApp(
      { ...env, METRICS_IP_ALLOWLIST: [] },
      pino({ level: 'silent' }),
    );
    const local = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '127.0.0.1',
    });
    expect(local.statusCode).toBe(200);

    const privateIp = await app.inject({
      method: 'GET',
      url: '/metrics',
      remoteAddress: '10.2.3.4',
    });
    expect(privateIp.statusCode).toBe(200);

    await app.close();
  });
});
