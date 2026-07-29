import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type Stripe from 'stripe';

const accountsCreate = vi.fn();
const accountLinksCreate = vi.fn();
const transfersCreate = vi.fn();
const accountsDel = vi.fn();

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    stripeConnectAccount: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    platformFeeLedger: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../lib/stripe.js', () => ({
  getStripeClient: vi.fn(() => ({
    accounts: { create: accountsCreate, del: accountsDel },
    accountLinks: { create: accountLinksCreate },
    transfers: { create: transfersCreate },
  })),
}));

vi.mock('../security/audit-runtime.js', () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/uuid.js', () => ({
  createId: vi.fn(() => '01900000-0000-7000-8000-000000000099'),
}));

import { prisma } from '../lib/prisma.js';
import { recordAudit } from '../security/audit-runtime.js';
import { CircuitOpenError } from '../resilience/circuit-breaker.js';
import {
  StripeConnectConflictError,
  StripeConnectError,
  StripeConnectNotFoundError,
  canReceivePayouts,
  createAccount,
  createOnboardingLink,
  createTransfer,
  disconnectAccount,
  getConnectAccountOrNull,
  handleAccountUpdated,
  mapStripeAccountStatus,
  resetStripeConnectBreakers,
  ONBOARDING_LINK_TTL_MS,
} from './stripe-connect.js';
import { AppError } from '../lib/errors.js';

const orgId = '01900000-0000-7000-8000-0000000000aa';
const accountId = '01900000-0000-7000-8000-000000000099';
const stripeAccountId = 'acct_test_123';

const baseRow = {
  id: accountId,
  orgId,
  stripeAccountId,
  status: 'pending' as const,
  chargesEnabled: false,
  payoutsEnabled: false,
  onboardingUrl: null,
  onboardingUrlExpiresAt: null,
  defaultCurrency: 'usd',
  country: 'us',
  requirementsJson: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

function stripeAccount(overrides: Partial<Stripe.Account> = {}): Stripe.Account {
  return {
    id: stripeAccountId,
    object: 'account',
    charges_enabled: false,
    payouts_enabled: false,
    details_submitted: false,
    default_currency: 'usd',
    requirements: {
      currently_due: [],
      eventually_due: [],
      past_due: [],
      pending_verification: [],
      disabled_reason: null,
    },
    ...overrides,
  } as Stripe.Account;
}

describe('mapStripeAccountStatus', () => {
  it('maps rejected / active / restricted / onboarding / pending', () => {
    expect(
      mapStripeAccountStatus(
        stripeAccount({
          requirements: { disabled_reason: 'rejected.fraud' } as unknown as Stripe.Account.Requirements,
        }),
      ),
    ).toBe('rejected');
    expect(
      mapStripeAccountStatus(
        stripeAccount({ charges_enabled: true, payouts_enabled: true }),
      ),
    ).toBe('active');
    expect(
      mapStripeAccountStatus(
        stripeAccount({
          requirements: { disabled_reason: 'requirements.past_due' } as unknown as Stripe.Account.Requirements,
        }),
      ),
    ).toBe('restricted');
    expect(
      mapStripeAccountStatus(stripeAccount({ details_submitted: true })),
    ).toBe('onboarding');
    expect(mapStripeAccountStatus(stripeAccount())).toBe('pending');
  });
});

describe('createAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStripeConnectBreakers();
  });

  it('creates Express account and persists pending row', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: orgId,
      name: 'Acme',
    } as never);
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue(null);
    accountsCreate.mockResolvedValue(stripeAccount());
    vi.mocked(prisma.stripeConnectAccount.create).mockResolvedValue(baseRow as never);

    const result = await createAccount(orgId, 'US');

    expect(result.id).toBe(accountId);
    expect(accountsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'express',
        country: 'US',
        metadata: expect.objectContaining({ orgId }),
      }),
    );
    expect(prisma.stripeConnectAccount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          orgId,
          stripeAccountId,
          status: 'pending',
          country: 'us',
        }),
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'stripe_connect.account_created',
        result: 'success',
        entityId: accountId,
      }),
    );
  });

  it('rejects duplicate org Connect account', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: orgId,
      name: 'Acme',
    } as never);
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue({
      id: accountId,
    } as never);

    await expect(createAccount(orgId, 'us')).rejects.toBeInstanceOf(
      StripeConnectConflictError,
    );
    expect(accountsCreate).not.toHaveBeenCalled();
  });

  it('maps Prisma P2002 to conflict', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: orgId,
      name: 'Acme',
    } as never);
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue(null);
    accountsCreate.mockResolvedValue(stripeAccount());
    vi.mocked(prisma.stripeConnectAccount.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '6',
      }),
    );

    await expect(createAccount(orgId, 'us')).rejects.toBeInstanceOf(
      StripeConnectConflictError,
    );
  });

  it('wraps Stripe API errors', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      id: orgId,
      name: 'Acme',
    } as never);
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue(null);
    accountsCreate.mockRejectedValue(new Error('stripe down'));

    await expect(createAccount(orgId, 'us')).rejects.toBeInstanceOf(StripeConnectError);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'stripe_connect.account_create_failed',
        result: 'failure',
      }),
    );
  });

  it('rejects invalid country', async () => {
    await expect(createAccount(orgId, 'USA')).rejects.toThrow(/country/);
  });

  it('throws when organization is missing', async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue(null);
    await expect(createAccount(orgId, 'us')).rejects.toThrow(/Organization not found/);
  });
});

