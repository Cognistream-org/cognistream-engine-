import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('stripe', () => {
  class MockStripe {
    secretKey: string;
    options: unknown;
    constructor(secretKey: string, options?: unknown) {
      this.secretKey = secretKey;
      this.options = options;
    }
  }
  return { default: MockStripe };
});

import {
  STRIPE_API_VERSION,
  createStripeClient,
  getStripeClient,
  resetStripeClient,
  setStripeClient,
} from './stripe.js';
import { AppError } from './errors.js';

describe('stripe client', () => {
  afterEach(() => {
    resetStripeClient();
    vi.unstubAllEnvs();
  });

  it('createStripeClient initializes with mock key and pinned apiVersion', () => {
    const client = createStripeClient('sk_test_mock_key') as unknown as {
      secretKey: string;
      options: { apiVersion: string; typescript: boolean; maxNetworkRetries: number };
    };
    expect(client.secretKey).toBe('sk_test_mock_key');
    expect(client.options.apiVersion).toBe(STRIPE_API_VERSION);
    expect(client.options.typescript).toBe(true);
    expect(client.options.maxNetworkRetries).toBe(0);
  });

  it('createStripeClient rejects empty secret key', () => {
    expect(() => createStripeClient('')).toThrow(AppError);
    expect(() => createStripeClient('   ')).toThrow(/STRIPE_SECRET_KEY/);
  });

  it('getStripeClient caches singleton from env', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_from_env');
    const a = getStripeClient();
    const b = getStripeClient();
    expect(a).toBe(b);
  });

  it('getStripeClient accepts explicit secretKey', () => {
    const client = getStripeClient('sk_test_explicit') as unknown as { secretKey: string };
    expect(client.secretKey).toBe('sk_test_explicit');
  });

  it('getStripeClient throws when secret is missing', () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => getStripeClient()).toThrow(AppError);
  });

  it('setStripeClient injects a client for tests', () => {
    const fake = { id: 'fake' } as never;
    setStripeClient(fake);
    expect(getStripeClient()).toBe(fake);
    setStripeClient(null);
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_after_reset');
    const next = getStripeClient() as unknown as { secretKey: string };
    expect(next.secretKey).toBe('sk_test_after_reset');
  });
});
