import { describe, expect, it, vi, beforeEach } from 'vitest';

type QueryExt = {
  name?: string;
  query?: {
    $allModels?: {
      $allOperations?: (args: {
        model: string;
        operation: string;
        args: unknown;
        query: (a: unknown) => Promise<unknown>;
      }) => Promise<unknown>;
    };
    $queryRaw?: (args: {
      args: unknown;
      query: (a: unknown) => Promise<unknown>;
    }) => Promise<unknown>;
    $executeRaw?: (args: {
      args: unknown;
      query: (a: unknown) => Promise<unknown>;
    }) => Promise<unknown>;
  };
};

describe('prisma client helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.ENCRYPTION_KEYS = `test:${Buffer.alloc(32, 1).toString('base64')}`;
    process.env.NODE_ENV = 'test';
  });

  it('checkDatabaseDetailed returns ok + latency on success', async () => {
    const queryRaw = vi.fn().mockResolvedValue(1);
    const observeDbQuery = vi.fn();
    const extensions: QueryExt[] = [];

    vi.doMock('@prisma/client', () => ({
      PrismaClient: class {
        $queryRaw = queryRaw;
        $extends(ext: QueryExt) {
          extensions.push(ext);
          return this;
        }
      },
      Prisma: { defineExtension: (ext: unknown) => ext },
    }));
    vi.doMock('../telemetry/metrics.js', () => ({ observeDbQuery }));
    vi.doMock('../security/encryption.js', () => ({
      createEncryptionService: () => ({}),
    }));
    vi.doMock('../security/prisma-encryption.js', () => ({
      encryptionExtension: () => ({ name: 'field-encryption' }),
    }));
    vi.doMock('../security/audit.js', () => ({
      auditImmutabilityExtension: () => ({ name: 'audit-immutability' }),
    }));

    const mod = await import('./prisma.js');
    const detailed = await mod.checkDatabaseDetailed();
    expect(detailed.ok).toBe(true);
    expect(detailed.latencyMs).toBeGreaterThanOrEqual(0);
    await expect(mod.checkDatabase()).resolves.toBe(true);
  });

  it('checkDatabaseDetailed returns ok=false when query fails', async () => {
    const queryRaw = vi.fn().mockRejectedValue(new Error('down'));
    vi.doMock('@prisma/client', () => ({
      PrismaClient: class {
        $queryRaw = queryRaw;
        $extends() {
          return this;
        }
      },
      Prisma: { defineExtension: (ext: unknown) => ext },
    }));
    vi.doMock('../telemetry/metrics.js', () => ({ observeDbQuery: vi.fn() }));
    vi.doMock('../security/encryption.js', () => ({
      createEncryptionService: () => ({}),
    }));
    vi.doMock('../security/prisma-encryption.js', () => ({
      encryptionExtension: () => ({}),
    }));
    vi.doMock('../security/audit.js', () => ({
      auditImmutabilityExtension: () => ({}),
    }));

    const mod = await import('./prisma.js');
    const detailed = await mod.checkDatabaseDetailed();
    expect(detailed.ok).toBe(false);
    expect(detailed.latencyMs).toBeGreaterThanOrEqual(0);
    await expect(mod.checkDatabase()).resolves.toBe(false);
  });

  it('auto-generates ENCRYPTION_KEYS when missing in non-production', async () => {
    delete process.env.ENCRYPTION_KEYS;
    process.env.NODE_ENV = 'development';

    vi.doMock('@prisma/client', () => ({
      PrismaClient: class {
        $queryRaw = vi.fn();
        $extends() {
          return this;
        }
      },
      Prisma: { defineExtension: (ext: unknown) => ext },
    }));
    vi.doMock('../telemetry/metrics.js', () => ({ observeDbQuery: vi.fn() }));
    vi.doMock('../security/encryption.js', () => ({
      createEncryptionService: (keys: string) => {
        expect(keys.startsWith('auto:')).toBe(true);
        return {};
      },
    }));
    vi.doMock('../security/prisma-encryption.js', () => ({
      encryptionExtension: () => ({}),
    }));
    vi.doMock('../security/audit.js', () => ({
      auditImmutabilityExtension: () => ({}),
    }));

    await import('./prisma.js');
    expect(process.env.ENCRYPTION_KEYS ?? '').toMatch(/^auto:/);
  });

  it('throws when ENCRYPTION_KEYS missing in production', async () => {
    delete process.env.ENCRYPTION_KEYS;
    process.env.NODE_ENV = 'production';

    vi.doMock('@prisma/client', () => ({
      PrismaClient: class {
        $extends() {
          return this;
        }
      },
      Prisma: { defineExtension: (ext: unknown) => ext },
    }));
    vi.doMock('../telemetry/metrics.js', () => ({ observeDbQuery: vi.fn() }));
    vi.doMock('../security/encryption.js', () => ({
      createEncryptionService: () => ({}),
    }));
    vi.doMock('../security/prisma-encryption.js', () => ({
      encryptionExtension: () => ({}),
    }));
    vi.doMock('../security/audit.js', () => ({
      auditImmutabilityExtension: () => ({}),
    }));

    await expect(import('./prisma.js')).rejects.toThrow(/ENCRYPTION_KEYS is required/);
  });

  it('applies audit immutability extension in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ENCRYPTION_KEYS = `prod:${Buffer.alloc(32, 9).toString('base64')}`;
    const auditExt = vi.fn(() => ({ name: 'audit-immutability' }));
    const extensions: QueryExt[] = [];

    vi.doMock('@prisma/client', () => ({
      PrismaClient: class {
        $extends(ext: QueryExt) {
          extensions.push(ext);
          return this;
        }
      },
      Prisma: { defineExtension: (ext: unknown) => ext },
    }));
    vi.doMock('../telemetry/metrics.js', () => ({ observeDbQuery: vi.fn() }));
    vi.doMock('../security/encryption.js', () => ({
      createEncryptionService: () => ({}),
    }));
    vi.doMock('../security/prisma-encryption.js', () => ({
      encryptionExtension: () => ({ name: 'field-encryption' }),
    }));
    vi.doMock('../security/audit.js', () => ({
      auditImmutabilityExtension: auditExt,
    }));

    await import('./prisma.js');
    expect(auditExt).toHaveBeenCalled();
    expect(extensions.some((e) => e.name === 'audit-immutability')).toBe(true);
  });

  it('records metrics for $allOperations, $queryRaw, and $executeRaw', async () => {
    const observeDbQuery = vi.fn();
    const extensions: QueryExt[] = [];

    vi.doMock('@prisma/client', () => ({
      PrismaClient: class {
        $queryRaw = vi.fn();
        $extends(ext: QueryExt) {
          extensions.push(ext);
          return this;
        }
      },
      Prisma: { defineExtension: (ext: unknown) => ext },
    }));
    vi.doMock('../telemetry/metrics.js', () => ({ observeDbQuery }));
    vi.doMock('../security/encryption.js', () => ({
      createEncryptionService: () => ({}),
    }));
    vi.doMock('../security/prisma-encryption.js', () => ({
      encryptionExtension: () => ({ name: 'enc' }),
    }));
    vi.doMock('../security/audit.js', () => ({
      auditImmutabilityExtension: () => ({ name: 'imm' }),
    }));

    await import('./prisma.js');
    const metrics = extensions.find((e) => e.name === 'cognistream-db-metrics');
    expect(metrics?.query).toBeDefined();

    const query = vi.fn().mockResolvedValue('ok');
    await metrics!.query!.$allModels!.$allOperations!({
      model: 'Agent',
      operation: 'findMany',
      args: {},
      query,
    });
    expect(observeDbQuery).toHaveBeenCalledWith('findMany', 'Agent', expect.any(Number));

    await metrics!.query!.$queryRaw!({ args: {}, query });
    expect(observeDbQuery).toHaveBeenCalledWith('$queryRaw', 'raw', expect.any(Number));

    await metrics!.query!.$executeRaw!({ args: {}, query });
    expect(observeDbQuery).toHaveBeenCalledWith('$executeRaw', 'raw', expect.any(Number));
  });
});
