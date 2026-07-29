import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { randomBytes } from 'node:crypto';
import {
  AuditImmutableError,
  AuditTrail,
  computeIntegrityHash,
  enqueueAudit,
  GENESIS_HASH,
  parseAuditHmacKey,
  startAuditWorker,
  AUDIT_QUEUE_KEY,
} from './audit.js';
import { createId } from '../lib/uuid.js';

const hmacKey = randomBytes(32);

function mockPrisma(store: Array<Record<string, unknown>> = []) {
  return {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        auditLog: {
          findFirst: vi.fn(async () => {
            if (store.length === 0) return null;
            return store[store.length - 1];
          }),
          create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
            store.push(data);
            return data;
          }),
          findMany: vi.fn(async () => store),
          update: vi.fn(),
          delete: vi.fn(),
        },
      };
      return fn(tx);
    }),
    auditLog: {
      findMany: vi.fn(async () => store),
      create: vi.fn(),
      update: vi.fn(async () => {
        throw new AuditImmutableError('update');
      }),
      delete: vi.fn(async () => {
        throw new AuditImmutableError('delete');
      }),
    },
  };
}

describe('parseAuditHmacKey', () => {
  it('accepts 32+ byte keys', () => {
    expect(parseAuditHmacKey(hmacKey.toString('base64')).length).toBe(32);
  });

  it('rejects short keys', () => {
    expect(() => parseAuditHmacKey(Buffer.from('short').toString('base64'))).toThrow(
      /at least 32/,
    );
  });
});

describe('computeIntegrityHash', () => {
  it('is deterministic and depends on previous hash', () => {
    const a = computeIntegrityHash(hmacKey, null, '{"x":1}', '2026-01-01T00:00:00.000Z');
    const b = computeIntegrityHash(hmacKey, null, '{"x":1}', '2026-01-01T00:00:00.000Z');
    const c = computeIntegrityHash(hmacKey, 'other', '{"x":1}', '2026-01-01T00:00:00.000Z');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('uses GENESIS when previous is null', () => {
    const withNull = computeIntegrityHash(hmacKey, null, 'p', 't');
    const withGenesis = computeIntegrityHash(hmacKey, GENESIS_HASH, 'p', 't');
    expect(withNull).toBe(withGenesis);
  });
});

describe('AuditTrail', () => {
  it('chains integrity hashes across appends', async () => {
    const store: Array<Record<string, unknown>> = [];
    const prisma = mockPrisma(store);
    const trail = new AuditTrail(prisma as never, hmacKey);

    const t1 = new Date('2026-07-29T00:00:00.000Z');
    const t2 = new Date('2026-07-29T00:00:01.000Z');

    const first = await trail.append({
      id: createId(),
      action: 'agent.created',
      entityType: 'agent',
      entityId: createId(),
      actorType: 'api_key',
      result: 'success',
      createdAt: t1,
    });
    const second = await trail.append({
      id: createId(),
      action: 'transaction.created',
      entityType: 'transaction',
      entityId: createId(),
      actorType: 'api_key',
      result: 'success',
      createdAt: t2,
    });

    expect(first.previousHash).toBeNull();
    expect(second.previousHash).toBe(first.integrityHash);
    expect(second.integrityHash).not.toBe(first.integrityHash);
  });

  it('validateChain detects tampering', async () => {
    const store: Array<Record<string, unknown>> = [];
    const prisma = mockPrisma(store);
    const trail = new AuditTrail(prisma as never, hmacKey);

    await trail.append({
      id: createId(),
      action: 'a',
      entityType: 'agent',
      entityId: createId(),
      actorType: 'system',
      result: 'success',
      createdAt: new Date('2026-07-29T00:00:00.000Z'),
    });
    await trail.append({
      id: createId(),
      action: 'b',
      entityType: 'agent',
      entityId: createId(),
      actorType: 'system',
      result: 'success',
      createdAt: new Date('2026-07-29T00:00:01.000Z'),
    });

    const ok = await trail.validateChain();
    expect(ok.valid).toBe(true);
    expect(ok.checked).toBe(2);

    // Tamper with stored payload hash
    store[1]!.integrityHash = '0'.repeat(64);
    const bad = await trail.validateChain();
    expect(bad.valid).toBe(false);
    expect(bad.reason).toMatch(/integrityHash/);
  });

  it('exposes no update/delete helpers on AuditTrail', () => {
    const trail = new AuditTrail(mockPrisma() as never, hmacKey);
    expect('update' in trail).toBe(false);
    expect('delete' in trail).toBe(false);
    expect(typeof trail.append).toBe('function');
  });
});

describe('enqueueAudit + worker (async)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('enqueues without awaiting DB append', async () => {
    const pushed: string[] = [];
    const redis = {
      lpush: vi.fn(async (_key: string, value: string) => {
        pushed.push(value);
        return 1;
      }),
    };

    const start = Date.now();
    const id = await enqueueAudit(redis as never, {
      action: 'api_key.created',
      entityType: 'api_key',
      entityId: createId(),
      actorType: 'api_key',
      result: 'success',
    });
    const elapsed = Date.now() - start;

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(pushed).toHaveLength(1);
    expect(JSON.parse(pushed[0]!)).toMatchObject({
      id,
      action: 'api_key.created',
    });
    expect(elapsed).toBeLessThan(50);
    expect(redis.lpush).toHaveBeenCalledWith(AUDIT_QUEUE_KEY, expect.any(String));
  });

  it('worker drains queue into AuditTrail.append', async () => {
    vi.useRealTimers();
    const store: Array<Record<string, unknown>> = [];
    const trail = new AuditTrail(mockPrisma(store) as never, hmacKey);

    const entityId = createId();
    const queue: string[] = [
      JSON.stringify({
        id: createId(),
        action: 'escrow.released',
        entityType: 'escrow',
        entityId,
        actorType: 'system',
        result: 'success',
        createdAt: new Date().toISOString(),
      }),
    ];

    let polls = 0;
    const redis = {
      status: 'ready' as const,
      connect: vi.fn(),
      brpop: vi.fn(async () => {
        polls += 1;
        if (queue.length > 0) {
          return [AUDIT_QUEUE_KEY, queue.shift()!] as [string, string];
        }
        if (polls > 3) {
          await new Promise((r) => setTimeout(r, 10));
        }
        return null;
      }),
    };

    const logger = { error: vi.fn() };
    const worker = startAuditWorker({
      redis: redis as never,
      trail,
      logger: logger as never,
      pollTimeoutSeconds: 1,
    });

    await vi.waitFor(() => {
      expect(store.length).toBeGreaterThanOrEqual(1);
    });

    await worker.stop();
    expect(store[0]).toMatchObject({
      action: 'escrow.released',
      entityId,
    });
  });
});
