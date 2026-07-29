/**
 * CogniStream pricing tiers — amounts are INTEGER cents only.
 * Platform fees are basis points (1 bp = 0.01%).
 */
export const PRICING_TIERS = {
  free: {
    name: 'Free',
    monthlyPriceCents: 0,
    yearlyPriceCents: 0,
    limits: {
      apiCallsPerMonth: 1_000,
      transactionsPerMonth: 100,
      transactionVolumeCentsPerMonth: 5_000_000,
      agents: 3,
      webhooks: 1,
      disputesPerMonth: 5,
    },
    features: {
      escrow: true,
      disputes: true,
      customWebhooks: false,
      prioritySupport: false,
      stripeConnect: false,
      analytics: false,
    },
    platformFeeBasisPoints: 350,
    overage: { apiCallCents: 1, transactionCents: 10 },
  },
  developer: {
    name: 'Developer',
    monthlyPriceCents: 4_900,
    yearlyPriceCents: 49_000,
    limits: {
      apiCallsPerMonth: 10_000,
      transactionsPerMonth: 1_000,
      transactionVolumeCentsPerMonth: 50_000_000,
      agents: 10,
      webhooks: 5,
      disputesPerMonth: 50,
    },
    features: {
      escrow: true,
      disputes: true,
      customWebhooks: true,
      prioritySupport: true,
      stripeConnect: true,
      analytics: true,
    },
    platformFeeBasisPoints: 250,
    overage: null,
  },
  enterprise: {
    name: 'Enterprise',
    monthlyPriceCents: 29_900,
    yearlyPriceCents: 299_000,
    limits: {
      apiCallsPerMonth: 100_000,
      transactionsPerMonth: 10_000,
      transactionVolumeCentsPerMonth: 500_000_000,
      agents: 100,
      webhooks: 25,
      disputesPerMonth: 500,
    },
    features: {
      escrow: true,
      disputes: true,
      customWebhooks: true,
      prioritySupport: true,
      stripeConnect: true,
      analytics: true,
      dedicatedSupport: true,
      sla: true,
    },
    platformFeeBasisPoints: 150,
    overage: null,
  },
} as const;

export type PricingTier = keyof typeof PRICING_TIERS;

export type PricingTierConfig = (typeof PRICING_TIERS)[PricingTier];

export function getPricingTier(tier: PricingTier): PricingTierConfig {
  return PRICING_TIERS[tier];
}

/** Convert basis points to integer fee cents (floor). Never uses float money math. */
export function feeCentsFromBasisPoints(amountCents: bigint, basisPoints: number): bigint {
  if (basisPoints < 0 || basisPoints > 10_000) {
    throw new RangeError('fee basis points must be between 0 and 10000');
  }
  if (amountCents < 0n) {
    throw new RangeError('amountCents must be non-negative');
  }
  return (amountCents * BigInt(basisPoints)) / 10_000n;
}