describe('createOnboardingLink', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStripeConnectBreakers();
  });

  it('generates URL, stores expiry (~24h), and moves pending → onboarding', async () => {
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue(baseRow as never);
    accountLinksCreate.mockResolvedValue({
      object: 'account_link',
      url: 'https://connect.stripe.com/setup/test',
      expires_at: Math.floor(Date.now() / 1000) + 300,
    });
    vi.mocked(prisma.stripeConnectAccount.update).mockResolvedValue(baseRow as never);

    const before = Date.now();
    const url = await createOnboardingLink(
      accountId,
      'https://app.example/return',
      'https://app.example/refresh',
    );
    const after = Date.now();

    expect(url).toBe('https://connect.stripe.com/setup/test');
    expect(accountLinksCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        account: stripeAccountId,
        type: 'account_onboarding',
        return_url: 'https://app.example/return',
        refresh_url: 'https://app.example/refresh',
      }),
    );

    const updateArg = vi.mocked(prisma.stripeConnectAccount.update).mock.calls[0]?.[0];
    expect(updateArg?.data).toMatchObject({
      onboardingUrl: url,
      status: 'onboarding',
    });
    const expires = (updateArg?.data as { onboardingUrlExpiresAt: Date })
      .onboardingUrlExpiresAt;
    expect(expires.getTime()).toBeGreaterThanOrEqual(before + ONBOARDING_LINK_TTL_MS - 50);
    expect(expires.getTime()).toBeLessThanOrEqual(after + ONBOARDING_LINK_TTL_MS + 50);

    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'stripe_connect.onboarding_link_created',
        result: 'success',
      }),
    );
  });

  it('throws when Connect account missing', async () => {
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue(null);
    await expect(
      createOnboardingLink(accountId, 'https://a', 'https://b'),
    ).rejects.toBeInstanceOf(StripeConnectNotFoundError);
  });

  it('wraps Stripe link errors', async () => {
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue(baseRow as never);
    accountLinksCreate.mockRejectedValue(new Error('link failed'));
    await expect(
      createOnboardingLink(accountId, 'https://a', 'https://b'),
    ).rejects.toBeInstanceOf(StripeConnectError);
  });

  it('keeps non-pending status when refreshing link', async () => {
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue({
      ...baseRow,
      status: 'restricted',
    } as never);
    accountLinksCreate.mockResolvedValue({
      url: 'https://connect.stripe.com/setup/refresh',
    });
    vi.mocked(prisma.stripeConnectAccount.update).mockResolvedValue(baseRow as never);

    await createOnboardingLink(accountId, 'https://a', 'https://b');
    expect(prisma.stripeConnectAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'restricted' }),
      }),
    );
  });
});

