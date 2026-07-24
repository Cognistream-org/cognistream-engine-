import { describe, expect, it } from 'vitest';
import { calculateFeeCents } from './transactions.js';

describe('calculateFeeCents', () => {
  it('returns 0 for 1 cent (floor of 0.005)', () => {
    expect(calculateFeeCents(1n)).toBe(0n);
  });

  it('floors odd amounts correctly', () => {
    // 199 * 0.005 = 0.995 → floor 0
    expect(calculateFeeCents(199n)).toBe(0n);
    // 200 * 0.005 = 1
    expect(calculateFeeCents(200n)).toBe(1n);
    // 201 * 0.005 = 1.005 → floor 1
    expect(calculateFeeCents(201n)).toBe(1n);
  });

  it('handles large amounts without float precision loss', () => {
    // 10_000_000_000 cents * 0.5% = 50_000_000
    expect(calculateFeeCents(10_000_000_000n)).toBe(50_000_000n);
  });

  it('matches Math.floor(amount * 0.005) for representative ints', () => {
    for (const amount of [1, 7, 99, 100, 333, 999, 10_000, 1_234_567]) {
      const expected = BigInt(Math.floor(amount * 0.005));
      expect(calculateFeeCents(BigInt(amount))).toBe(expected);
    }
  });

  it('rejects non-positive amounts', () => {
    expect(() => calculateFeeCents(0n)).toThrow(/positive/);
    expect(() => calculateFeeCents(-5n)).toThrow(/positive/);
  });
});
