import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { observeDbQuery } from '../telemetry/metrics.js';
import { createEncryptionService } from '../security/encryption.js';
import { encryptionExtension } from '../security/prisma-encryption.js';
import { auditImmutabilityExtension } from '../security/audit.js';

function resolveEncryptionKeys(): string {
  if (process.env.ENCRYPTION_KEYS) {
    return process.env.ENCRYPTION_KEYS;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('ENCRYPTION_KEYS is required to initialize Prisma');
  }
  const generated = `auto:${randomBytes(32).toString('base64')}`;
  process.env.ENCRYPTION_KEYS = generated;
  return generated;
}

function createPrismaClient(): PrismaClient {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  const encryption = createEncryptionService(resolveEncryptionKeys());
  let client = base
    .$extends(encryptionExtension(encryption))
    .$extends({
      name: 'cognistream-db-metrics',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const start = process.hrtime.bigint();
            try {
              return await query(args);
            } finally {
              const elapsedNs = process.hrtime.bigint() - start;
              const seconds = Number(elapsedNs) / 1e9;
              observeDbQuery(operation, model ?? 'raw', seconds);
            }
          },
        },
        async $queryRaw({ args, query }) {
          const start = process.hrtime.bigint();
          try {
            return await query(args);
          } finally {
            const elapsedNs = process.hrtime.bigint() - start;
            observeDbQuery('$queryRaw', 'raw', Number(elapsedNs) / 1e9);
          }
        },
        async $executeRaw({ args, query }) {
          const start = process.hrtime.bigint();
          try {
            return await query(args);
          } finally {
            const elapsedNs = process.hrtime.bigint() - start;
            observeDbQuery('$executeRaw', 'raw', Number(elapsedNs) / 1e9);
          }
        },
      },
    });

  if (process.env.NODE_ENV === 'production') {
    client = client.$extends(auditImmutabilityExtension());
  }

  return client as unknown as PrismaClient;
}

export const prisma = createPrismaClient();

export type DatabaseCheckResult = {
  ok: boolean;
  latencyMs: number;
};

export async function checkDatabaseDetailed(): Promise<DatabaseCheckResult> {
  const start = process.hrtime.bigint();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    return { ok: true, latencyMs: Math.round(latencyMs * 100) / 100 };
  } catch {
    const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
    return { ok: false, latencyMs: Math.round(latencyMs * 100) / 100 };
  }
}

export async function checkDatabase(): Promise<boolean> {
  const result = await checkDatabaseDetailed();
  return result.ok;
}
