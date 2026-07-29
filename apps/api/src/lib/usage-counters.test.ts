import { describe, expect, it, vi } from 'vitest';
import type { Redis } from 'ioredis';
import {
  METER_TYPES,
  currentBillingPeriod,
  getAllUsageCounters,
  getUsageCounter,
  incrUsageCounter,
  isUsageMeterType,
  popDirtyUsageMembers,
  USAGE_DIRTY_SET_KEY,
} from './usage-counters.js';

function createMemoryRedis(status: string = 'ready') {
  const store = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const redis = {
    status,
    connect: vi.fn(async () => {
      (redis as { status: string }).status = 'ready';
    }),
    incrby: vi.fn(async (key: string, by: number) => {
      const next = (Number.parseInt(store.get(key) ?? '0', 10) || 0) + by;
      store.set(key, String(next));
      return next;
    }),
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    expire: vi.fn(async () => 1),
    sadd: vi.fn(async (key: string, member: string) => {
      const set = sets.get(key) ?? new Set<string>();
      set.add(member);
      sets.set(key, set);
      return 1;
    }),
    spop: vi.fn(async (key: string) => {
      const set = sets.get(key);
      if (!set || set.size === 0) return null;
      const value = set.values().next().value as string;
      set.delete(value);
      return value;
    }),
  };
  return { redis: redis as unknown as Redis, store, sets };
}

describe('usage-counters coverage', () => {
  it('isUsageMeterType accepts known meters and rejects others', () => {
    for (const meter of METER_TYPES) {
      expect(isUsageMeterType(meter)).toBe(true);
    }
    expect(isUsageMeterType('not_a_meter')).toBe(false);
  });

  it('connects redis when status is not ready before incr', async () => {
    const { redis } = createMemoryRedis('wait');
    await incrUsageCounter(redis, 'org', 'api_calls', 1, '2026-07');
    expect(redis.connect).toHaveBeenCalled();
  });

  it('rejects non-positive or non-integer quantities', async () => {
    const { redis } = createMemoryRedis();
    await expect(incrUsageCounter(redis, 'org', 'api_calls', 0)).rejects.toBeInstanceOf(RangeError);
    await expect(incrUsageCounter(redis, 'org', 'api_calls', -1)).rejects.toBeInstanceOf(RangeError);
    await expect(incrUsageCounter(redis, 'org', 'api_calls', 1.5)).rejects.toBeInstanceOf(
      RangeError,
    );
  });

  it('returns 0 for missing or non-finite redis counter values', async () => {
    const { redis, store } = createMemoryRedis();
    expect(await getUsageCounter(redis, 'org', 'api_calls', '2026-07')).toBe(0);
    store.set('usage:org:2026-07:api_calls', 'not-a-number');
    expect(await getUsageCounter(redis, 'org', 'api_calls', '2026-07')).toBe(0);
  });

  it('formats leap-year and month-boundary billing periods', () => {
    expect(currentBillingPeriod(new Date('2024-02-29T23:59:59.000Z'))).toBe('2024-02');
    expect(currentBillingPeriod(new Date('2026-12-31T23:59:59.000Z'))).toBe('2026-12');
    expect(currentBillingPeriod(new Date('2027-01-01T00:00:00.000Z'))).toBe('2027-01');
  });

  it('supports concurrent increments without losing counts', async () => {
    const { redis } = createMemoryRedis();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => incrUsageCounter(redis, 'org', 'api_calls', 1, '2026-07')),
    );
    expect(Math.max(...results)).toBe(20);
    expect(await getUsageCounter(redis, 'org', 'api_calls', '2026-07')).toBe(20);
  });

  it('getAllUsageCounters returns every meter type', async () => {
    const { redis } = createMemoryRedis();
    await incrUsageCounter(redis, 'org', 'webhooks', 2, '2026-07');
    const all = await getAllUsageCounters(redis, 'org', '2026-07');
    expect(Object.keys(all).sort()).toEqual([...METER_TYPES].sort());
    expect(all.webhooks).toBe(2);
  });

  it('popDirtyUsageMembers filters malformed members and stops on empty set', async () => {
    const { redis, sets } = createMemoryRedis();
    sets.set(
      USAGE_DIRTY_SET_KEY,
      new Set(['org:2026-07', 'bad', 'org:not-a-period', ':2026-07']),
    );
    const members = await popDirtyUsageMembers(redis, 10);
    // Members without ':' keep orgId and default period to currentBillingPeriod().
    expect(members).toEqual([
      { orgId: 'org', period: '2026-07' },
      { orgId: 'bad', period: currentBillingPeriod() },
    ]);
    expect(await popDirtyUsageMembers(redis, 5)).toEqual([]);
  });
});