describe('handleAccountUpdated', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs status, flags, and requirements', async () => {
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue(baseRow as never);
    vi.mocked(prisma.stripeConnectAccount.update).mockResolvedValue(baseRow as never);

    await handleAccountUpdated(
      stripeAccountId,
      stripeAccount({
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
        requirements: {
          currently_due: [],
          eventually_due: ['ssn'],
          past_due: [],
          pending_verification: [],
          disabled_reason: null,
        } as unknown as Stripe.Account.Requirements,
      }),
    );

    expect(prisma.stripeConnectAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'active',
          chargesEnabled: true,
          payoutsEnabled: true,
          requirementsJson: expect.objectContaining({
            eventually_due: ['ssn'],
          }),
        }),
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'stripe_connect.account_updated',
        result: 'success',
      }),
    );
  });

  it('throws when stripe account is unknown', async () => {
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue(null);
    await expect(
      handleAccountUpdated(stripeAccountId, stripeAccount()),
    ).rejects.toBeInstanceOf(StripeConnectNotFoundError);
  });
});

describe('canReceivePayouts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    {
      name: 'all enabled + active',
      row: { status: 'active', chargesEnabled: true, payoutsEnabled: true },
      expected: true,
    },
    {
      name: 'charges disabled',
      row: { status: 'active', chargesEnabled: false, payoutsEnabled: true },
      expected: false,
    },
    {
      name: 'payouts disabled',
      row: { status: 'active', chargesEnabled: true, payoutsEnabled: false },
      expected: false,
    },
    {
      name: 'not active',
      row: { status: 'onboarding', chargesEnabled: true, payoutsEnabled: true },
      expected: false,
    },
    {
      name: 'missing account',
      row: null,
      expected: false,
    },
  ])('$name → $expected', async ({ row, expected }) => {
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue(row as never);
    await expect(canReceivePayouts(orgId)).resolves.toBe(expected);
  });
});

