import { Prisma, type StripeConnectStatus } from '@prisma/client';
import type { Redis } from 'ioredis';
import type Stripe from 'stripe';
import { prisma } from '../lib/prisma.js';
import { createId } from '../lib/uuid.js';
import { AppError } from '../lib/errors.js';
import { getStripeClient } from '../lib/stripe.js';
import { recordAudit } from '../security/audit-runtime.js';
import { getCircuitBreaker, resetCircuitBreakers } from '../resilience/circuit-breaker.js';
import { withRetry } from '../resilience/retry.js';

export const STRIPE_BREAKER_SERVICE = 'stripe';

const stripeConnectSelect = {
  id: true,
  orgId: true,
  stripeAccountId: true,
  status: true,
  chargesEnabled: true,
  payoutsEnabled: true,
  onboardingUrl: true,
  onboardingUrlExpiresAt: true,
  defaultCurrency: true,
  country: true,
  requirementsJson: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.StripeConnectAccountSelect;

export type StripeConnectAccountRow = Prisma.StripeConnectAccountGetPayload<{
  select: typeof stripeConnectSelect;
}>;

export class StripeConnectConflictError extends AppError {
  constructor(requestId = 'unknown') {
    super(
      'STRIPE_CONNECT_CONFLICT',
      'Organization already has a Stripe Connect account',
      409,
      requestId,
    );
    this.name = 'StripeConnectConflictError';
  }
}

export class StripeConnectNotFoundError extends AppError {
  constructor(requestId = 'unknown') {
    super('STRIPE_CONNECT_NOT_FOUND', 'Stripe Connect account not found', 404, requestId);
    this.name = 'StripeConnectNotFoundError';
  }
}

export class StripeConnectError extends AppError {
  constructor(message: string, requestId = 'unknown', statusCode = 502) {
    super('STRIPE_ERROR', message, statusCode, requestId);
    this.name = 'StripeConnectError';
  }
}

export type StripeConnectOptions = {
  requestId?: string;
  stripe?: Stripe;
  redis?: Redis;
};

function resolveStripe(options?: StripeConnectOptions): Stripe {
  return options?.stripe ?? getStripeClient();
}

function stripeRetryOptions() {
  return {
    maxAttempts: process.env.NODE_ENV === 'test' ? 3 : 6,
    backoffMs:
      process.env.NODE_ENV === 'test'
        ? ([1, 2, 4] as const)
        : undefined,
    shouldRetry: (error: unknown) => {
      if (error instanceof AppError && error.statusCode === 404) return false;
      if (error instanceof AppError && error.statusCode === 409) return false;
      if (error instanceof AppError && error.code === 'VALIDATION_ERROR') return false;
      return true;
    },
  };
}

async function callStripe<T>(
  fn: () => Promise<T>,
  requestId: string,
): Promise<T> {
  const breaker = getCircuitBreaker(STRIPE_BREAKER_SERVICE, { failureThreshold: 5 });
  return withRetry(
    async () => breaker.execute(fn, requestId),
    stripeRetryOptions(),
  );
}

function normalizeCountry(country: string): string {
  const normalized = country.trim().toLowerCase();
  if (!/^[a-z]{2}$/.test(normalized)) {
    throw new AppError(
      'VALIDATION_ERROR',
      'country must be a 2-letter ISO code',
      422,
      'unknown',
    );
  }
  return normalized;
}

/**
 * Map Stripe Account fields onto our Connect status enum.
 */
export function mapStripeAccountStatus(account: Stripe.Account): StripeConnectStatus {
  const disabled = account.requirements?.disabled_reason ?? null;
  if (disabled?.startsWith('rejected')) {
    return 'rejected';
  }
  if (account.charges_enabled && account.payouts_enabled) {
    return 'active';
  }
  if (disabled) {
    return 'restricted';
  }
  if (account.details_submitted) {
    return 'onboarding';
  }
  return 'pending';
}

function requirementsPayload(account: Stripe.Account): Prisma.InputJsonValue {
  return {
    currently_due: account.requirements?.currently_due ?? [],
    eventually_due: account.requirements?.eventually_due ?? [],
    past_due: account.requirements?.past_due ?? [],
    disabled_reason: account.requirements?.disabled_reason ?? null,
    pending_verification: account.requirements?.pending_verification ?? [],
  } satisfies Record<string, unknown> as Prisma.InputJsonValue;
}

/**
 * Create a Stripe Express Connect account for an organization.
 */
export async function createAccount(
  orgId: string,
  country: string,
  options: StripeConnectOptions = {},
): Promise<StripeConnectAccountRow> {
  const requestId = options.requestId ?? 'unknown';
  const normalizedCountry = normalizeCountry(country);
  const stripe = resolveStripe(options);

  const org = await prisma.organization.findUnique({
    where: { id: orgId },
    select: { id: true, name: true },
  });
  if (!org) {
    throw new AppError('NOT_FOUND', 'Organization not found', 404, requestId);
  }

  const existing = await prisma.stripeConnectAccount.findUnique({
    where: { orgId },
    select: { id: true },
  });
  if (existing) {
    throw new StripeConnectConflictError(requestId);
  }

  let stripeAccount: Stripe.Account;
  try {
    stripeAccount = await callStripe(
      () =>
        stripe.accounts.create({
          type: 'express',
          country: normalizedCountry.toUpperCase(),
          email: undefined,
          capabilities: {
            transfers: { requested: true },
            card_payments: { requested: true },
          },
          business_profile: {
            name: org.name,
          },
          metadata: {
            orgId,
            platform: process.env.PLATFORM_NAME ?? 'CogniStream',
          },
        }),
      requestId,
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    const message =
      error instanceof Error ? error.message : 'Failed to create Stripe Connect account';
    void recordAudit({
      orgId,
      action: 'stripe_connect.account_create_failed',
      entityType: 'organization',
      entityId: orgId,
      actorType: 'system',
      result: 'failure',
      metadata: { country: normalizedCountry },
    });
    throw new StripeConnectError(message, requestId);
  }

  try {
    const record = await prisma.stripeConnectAccount.create({
      data: {
        id: createId(),
        orgId,
        stripeAccountId: stripeAccount.id,
        status: 'pending',
        chargesEnabled: false,
        payoutsEnabled: false,
        defaultCurrency: (stripeAccount.default_currency ?? 'usd').toLowerCase(),
        country: normalizedCountry,
        requirementsJson: requirementsPayload(stripeAccount),
      },
      select: stripeConnectSelect,
    });

    void recordAudit({
      orgId,
      action: 'stripe_connect.account_created',
      entityType: 'stripe_connect_account',
      entityId: record.id,
      actorType: 'system',
      result: 'success',
      changes: {
        stripeAccountId: record.stripeAccountId,
        country: record.country,
        status: record.status,
      },
    });

    return record;
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new StripeConnectConflictError(requestId);
    }
    throw error;
  }
}

/**
 * Sync local Connect account state from a Stripe account.updated payload.
 */
export async function handleAccountUpdated(
  stripeAccountId: string,
  data: Stripe.Account,
  options: StripeConnectOptions = {},
): Promise<void> {
  const requestId = options.requestId ?? 'unknown';

  const existing = await prisma.stripeConnectAccount.findUnique({
    where: { stripeAccountId },
    select: stripeConnectSelect,
  });
  if (!existing) {
    throw new StripeConnectNotFoundError(requestId);
  }

  const status = mapStripeAccountStatus(data);
  const chargesEnabled = Boolean(data.charges_enabled);
  const payoutsEnabled = Boolean(data.payouts_enabled);

  await prisma.stripeConnectAccount.update({
    where: { id: existing.id },
    data: {
      status,
      chargesEnabled,
      payoutsEnabled,
      requirementsJson: requirementsPayload(data),
      defaultCurrency: (data.default_currency ?? existing.defaultCurrency).toLowerCase(),
    },
    select: { id: true },
  });

  void recordAudit({
    orgId: existing.orgId,
    action: 'stripe_connect.account_updated',
    entityType: 'stripe_connect_account',
    entityId: existing.id,
    actorType: 'system',
    result: 'success',
    changes: {
      previous: {
        status: existing.status,
        chargesEnabled: existing.chargesEnabled,
        payoutsEnabled: existing.payoutsEnabled,
      },
      next: {
        status,
        chargesEnabled,
        payoutsEnabled,
      },
    },
  });
}

/**
 * Whether the org's Connect account can receive platform transfers/payouts.
 */
export async function canReceivePayouts(orgId: string): Promise<boolean> {
  const account = await prisma.stripeConnectAccount.findUnique({
    where: { orgId },
    select: {
      status: true,
      chargesEnabled: true,
      payoutsEnabled: true,
    },
  });

  if (!account) {
    return false;
  }

  return (
    account.chargesEnabled &&
    account.payoutsEnabled &&
    account.status === 'active'
  );
}

/** Test helper — clears the shared Stripe circuit breaker. */
export function resetStripeConnectBreakers(): void {
  resetCircuitBreakers();
}