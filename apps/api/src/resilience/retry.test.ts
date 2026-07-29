import { describe, expect, it, vi } from 'vitest';
import {
  calculateBackoffMs,
  MAX_RETRY_ATTEMPTS,
  RETRY_BACKOFF_MS,
  withIdempotencyKey,
  withRetry,
} from './retry.js';

describe('calculateBackoffMs', () => {
  it('follows exponential schedule 1s..32s', () => {
    const random = () => 0; // no jitter
    expect(calculateBackoffMs(1, { random })).toBe(1_000);
    expect(calculateBackoffMs(2, { random })).toBe(2_000);
    expect(calculateBackoffMs(3, { random })).toBe(4_000);
    expect(calculateBackoffMs(4, { random })).toBe(8_000);
    expect(calculateBackoffMs(5, { random })).toBe(16_000);
    expect(calculateBackoffMs(6, { random })).toBe(32_000);
  });

  it('adds jitter in 0–25% range', () => {
    const random = () => 1; // max jitter
    const delay = calculateBackoffMs(1, { random, jitterFraction: 0.25 });
    expect(delay).toBe(1_250);

    const mid = calculateBackoffMs(1, { random: () => 0.5, jitterFraction: 0.25 });
    expect(mid).toBe(1_125);
  });

  it('exposes the canonical backoff table', () => {
    expect([...RETRY_BACKOFF_MS]).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 32_000]);
    expect(MAX_RETRY_ATTEMPTS).toBe(6);
  });
});

describe('withRetry', () => {
  it('retries up to maxAttempts with backoff sleeps', async () => {
    const sleeps: number[] = [];
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error(`fail-${calls}`);
        },
        {
          maxAttempts: 6,
          random: () => 0,
          sleep: async (ms) => {
            sleeps.push(ms);
          },
        },
      ),
    ).rejects.toThrow('fail-6');

    expect(calls).toBe(6);
    expect(sleeps).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
  });

  it('returns on first success', async () => {
    const result = await withRetry(async (attempt) => {
      if (attempt < 2) throw new Error('once');
      return 'ok';
    }, { sleep: async () => undefined, random: () => 0 });
    expect(result).toBe('ok');
  });
});

describe('withIdempotencyKey', () => {
  it('executes once and deduplicates on second call', async () => {
    const store = new Map<string, string>();
    const redis = {
      status: 'ready' as const,
      connect: vi.fn(),
      set: vi.fn(async (key: string, value: string, _ex: string, _ttl: number, nx: string) => {
        expect(nx).toBe('NX');
        if (store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      }),
      del: vi.fn(async (key: string) => {
        store.delete(key);
        return 1;
      }),
    };

    let runs = 0;
    const first = await withIdempotencyKey({
      redis: redis as never,
      key: 'fixed-key',
      fn: async () => {
        runs += 1;
        return { n: runs };
      },
    });
    const second = await withIdempotencyKey({
      redis: redis as never,
      key: 'fixed-key',
      fn: async () => {
        runs += 1;
        return { n: runs };
      },
    });

    expect(first).toEqual({ status: 'executed', value: { n: 1 }, key: 'fixed-key' });
    expect(second).toEqual({ status: 'duplicate', key: 'fixed-key' });
    expect(runs).toBe(1);
  });

  it('releases key when fn throws', async () => {
    const store = new Map<string, string>();
    const redis = {
      status: 'ready' as const,
      connect: vi.fn(),
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      del: vi.fn(async (key: string) => {
        store.delete(key);
        return 1;
      }),
    };

    await expect(
      withIdempotencyKey({
        redis: redis as never,
        key: 'boom',
        fn: async () => {
          throw new Error('nope');
        },
      }),
    ).rejects.toThrow('nope');

    expect(store.has('cognistream:idempotency:boom')).toBe(false);
  });

  it('generates UUID v7 when key omitted', async () => {
    const redis = {
      status: 'ready' as const,
      connect: vi.fn(),
      set: vi.fn(async () => 'OK'),
      del: vi.fn(),
    };
    const result = await withIdempotencyKey({
      redis: redis as never,
      fn: async () => true,
    });
    expect(result.status).toBe('executed');
    if (result.status === 'executed') {
      expect(result.key).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
  });
});
