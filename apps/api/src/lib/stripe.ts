import Stripe from 'stripe';
import { AppError } from './errors.js';

/** Pinned to the stripe-node package LatestApiVersion. */
export const STRIPE_API_VERSION = '2026-06-24.dahlia' as const;

let cachedClient: Stripe | null = null;

/**
 * Create a typed Stripe SDK client. Does not cache.
 */
export function createStripeClient(secretKey: string): Stripe {
  if (!secretKey || secretKey.trim().length === 0) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      'STRIPE_SECRET_KEY is required to initialize Stripe',
      500,
      'unknown',
    );
  }

  return new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
    maxNetworkRetries: 0, // retries owned by withRetry + circuit breaker
    appInfo: {
      name: 'CogniStream',
      url: 'https://cognistream.io',
    },
  });
}

/**
 * Lazy singleton Stripe client keyed from process env (or explicit secret).
 */
export function getStripeClient(secretKey?: string): Stripe {
  if (cachedClient) {
    return cachedClient;
  }

  const key = secretKey ?? process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new AppError(
      'CONFIGURATION_ERROR',
      'STRIPE_SECRET_KEY is required to initialize Stripe',
      500,
      'unknown',
    );
  }

  cachedClient = createStripeClient(key);
  return cachedClient;
}

/** Test helper — clears the cached singleton. */
export function resetStripeClient(): void {
  cachedClient = null;
}

/** Test helper — inject a mock/client instance. */
export function setStripeClient(client: Stripe | null): void {
  cachedClient = client;
}