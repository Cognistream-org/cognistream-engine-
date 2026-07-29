import type { Redis } from 'ioredis';
import { createId } from '../lib/uuid.js';

/** Backoff delays in ms: 1s, 2s, 4s, 8s, 16s, 32s */
export const RETRY_BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 32_000] as const;

export const MAX_RETRY_ATTEMPTS = 6;
export const IDEMPOTENCY_TTL_SECONDS = 24 * 60 * 60;
const IDEMPOTENCY_PREFIX = 'cognistream:idempotency:';

export type RetryOptions = {
  maxAttempts?: number;
  /** Backoff schedule in ms (defaults to RETRY_BACKOFF_MS). */
  backoffMs?: readonly number[];
  /** Random jitter fraction 0–1 added on top of backoff (default 0.25). */
  jitterFraction?: number;
  /** Injectable RNG for tests (returns 0..1). */
  random?: () => number;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Return true to retry this error. */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
};

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Compute delay for the Nth retry wait (after failed attempt `attempt`, 1-based).
 * Includes jitter in [0, jitterFraction * base].
 */
export function calculateBackoffMs(
  attempt: number,
  options: {
    backoffMs?: readonly number[];
    jitterFraction?: number;
    random?: () => number;
  } = {},
): number {
  const schedule = options.backoffMs ?? RETRY_BACKOFF_MS;
  const jitterFraction = options.jitterFraction ?? 0.25;
  const random = options.random ?? Math.random;

  const index = Math.min(Math.max(attempt, 1), schedule.length) - 1;
  const base = schedule[index] ?? schedule[schedule.length - 1]!;
  const jitter = base * jitterFraction * random();
  return Math.floor(base + jitter);
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? MAX_RETRY_ATTEMPTS;
  const sleep = options.sleep ?? defaultSleep;
  const shouldRetry = options.shouldRetry ?? (() => true);

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !shouldRetry(error, attempt)) {
        throw error;
      }
      const delay = calculateBackoffMs(attempt, options);
      await sleep(delay);
    }
  }
  throw lastError;
}

export type IdempotencyResult<T> =
  | { status: 'executed'; value: T; key: string }
  | { status: 'duplicate'; key: string };

/**
 * Generate a UUID v7 idempotency key and reserve it in Redis (24h TTL).
 * If the key already exists, returns duplicate without executing fn.
 */
export async function withIdempotencyKey<T>(options: {
  redis: Redis;
  /** Existing key, or omit to generate UUID v7. */
  key?: string;
  fn: () => Promise<T>;
  ttlSeconds?: number;
}): Promise<IdempotencyResult<T>> {
  const key = options.key ?? createId();
  const ttl = options.ttlSeconds ?? IDEMPOTENCY_TTL_SECONDS;
  const redisKey = `${IDEMPOTENCY_PREFIX}${key}`;

  if (options.redis.status !== 'ready') {
    await options.redis.connect();
  }

  const reserved = await options.redis.set(redisKey, '1', 'EX', ttl, 'NX');
  if (reserved !== 'OK') {
    return { status: 'duplicate', key };
  }

  try {
    const value = await options.fn();
    return { status: 'executed', value, key };
  } catch (error) {
    await options.redis.del(redisKey);
    throw error;
  }
}
