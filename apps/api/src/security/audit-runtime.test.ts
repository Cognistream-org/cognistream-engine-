import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(),
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

describe('audit-runtime', () => {
  const hmacKey = randomBytes(32).toString('base64');
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as import('pino').Logger;

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
    const redis = {
      lpush: vi.fn(),
      brpop: vi.fn(),
    } as unknown as import('ioredis').Redis;

    const trail = initAuditRuntime({
      redis,
      auditHmacKey: hmacKey,
      logger,
      startWorker: false,
    });

    expect(trail).toBeDefined();
    expect(getAuditTrail()).toBe(trail);
  });

  it('recordAudit enqueues when redis runtime is available', async () => {
    const redis = {
      lpush: vi.fn().mockResolvedValue(1),
      brpop: vi.fn(),
    } as unknown as import('ioredis').Redis;

    initAuditRuntime({
      redis,
      auditHmacKey: hmacKey,
      logger,
      startWorker: false,
    });

    await recordAudit(sample);

    expect(redis.lpush).toHaveBeenCalledWith(
      AUDIT_QUEUE_KEY,
      expect.any(String),
    );
  });

  it('recordAudit is a no-op when runtime is not initialized', async () => {
    await expect(recordAudit(sample)).resolves.toBeUndefined();
  });

  it('stopAuditRuntime clears runtime so getAuditTrail throws', async () => {
    const redis = {
      lpush: vi.fn(),
      brpop: vi.fn(),
    } as unknown as import('ioredis').Redis;

    initAuditRuntime({
      redis,
      auditHmacKey: hmacKey,
      logger,
      startWorker: false,
    });

    await stopAuditRuntime();
    expect(() => getAuditTrail()).toThrow(/not initialized/i);
  });
});