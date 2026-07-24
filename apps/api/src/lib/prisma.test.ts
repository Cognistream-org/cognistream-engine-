import { describe, expect, it, vi } from 'vitest';

describe('checkDatabase', () => {
  it('returns true when query succeeds and false when it fails', async () => {
    vi.resetModules();
    vi.doMock('@prisma/client', () => ({
      PrismaClient: class {
        $queryRaw = vi.fn().mockResolvedValueOnce(1).mockRejectedValueOnce(new Error('down'));
      },
    }));
    const mod = await import('./prisma.js');
    await expect(mod.checkDatabase()).resolves.toBe(true);
    await expect(mod.checkDatabase()).resolves.toBe(false);
  });
});
