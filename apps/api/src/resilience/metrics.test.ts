import { describe, expect, it, beforeEach } from 'vitest';
import {
  setGauge,
  getGauge,
  resetMetrics,
  collectMetrics,
} from './metrics.js';

describe('resilience metrics', () => {
  beforeEach(() => {
    resetMetrics();
  });

  it('sets and gets a gauge with labels', () => {
    setGauge('circuit_breaker_state', 1, { service: 'redis' });
    expect(getGauge('circuit_breaker_state', { service: 'redis' })).toBe(1);
    expect(getGauge('circuit_breaker_state', { service: 'postgres' })).toBeUndefined();
  });

  it('overwrites gauge values for the same series', () => {
    setGauge('retries', 1, { op: 'db' });
    setGauge('retries', 3, { op: 'db' });
    expect(getGauge('retries', { op: 'db' })).toBe(3);
  });

  it('treats empty labels as a single series', () => {
    setGauge('uptime', 42);
    expect(getGauge('uptime')).toBe(42);
    expect(getGauge('uptime', {})).toBe(42);
  });

  it('collectMetrics returns all series with parsed labels', () => {
    setGauge('a', 1, { x: '1', y: '2' });
    setGauge('b', 2);
    const rows = collectMetrics().sort((l, r) => l.name.localeCompare(r.name));
    expect(rows).toEqual([
      { name: 'a', labels: { x: '1', y: '2' }, value: 1 },
      { name: 'b', labels: {}, value: 2 },
    ]);
  });

  it('resetMetrics clears all gauges', () => {
    setGauge('x', 9, { k: 'v' });
    resetMetrics();
    expect(getGauge('x', { k: 'v' })).toBeUndefined();
    expect(collectMetrics()).toEqual([]);
  });
});