describe('createTransfer', () => {
  const params = {
    stripeAccountId,
    amountCents: 10_000n,
    currency: 'USD',
    transactionId: '01900000-0000-7000-8000-0000000000tx',
    description: 'Net payout',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetStripeConnectBreakers();
  });

  it('creates transfer with Stripe idempotency key and audits', async () => {
    transfersCreate.mockResolvedValue({ id: 'tr_123' });
    vi.mocked(prisma.platformFeeLedger.update).mockResolvedValue({ id: 'led_1' } as never);
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue({
      orgId,
      id: accountId,
    } as never);

    const id = await createTransfer(params);
    expect(id).toBe('tr_123');
    expect(transfersCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 10_000,
        currency: 'usd',
        destination: stripeAccountId,
        metadata: { transactionId: params.transactionId },
      }),
      expect.objectContaining({
        idempotencyKey: `transfer:${params.transactionId}`,
      }),
    );
    expect(prisma.platformFeeLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { transactionId: params.transactionId },
        data: expect.objectContaining({ stripeTransferId: 'tr_123' }),
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'stripe_connect.transfer_created',
        entityId: params.transactionId,
        result: 'success',
      }),
    );
  });

  it('retries transient Stripe failures then succeeds', async () => {
    transfersCreate
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ id: 'tr_retry' });
    vi.mocked(prisma.platformFeeLedger.update).mockResolvedValue({ id: 'led_1' } as never);
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue({
      orgId,
      id: accountId,
    } as never);

    await expect(createTransfer(params)).resolves.toBe('tr_retry');
    expect(transfersCreate).toHaveBeenCalledTimes(2);
  });

  it('honors open circuit breaker', async () => {
    const { getCircuitBreaker } = await import('../resilience/circuit-breaker.js');
    getCircuitBreaker('stripe').forceOpen();

    await expect(createTransfer(params)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(transfersCreate).not.toHaveBeenCalled();
  });

  it('uses Redis idempotency and returns existing transfer on duplicate', async () => {
    const store = new Map<string, string>();
    const redis = {
      status: 'ready',
      connect: vi.fn(),
      set: vi.fn(async (key: string, value: string, _ex: string, _ttl: number, nx: string) => {
        if (nx === 'NX' && store.has(key)) return null;
        store.set(key, value);
        return 'OK';
      }),
      del: vi.fn(async (key: string) => {
        store.delete(key);
        return 1;
      }),
    };

    transfersCreate.mockResolvedValue({ id: 'tr_first' });
    vi.mocked(prisma.platformFeeLedger.update).mockResolvedValue({ id: 'led_1' } as never);
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue({
      orgId,
      id: accountId,
    } as never);

    const first = await createTransfer(params, { redis: redis as never });
    expect(first).toBe('tr_first');

    vi.mocked(prisma.platformFeeLedger.findUnique).mockResolvedValue({
      stripeTransferId: 'tr_first',
    } as never);

    const second = await createTransfer(params, { redis: redis as never });
    expect(second).toBe('tr_first');
    expect(transfersCreate).toHaveBeenCalledTimes(1);
  });

  it('throws conflict when duplicate Redis key has no ledger transfer yet', async () => {
    const redis = {
      status: 'ready',
      connect: vi.fn(),
      set: vi.fn(async () => null),
      del: vi.fn(),
    };
    vi.mocked(prisma.platformFeeLedger.findUnique).mockResolvedValue({
      stripeTransferId: null,
    } as never);

    await expect(createTransfer(params, { redis: redis as never })).rejects.toThrow(
      /already in progress/,
    );
  });

  it('rejects non-positive amountCents', async () => {
    await expect(
      createTransfer({ ...params, amountCents: 0n }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('continues when platform fee ledger row is missing', async () => {
    transfersCreate.mockResolvedValue({ id: 'tr_orphan' });
    vi.mocked(prisma.platformFeeLedger.update).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('missing', {
        code: 'P2025',
        clientVersion: '6',
      }),
    );
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue(null);

    await expect(createTransfer(params)).resolves.toBe('tr_orphan');
    expect(recordAudit).toHaveBeenCalled();
  });

  it('rejects amountCents exceeding MAX_SAFE_INTEGER', async () => {
    await expect(
      createTransfer({
        ...params,
        amountCents: BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(transfersCreate).not.toHaveBeenCalled();
  });
});

describe('getConnectAccountOrNull', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when findUnique returns null', async () => {
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue(null);
    await expect(getConnectAccountOrNull(orgId)).resolves.toBeNull();
  });

  it('returns row when present', async () => {
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue(baseRow as never);
    await expect(getConnectAccountOrNull(orgId)).resolves.toEqual(baseRow);
  });
});

describe('disconnectAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStripeConnectBreakers();
  });

  it('throws StripeConnectError when accountsDel fails before delete', async () => {
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue(baseRow as never);
    accountsDel.mockRejectedValue(new Error('del fail'));

    await expect(disconnectAccount(orgId)).rejects.toBeInstanceOf(StripeConnectError);
    expect(prisma.stripeConnectAccount.delete).not.toHaveBeenCalled();
  });

  it('deletes row and audits when Stripe succeeds', async () => {
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue(baseRow as never);
    accountsDel.mockResolvedValue({ id: stripeAccountId, deleted: true });
    vi.mocked(prisma.stripeConnectAccount.delete).mockResolvedValue({ id: accountId } as never);

    await disconnectAccount(orgId);

    expect(accountsDel).toHaveBeenCalledWith(stripeAccountId);
    expect(prisma.stripeConnectAccount.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: accountId },
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'stripe_connect.account_disconnected',
        result: 'success',
        entityId: accountId,
      }),
    );
  });
});
