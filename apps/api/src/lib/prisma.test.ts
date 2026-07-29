import { describe, expect, it, vi, beforeEach } from 'vitest';

describe('checkDatabase', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEYS = `test:${Buffer.alloc(32, 1).toString('base64')}`;
    process.env.NODE_ENV = 'test';
  });

  it('returns true when query succeeds and false when it fails', async () => {
    vi.resetModules();
    const queryRaw = vi.fn().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('down'));
    vi.doMock('@prisma/client', () => {
      class MockPrismaClient {
        $queryRaw = queryRaw;
        $extends() {
          return this;
        }
      }
      return {
        PrismaClient: MockPrismaClient,
        Prisma: { defineExtension: (ext: unknown) => ext },
      };
    });
    vi.doMock('../telemetry/metrics.js', () => ({
      observeDbQuery: vi.fn(),
    }));
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
    await expect(mod.checkDatabase()).resolves.toBe(true);
    await expect(mod.checkDatabase()).resolves.toBe(false);
  });
});
