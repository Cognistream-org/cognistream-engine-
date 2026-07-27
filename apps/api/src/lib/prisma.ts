import { PrismaClient } from '@prisma/client';
import { observeDbQuery } from '../telemetry/metrics.js';

function createPrismaClient(): PrismaClient {
  const base = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  return base.$extends({
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
  }) as unknown as PrismaClient;
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
