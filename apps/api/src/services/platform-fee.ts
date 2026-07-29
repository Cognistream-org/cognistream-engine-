import type { OrganizationTier } from '@prisma/client';
import { PRICING_TIERS, type PricingTier } from '../config/pricing.js';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';

/** Stripe-safe upper bound for monetary amounts (integer cents). */
export const MAX_FEE_AMOUNT_CENTS = BigInt(Number.MAX_SAFE_INTEGER);

export type PlatformFeeCalculation = {
  grossAmountCents: bigint;
  platformFeeCents: bigint;
  netAmountCents: bigint;
  feeBasisPoints: number;
  tier: OrganizationTier;
};

/**
 * HALF_UP integer division by 10_000 (basis points → cents).
 * Uses only BigInt arithmetic — never float.
 *
 * Examples: 1.5 → 2, 2.5 → 3 (when the fractional part before /10000 is *.5).
 */
export function feeCentsHalfUp(amountCents: bigint, feeBasisPoints: number): bigint {
  if (!Number.isInteger(feeBasisPoints) || feeBasisPoints < 0 || feeBasisPoints > 10_000) {
    throw new RangeError('fee basis points must be an integer between 0 and 10000');
  }
  if (amountCents < 0n) {
    throw new RangeError('amountCents must be non-negative');
  }
  if (amountCents > MAX_FEE_AMOUNT_CENTS) {
    throw new RangeError('amountCents exceeds safe integer range');
  }

  const numerator = amountCents * BigInt(feeBasisPoints);
  // + 5000n implements classic HALF_UP when dividing by 10000.
  return (numerator + 5_000n) / 10_000n;
}

export function feeBasisPointsForTier(tier: OrganizationTier): number {
  if (!(tier in PRICING_TIERS)) {
    throw new AppError('VALIDATION_ERROR', `Unknown organization tier: ${tier}`, 422, 'unknown');
  }
  return PRICING_TIERS[tier as PricingTier].platformFeeBasisPoints;
}

/**
 * Deterministic platform fee for an organization and gross amount (integer cents).
 * Same (org tier, amount, bps) always yields the same result.
 */
export async function calculatePlatformFee(
  orgId: string,
  amountCents: bigint,
  options: { requestId?: string; tier?: OrganizationTier } = {},
): Promise<PlatformFeeCalculation> {
  const requestId = options.requestId ?? 'unknown';

  if (amountCents < 0n) {
    throw new AppError(
      'VALIDATION_ERROR',
      'amountCents must be non-negative',
      422,
      requestId,
    );
  }
  if (amountCents > MAX_FEE_AMOUNT_CENTS) {
    throw new AppError(
      'VALIDATION_ERROR',
      'amountCents exceeds safe integer range for platform fees',
      422,
      requestId,
    );
  }

  let tier = options.tier;
  if (!tier) {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { tier: true },
    });
    if (!org) {
      throw new AppError('NOT_FOUND', 'Organization not found', 404, requestId);
    }
    tier = org.tier;
  }

  const feeBasisPoints = feeBasisPointsForTier(tier);
  const platformFeeCents = feeCentsHalfUp(amountCents, feeBasisPoints);
  const netAmountCents = amountCents - platformFeeCents;

  return {
    grossAmountCents: amountCents,
    platformFeeCents,
    netAmountCents,
    feeBasisPoints,
    tier,
  };
}
