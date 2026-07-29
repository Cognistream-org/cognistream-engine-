import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma, type AuditLog, type PrismaClient } from '@prisma/client';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { createId } from '../lib/uuid.js';

export const AUDIT_QUEUE_KEY = 'cognistream:audit:queue';
export const GENESIS_HASH = 'GENESIS';

export type AuditActorType = 'system' | 'api_key' | 'agent' | 'user';
export type AuditResult = 'success' | 'failure';

export type AuditEntryInput = {
  /** Optional fixed id (async queue / tests). */
  id?: string;
  orgId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: unknown;
  actorType: AuditActorType;
  actorId?: string | null;
  changes?: unknown;
  result: AuditResult;
  ipAddress?: string | null;
  userAgent?: string | null;
  /** Optional fixed timestamp (tests). */
  createdAt?: Date;
};

export type QueuedAuditEntry = Omit<AuditEntryInput, 'id' | 'createdAt'> & {
  id: string;
  createdAt: string;
};

export class AuditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuditError';
  }
}

export class AuditImmutableError extends AuditError {
  constructor(operation: string) {
    super(`Audit log is append-only; ${operation} is forbidden`);
    this.name = 'AuditImmutableError';
  }
}

function canonicalPayload(entry: {
  id: string;
  orgId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  actorType: string;
  actorId: string | null;
  changes: unknown;
  result: string;
  ipAddress: string | null;
  userAgent: string | null;
}): string {
  return JSON.stringify({
    id: entry.id,
    orgId: entry.orgId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata ?? {},
    actorType: entry.actorType,
    actorId: entry.actorId,
    changes: entry.changes ?? {},
    result: entry.result,
    ipAddress: entry.ipAddress,
    userAgent: entry.userAgent,
  });
}

export function computeIntegrityHash(
  hmacKey: Buffer,
  previousHash: string | null,
  payload: string,
  timestampIso: string,
): string {
  const prev = previousHash ?? GENESIS_HASH;
  return createHmac('sha256', hmacKey)
    .update(prev)
    .update('\n')
    .update(payload)
    .update('\n')
    .update(timestampIso)
    .digest('hex');
}

export function parseAuditHmacKey(raw: string): Buffer {
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.length < 32) {
    throw new AuditError('AUDIT_HMAC_KEY must decode to at least 32 bytes');
  }
  return key;
}

type AuditDb = {
  auditLog: {
    findFirst: PrismaClient['auditLog']['findFirst'];
    create: PrismaClient['auditLog']['create'];
  };
};

/**
 * Append-only audit writer. No update/delete APIs.
 */
