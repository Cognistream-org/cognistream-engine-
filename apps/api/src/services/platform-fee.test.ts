import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRICING_TIERS } from '../config/pricing.js';
import {
  MAX_FEE_AMOUNT_CENTS,
  calculatePlatformFee,
  feeBasisPointsForTier,
  feeCentsHalfUp,
} from './platform-fee.js';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    organization: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from '../lib/prisma.js';

describe('feeCentsHalfUp', () => {
  it('applies Free 350bp, Developer 250bp, Enterprise 150bp', () => {
    const amount = 10_000n;
    expect(feeCentsHalfUp(amount, PRICING_TIERS.free.platformFeeBasisPoints)).toBe(350n);
    expect(feeCentsHalfUp(amount, PRICING_TIERS.developer.platformFeeBasisPoints)).toBe(250n);
    expect(feeCentsHalfUp(amount, PRICING_TIERS.enterprise.platformFeeBasisPoints)).toBe(150n);
  });

  it('rounds HALF_UP (1.5 → 2, 2.5 → 3)', () => {
    // 100 * 150 / 10000 = 1.5 → 2
    expect(feeCentsHalfUp(100n, 150)).toBe(2n);
    // 100 * 250 / 10000 = 2.5 → 3
    expect(feeCentsHalfUp(100n, 250)).toBe(3n);
    // 100 * 350 / 10000 = 3.5 → 4
    expect(feeCentsHalfUp(100n, 350)).toBe(4n);
    // Exact integer stays exact
    expect(feeCentsHalfUp(10_000n, 250)).toBe(250n);
  });

  it('handles edge cases: 0 amount, max safe amount, overflow protection', () => {
    expect(feeCentsHalfUp(0n, 350)).toBe(0n);
    expect(feeCentsHalfUp(MAX_FEE_AMOUNT_CENTS, 0)).toBe(0n);
    expect(() => feeCentsHalfUp(-1n, 250)).toThrow(RangeError);
    expect(() => feeCentsHalfUp(MAX_FEE_AMOUNT_CENTS + 1n, 250)).toThrow(RangeError);
    expect(() => feeCentsHalfUp(100n, -1)).toThrow(RangeError);
    expect(() => feeCentsHalfUp(100n, 10_001)).toThrow(RangeError);
  });

  it('is deterministic across 1000 identical calls', () => {
    const amount = 12_345n;
    const bps = 250;
    const first = feeCentsHalfUp(amount, bps);
    for (let i = 0; i < 1000; i += 1) {
      expect(feeCentsHalfUp(amount, bps)).toBe(first);
    }
  });
});


  it('rejects unknown organization tier', () => {
    expect(() => feeBasisPointsForTier('gold' as never)).toThrow(/Unknown organization tier/);
  });

describe('calculatePlatformFee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('looks up org tier and returns gross/fee/net for all tiers', async () => {
    for (const tier of ['free', 'developer', 'enterprise'] as const) {
      vi.mocked(prisma.organization.findUnique).mockResolvedValue({ tier } as never);
      const amount = 10_000n;
      const result = await calculatePlatformFee('org-1', amount);
      expect(result.tier).toBe(tier);
      expect(result.feeBasisPoints).toBe(feeBasisPointsForTier(tier));
      expect(result.grossAmountCents).toBe(amount);
      expect(result.platformFeeCents).toBe(feeCentsHalfUp(amount, result.feeBasisPoints));
      expect(result.netAmountCents).toBe(amount - result.platformFeeCents);
    }
  });

  it('rejects missing org and invalid amounts', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);
    await expect(calculatePlatformFee('missing', 100n)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(calculatePlatformFee('org', -1n, { tier: 'free' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    await expect(
      calculatePlatformFee('org', MAX_FEE_AMOUNT_CENTS + 1n, { tier: 'free' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('is deterministic for the same org/amount', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ tier: 'developer' } as never);
    const first = await calculatePlatformFee('org-1', 99_999n);
    for (let i = 0; i < 50; i += 1) {
      await expect(calculatePlatformFee('org-1', 99_999n)).resolves.toEqual(first);
    }
  });
});
