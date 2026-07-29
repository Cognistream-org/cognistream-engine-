import type { Redis } from 'ioredis';
import type { UsageMeterType } from '@prisma/client';

export const USAGE_TTL_SECONDS = 35 * 24 * 60 * 60;
export const USAGE_DIRTY_SET_KEY = 'usage:dirty';
export const SOFT_LIMIT_RATIO = 0.8;
export const PAID_HARD_LIMIT_RATIO = 1.2;
export const FREE_HARD_LIMIT_RATIO = 1.0;

export type BillingCycle = 'monthly' | 'yearly';

export type UsageOperation =
  | 'api_calls'
  | 'transactions'
  | 'transaction_volume_cents'
  | 'agents'
  | 'webhooks'
  | 'disputes';

const METER_TYPES: readonly UsageMeterType[] = [
  'api_calls',
  'transactions',
  'transaction_volume_cents',
  'agents',
  'webhooks',
  'disputes',
] as const;

export function isUsageMeterType(value: string): value is UsageMeterType {
  return (METER_TYPES as readonly string[]).includes(value);
}

export function currentBillingPeriod(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function usageRedisKey(
  orgId: string,
  meterType: UsageMeterType,
  period = currentBillingPeriod(),
): string {
  return `usage:${orgId}:${period}:${meterType}`;
}

export function dirtyMember(orgId: string, period = currentBillingPeriod()): string {
  return `${orgId}:${period}`;
}

async function ensureRedis(redis: Redis): Promise<void> {
  if (redis.status !== 'ready') {
    await redis.connect();
  }
}

/**
 * Atomically increment a usage counter and mark the org/period dirty for DB flush.
 */
export async function incrUsageCounter(
  redis: Redis,
  orgId: string,
  meterType: UsageMeterType,
  quantity = 1,
  period = currentBillingPeriod(),
): Promise<number> {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new RangeError('quantity must be a positive integer');
  }

  await ensureRedis(redis);
  const key = usageRedisKey(orgId, meterType, period);
  const count = await redis.incrby(key, quantity);
  if (count === quantity) {
    await redis.expire(key, USAGE_TTL_SECONDS);
  }
  await redis.sadd(USAGE_DIRTY_SET_KEY, dirtyMember(orgId, period));
  return count;
}

export async function getUsageCounter(
  redis: Redis,
  orgId: string,
  meterType: UsageMeterType,
  period = currentBillingPeriod(),
): Promise<number> {
  await ensureRedis(redis);
  const raw = await redis.get(usageRedisKey(orgId, meterType, period));
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function getAllUsageCounters(
  redis: Redis,
  orgId: string,
  period = currentBillingPeriod(),
): Promise<Record<UsageMeterType, number>> {
  const entries = await Promise.all(
    METER_TYPES.map(async (meterType) => {
      const value = await getUsageCounter(redis, orgId, meterType, period);
      return [meterType, value] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<UsageMeterType, number>;
}

export async function popDirtyUsageMembers(
  redis: Redis,
  limit = 100,
): Promise<Array<{ orgId: string; period: string }>> {
  await ensureRedis(redis);
  const members: string[] = [];
  for (let i = 0; i < limit; i += 1) {
    const member = await redis.spop(USAGE_DIRTY_SET_KEY);
    if (!member) break;
    members.push(member);
  }

  return members.map((member) => {
    const [orgId, period] = member.split(':');
    return { orgId: orgId ?? '', period: period ?? currentBillingPeriod() };
  }).filter((m) => m.orgId.length > 0 && /^\d{4}-\d{2}$/.test(m.period));
}

export function hardLimitForTier(limit: number, tier: 'free' | 'developer' | 'enterprise'): number {
  const ratio = tier === 'free' ? FREE_HARD_LIMIT_RATIO : PAID_HARD_LIMIT_RATIO;
  return Math.floor(limit * ratio);
}

export function softLimitFor(limit: number): number {
  return Math.floor(limit * SOFT_LIMIT_RATIO);
}

export { METER_TYPES };