export class AuditTrail {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly hmacKey: Buffer,
  ) {}

  /** Synchronous append (used by worker and tests). */
  async append(input: AuditEntryInput): Promise<AuditLog> {
    return this.prisma.$transaction(async (tx) => this.appendWithClient(tx, input));
  }

  /**
   * Append inside an existing interactive transaction (e.g. escrow refund).
   * Prefer {@link enqueueAudit} for HTTP request paths.
   */
  async appendWithClient(tx: AuditDb, input: AuditEntryInput): Promise<AuditLog> {
    const id = input.id ?? createId();
    const createdAt = input.createdAt ?? new Date();
    const timestampIso = createdAt.toISOString();

    const latest = await tx.auditLog.findFirst({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { integrityHash: true },
    });
    const previousHash = latest?.integrityHash ?? null;

    const payload = canonicalPayload({
      id,
      orgId: input.orgId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata ?? {},
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      changes: input.changes ?? {},
      result: input.result,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    });

    const integrityHash = computeIntegrityHash(
      this.hmacKey,
      previousHash,
      payload,
      timestampIso,
    );

    return tx.auditLog.create({
      data: {
        id,
        orgId: input.orgId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: (input.metadata ?? {}) as object,
        integrityHash,
        previousHash,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        changes: (input.changes ?? {}) as object,
        result: input.result,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        createdAt,
      },
    });
  }

  async validateChain(): Promise<{
    valid: boolean;
    checked: number;
    brokenAtId?: string;
    reason?: string;
  }> {
    const entries = await this.prisma.auditLog.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        orgId: true,
        action: true,
        entityType: true,
        entityId: true,
        metadata: true,
        integrityHash: true,
        previousHash: true,
        actorType: true,
        actorId: true,
        changes: true,
        result: true,
        ipAddress: true,
        userAgent: true,
        createdAt: true,
      },
    });

    let expectedPrevious: string | null = null;
    let checked = 0;

    for (const entry of entries) {
      if (entry.integrityHash === 'legacy-unhashed') {
        expectedPrevious = entry.integrityHash;
        checked += 1;
        continue;
      }

      if (entry.previousHash !== expectedPrevious) {
        return {
          valid: false,
          checked,
          brokenAtId: entry.id,
          reason: 'previousHash mismatch',
        };
      }

      const payload = canonicalPayload({
        id: entry.id,
        orgId: entry.orgId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        metadata: entry.metadata,
        actorType: entry.actorType,
        actorId: entry.actorId,
        changes: entry.changes,
        result: entry.result,
        ipAddress: entry.ipAddress,
        userAgent: entry.userAgent,
      });

      const expected = computeIntegrityHash(
        this.hmacKey,
        entry.previousHash,
        payload,
        entry.createdAt.toISOString(),
      );

      const a = Buffer.from(expected, 'utf8');
      const b = Buffer.from(entry.integrityHash, 'utf8');
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        return {
          valid: false,
          checked,
          brokenAtId: entry.id,
          reason: 'integrityHash mismatch',
        };
      }

      expectedPrevious = entry.integrityHash;
      checked += 1;
    }

    return { valid: true, checked };
  }
}

/** Enqueue audit entry for async processing — never blocks on DB write. */
export async function enqueueAudit(
  redis: Redis,
  input: AuditEntryInput,
): Promise<string> {
  const id = input.id ?? createId();
  const queued: QueuedAuditEntry = {
    ...input,
    id,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
  };
  await redis.lpush(AUDIT_QUEUE_KEY, JSON.stringify(queued));
  return id;
}

export type AuditWorkerHandle = {
  stop: () => Promise<void>;
};

/**
 * Background worker: BRPOP audit queue and append to DB.
 */
export function startAuditWorker(options: {
  redis: Redis;
  trail: AuditTrail;
  logger: Logger;
  pollTimeoutSeconds?: number;
}): AuditWorkerHandle {
  const { redis, trail, logger } = options;
  const pollTimeoutSeconds = options.pollTimeoutSeconds ?? 2;
  let running = true;
  let current: Promise<void> | null = null;

  const loop = async (): Promise<void> => {
    while (running) {
      try {
        if (redis.status !== 'ready') {
          await redis.connect();
        }
        const result = await redis.brpop(AUDIT_QUEUE_KEY, pollTimeoutSeconds);
        if (!result) continue;

        const [, raw] = result;
        const queued = JSON.parse(raw) as QueuedAuditEntry;
        await trail.append({
          id: queued.id,
          orgId: queued.orgId,
          action: queued.action,
          entityType: queued.entityType,
          entityId: queued.entityId,
          metadata: queued.metadata,
          actorType: queued.actorType,
          actorId: queued.actorId,
          changes: queued.changes,
          result: queued.result,
          ipAddress: queued.ipAddress,
          userAgent: queued.userAgent,
          createdAt: new Date(queued.createdAt),
        });
      } catch (error) {
        if (!running) break;
        logger.error({ err: error }, 'Audit worker iteration failed');
        await new Promise((r) => setTimeout(r, 250));
      }
    }
  };

  current = loop();

  return {
    stop: async () => {
      running = false;
      await current;
    },
  };
}

/** Guard: reject update/delete on AuditLog via Prisma extension. */
export function auditImmutabilityExtension() {
  return Prisma.defineExtension({
    name: 'audit-immutability',
    query: {
      auditLog: {
        async update() {
          throw new AuditImmutableError('update');
        },
        async updateMany() {
          throw new AuditImmutableError('updateMany');
        },
        async delete() {
          throw new AuditImmutableError('delete');
        },
        async deleteMany() {
          throw new AuditImmutableError('deleteMany');
        },
      },
    },
  });
}
