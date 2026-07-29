import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import type { Logger } from 'pino';
import type { Redis } from 'ioredis';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        auditLog: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn(async ({ data }: { data: unknown }) => data),
        },
      };
      return fn(tx);
    }),
    auditLog: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import {
  initAuditRuntime,
  getAuditTrail,
  recordAudit,
  stopAuditRuntime,
} from './audit-runtime.js';
import { AUDIT_QUEUE_KEY } from './audit.js';

function mockLogger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function mockRedis(overrides: Partial<Redis> = {}): Redis {
  return {
    status: 'ready',
    lpush: vi.fn().mockResolvedValue(1),
    brpop: vi.fn().mockResolvedValue(null),
    connect: vi.fn(),
    ...overrides,
  } as unknown as Redis;
}

describe('audit-runtime', () => {
  const hmacKey = randomBytes(32).toString('base64');
  const logger = mockLogger();

  const sample = {
    action: 'test.action',
    actorType: 'system' as const,
    actorId: 'sys',
    entityType: 'test',
    entityId: '1',
    metadata: {},
    result: 'success' as const,
  };

  beforeEach(async () => {
    await stopAuditRuntime();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await stopAuditRuntime();
  });

  it('throws when getAuditTrail is called before init', () => {
    expect(() => getAuditTrail()).toThrow(/not initialized/i);
  });

  it('initAuditRuntime returns a trail and getAuditTrail works', () => {
    const redis = mockRedis();
    const trail = initAuditRuntime({
      redis,
      auditHmacKey: hmacKey,
      logger,
      startWorker: false,
    });

    expect(trail).toBeDefined();
    expect(getAuditTrail()).toBe(trail);
  });

  it('starts a background worker by default', async () => {
    const redis = mockRedis({
      brpop: vi.fn().mockResolvedValue(null),
    });

    initAuditRuntime({
      redis,
      auditHmacKey: hmacKey,
      logger,
      // startWorker defaults to true
    });

    expect(getAuditTrail()).toBeDefined();
    await stopAuditRuntime();
  });

  it('recordAudit enqueues when redis runtime is available', async () => {
    const redis = mockRedis({
      lpush: vi.fn().mockResolvedValue(1),
    });

    initAuditRuntime({
      redis,
      auditHmacKey: hmacKey,
      logger,
      startWorker: false,
    });

    await recordAudit(sample);

    expect(redis.lpush).toHaveBeenCalledWith(AUDIT_QUEUE_KEY, expect.any(String));
  });

  it('recordAudit falls back to sync append when redis is falsy', async () => {
    const appendSpy = vi.fn().mockResolvedValue({});
    const redis = null as unknown as Redis;

    // init with null redis → runtime.redis is falsy, trail path is used
    const trail = initAuditRuntime({
      redis,
      auditHmacKey: hmacKey,
      logger,
      startWorker: false,
    });
    vi.spyOn(trail, 'append').mockImplementation(appendSpy);

    await recordAudit(sample);
    expect(appendSpy).toHaveBeenCalledWith(sample);
  });

  it('recordAudit is a no-op when runtime is not initialized', async () => {
    await expect(recordAudit(sample)).resolves.toBeUndefined();
  });

  it('stopAuditRuntime clears runtime so getAuditTrail throws', async () => {
    initAuditRuntime({
      redis: mockRedis(),
      auditHmacKey: hmacKey,
      logger,
      startWorker: false,
    });

    await stopAuditRuntime();
    expect(() => getAuditTrail()).toThrow(/not initialized/i);
  });

  it('stopAuditRuntime stops an active worker', async () => {
    const redis = mockRedis({
      brpop: vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
        return null;
      }),
    });

    initAuditRuntime({
      redis,
      auditHmacKey: hmacKey,
      logger,
      startWorker: true,
    });

    await stopAuditRuntime();
    expect(() => getAuditTrail()).toThrow(/not initialized/i);
  });

  it('rejects invalid AUDIT_HMAC_KEY on init', () => {
    expect(() =>
      initAuditRuntime({
        redis: mockRedis(),
        auditHmacKey: Buffer.from('short').toString('base64'),
        logger,
        startWorker: false,
      }),
    ).toThrow(/at least 32/);
  });
});
