import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import {
  AuditTrail,
  enqueueAudit,
  parseAuditHmacKey,
  startAuditWorker,
  type AuditEntryInput,
  type AuditWorkerHandle,
} from './audit.js';
import { prisma } from '../lib/prisma.js';

type AuditRuntime = {
  redis: Redis;
  trail: AuditTrail;
  logger: Logger;
  worker: AuditWorkerHandle | null;
};

let runtime: AuditRuntime | null = null;

export function initAuditRuntime(options: {
  redis: Redis;
  auditHmacKey: string;
  logger: Logger;
  startWorker?: boolean;
}): AuditTrail {
  const trail = new AuditTrail(prisma, parseAuditHmacKey(options.auditHmacKey));
  const worker =
    options.startWorker === false
      ? null
      : startAuditWorker({
          redis: options.redis,
          trail,
          logger: options.logger,
        });

  runtime = {
    redis: options.redis,
    trail,
    logger: options.logger,
    worker,
  };
  return trail;
}

export function getAuditTrail(): AuditTrail {
  if (!runtime) {
    throw new Error('Audit runtime not initialized');
  }
  return runtime.trail;
}

/**
 * Non-blocking audit for HTTP paths: push to Redis queue.
 * Falls back to sync append when runtime is unavailable (tests).
 */
export async function recordAudit(input: AuditEntryInput): Promise<void> {
  if (runtime?.redis) {
    await enqueueAudit(runtime.redis, input);
    return;
  }
  if (runtime?.trail) {
    await runtime.trail.append(input);
    return;
  }
  // Best-effort no-op outside initialized app (unit tests without runtime)
}

export async function stopAuditRuntime(): Promise<void> {
  if (runtime?.worker) {
    await runtime.worker.stop();
  }
  runtime = null;
}
