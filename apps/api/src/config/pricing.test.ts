import { describe, expect, it } from 'vitest';
import {
  PRICING_TIERS,
  feeCentsFromBasisPoints,
  getPricingTier,
  type PricingTier,
} from './pricing.js';

const TIERS = Object.keys(PRICING_TIERS) as PricingTier[];

const REQUIRED_LIMIT_KEYS = [
  'apiCallsPerMonth',
  'transactionsPerMonth',
  'transactionVolumeCentsPerMonth',
  'agents',
  'webhooks',
  'disputesPerMonth',
] as const;

const REQUIRED_FEATURE_KEYS = [
  'escrow',
  'disputes',
  'customWebhooks',
  'prioritySupport',
  'stripeConnect',
  'analytics',
] as const;

describe('PRICING_TIERS', () => {
  it('defines free, developer, and enterprise', () => {
    expect(TIERS.sort()).toEqual(['developer', 'enterprise', 'free']);
  });

  it.each(TIERS)('%s has required pricing fields', (tier) => {
    const config = PRICING_TIERS[tier];
    expect(config.name.length).toBeGreaterThan(0);
    expect(Number.isInteger(config.monthlyPriceCents)).toBe(true);
    expect(Number.isInteger(config.yearlyPriceCents)).toBe(true);
    expect(config.monthlyPriceCents).toBeGreaterThanOrEqual(0);
    expect(config.yearlyPriceCents).toBeGreaterThanOrEqual(0);
    expect(config.limits).toBeDefined();
    expect(config.features).toBeDefined();
    expect(Number.isInteger(config.platformFeeBasisPoints)).toBe(true);
    expect('overage' in config).toBe(true);
  });

  it.each(TIERS)('%s limits are positive integers', (tier) => {
    const { limits } = PRICING_TIERS[tier];
    for (const key of REQUIRED_LIMIT_KEYS) {
      const value = limits[key];
      expect(Number.isInteger(value), `${tier}.${key}`).toBe(true);
      expect(value, `${tier}.${key}`).toBeGreaterThan(0);
    }
  });

  it.each(TIERS)('%s fee basis points are within 0-10000', (tier) => {
    const bps = PRICING_TIERS[tier].platformFeeBasisPoints;
    expect(bps).toBeGreaterThanOrEqual(0);
    expect(bps).toBeLessThanOrEqual(10_000);
  });

  it.each(TIERS)('%s has core feature flags', (tier) => {
    const { features } = PRICING_TIERS[tier];
    for (const key of REQUIRED_FEATURE_KEYS) {
      expect(typeof features[key]).toBe('boolean');
    }
  });

  it('free tier is free and has overage pricing', () => {
    const free = PRICING_TIERS.free;
    expect(free.monthlyPriceCents).toBe(0);
    expect(free.yearlyPriceCents).toBe(0);
    expect(free.overage).not.toBeNull();
    expect(free.overage?.apiCallCents).toBeGreaterThan(0);
    expect(free.overage?.transactionCents).toBeGreaterThan(0);
  });

  it('paid tiers have no overage and enable Stripe Connect', () => {
    expect(PRICING_TIERS.developer.overage).toBeNull();
    expect(PRICING_TIERS.enterprise.overage).toBeNull();
    expect(PRICING_TIERS.developer.features.stripeConnect).toBe(true);
    expect(PRICING_TIERS.enterprise.features.stripeConnect).toBe(true);
  });

  it('getPricingTier returns the configured tier', () => {
    expect(getPricingTier('developer')).toBe(PRICING_TIERS.developer);
  });
});

describe('feeCentsFromBasisPoints', () => {
  it('computes integer fee cents without float math', () => {
    expect(feeCentsFromBasisPoints(10_000n, 250)).toBe(250n);
    expect(feeCentsFromBasisPoints(1n, 250)).toBe(0n);
    expect(feeCentsFromBasisPoints(100n, 350)).toBe(3n);
  });

  it('rejects invalid basis points and negative amounts', () => {
    expect(() => feeCentsFromBasisPoints(100n, -1)).toThrow(RangeError);
    expect(() => feeCentsFromBasisPoints(100n, 10_001)).toThrow(RangeError);
    expect(() => feeCentsFromBasisPoints(-1n, 250)).toThrow(RangeError);
  });
});
