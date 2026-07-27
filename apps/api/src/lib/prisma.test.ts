import { describe, expect, it, vi } from 'vitest';

describe('checkDatabase', () => {
  it('returns true when query succeeds and false when it fails', async () => {
    vi.resetModules();
    const queryRaw = vi.fn().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('down'));
    vi.doMock('@prisma/client', () => ({
      PrismaClient: class {
        $queryRaw = queryRaw;
        $extends() {
          return this;
        }
      },
    }));
    vi.doMock('../telemetry/metrics.js', () => ({
      observeDbQuery: vi.fn(),
    }));
    const mod = await import('./prisma.js');
    await expect(mod.checkDatabase()).resolves.toBe(true);
    await expect(mod.checkDatabase()).resolves.toBe(false);
  });
});
