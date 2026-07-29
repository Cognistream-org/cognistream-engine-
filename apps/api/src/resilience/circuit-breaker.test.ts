import { describe, expect, it, beforeEach } from 'vitest';
import {
  CircuitBreaker,
  CircuitOpenError,
  getCircuitBreaker,
  resetCircuitBreakers,
} from './circuit-breaker.js';
import { getGauge, resetMetrics } from './metrics.js';

describe('CircuitBreaker', () => {
  let now = 0;

  beforeEach(() => {
    now = 0;
    resetCircuitBreakers();
    resetMetrics();
  });

  function create(): CircuitBreaker {
    return new CircuitBreaker('postgres', {
      failureThreshold: 5,
      resetTimeoutMs: 30_000,
      halfOpenMaxCalls: 3,
      now: () => now,
    });
  }

  it('starts CLOSED and records gauge', async () => {
    const cb = create();
    expect(cb.getState()).toBe('CLOSED');
    expect(getGauge('circuit_breaker_state', { service: 'postgres' })).toBe(0);
    await expect(cb.execute(async () => 42)).resolves.toBe(42);
  });

  it('opens after failureThreshold consecutive failures', async () => {
    const cb = create();
    for (let i = 0; i < 5; i += 1) {
      await expect(
        cb.execute(async () => {
          throw new Error('fail');
        }),
      ).rejects.toThrow('fail');
    }
    expect(cb.getState()).toBe('OPEN');
    expect(getGauge('circuit_breaker_state', { service: 'postgres' })).toBe(1);
    await expect(cb.execute(async () => 'ok')).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('transitions OPEN → HALF_OPEN after resetTimeout', async () => {
    const cb = create();
    cb.forceOpen();
    expect(cb.getState()).toBe('OPEN');

    now = 29_999;
    expect(cb.getState()).toBe('OPEN');

    now = 30_000;
    expect(cb.getState()).toBe('HALF_OPEN');
    expect(getGauge('circuit_breaker_state', { service: 'postgres' })).toBe(2);
  });

  it('recovers HALF_OPEN → CLOSED after enough successes', async () => {
    const cb = create();
    cb.forceOpen();
    now = 30_000;
    expect(cb.getState()).toBe('HALF_OPEN');

    await cb.execute(async () => 1);
    await cb.execute(async () => 2);
    expect(cb.getState()).toBe('HALF_OPEN');
    await cb.execute(async () => 3);
    expect(cb.getState()).toBe('CLOSED');
  });

  it('returns to OPEN on HALF_OPEN failure', async () => {
    const cb = create();
    cb.forceOpen();
    now = 30_000;
    await expect(
      cb.execute(async () => {
        throw new Error('still bad');
      }),
    ).rejects.toThrow('still bad');
    expect(cb.getState()).toBe('OPEN');
  });

  it('limits concurrent half-open probes', async () => {
    const cb = create();
    cb.forceOpen();
    now = 30_000;

    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });

    const p1 = cb.execute(async () => {
      await gate;
      return 1;
    });
    const p2 = cb.execute(async () => {
      await gate;
      return 2;
    });
    const p3 = cb.execute(async () => {
      await gate;
      return 3;
    });

    await expect(cb.execute(async () => 4)).rejects.toBeInstanceOf(CircuitOpenError);

    release();
    await Promise.all([p1, p2, p3]);
  });

  it('getCircuitBreaker memoizes by service', () => {
    const a = getCircuitBreaker('redis');
    const b = getCircuitBreaker('redis');
    expect(a).toBe(b);
  });
});
