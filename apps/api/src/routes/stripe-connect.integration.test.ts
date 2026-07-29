import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import {
  buildTestApp,
  cleanupOrg,
  createTestOrgWithKey,
} from '../test/helpers.js';

const stripeAccountsCreate = vi.fn();
const stripeAccountLinksCreate = vi.fn();
const stripeAccountsDel = vi.fn();

vi.mock('../lib/stripe.js', () => ({
  getStripeClient: () => ({
    accounts: {
      create: stripeAccountsCreate,
      del: stripeAccountsDel,
    },
    accountLinks: {
      create: stripeAccountLinksCreate,
    },
  }),
}));

describe('stripe connect API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let orgId: string;
  let apiKey: string;

  beforeAll(async () => {
    app = await buildTestApp();
    const org = await createTestOrgWithKey({
      tier: 'developer',
      scopes: ['read:billing', 'write:billing'],
    });
    orgId = org.org.id;
    apiKey = org.plaintextKey;

    stripeAccountsCreate.mockResolvedValue({
      id: 'acct_test_connect_1',
      default_currency: 'usd',
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: {
        currently_due: [],
        eventually_due: [],
        past_due: [],
        disabled_reason: null,
        pending_verification: [],
      },
    });
    stripeAccountLinksCreate.mockResolvedValue({
      url: 'https://connect.stripe.test/setup/s/test',
    });
    stripeAccountsDel.mockResolvedValue({ deleted: true, id: 'acct_test_connect_1' });
  });

  afterAll(async () => {
    await cleanupOrg(orgId);
    await app.close();
  });

  it('creates, reads, onboards, and disconnects connect account', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/v1/stripe/connect',
      headers: { 'x-api-key': apiKey },
      payload: { country: 'US' },
    });
    expect(created.statusCode).toBe(201);
    const account = created.json();
    expect(account.stripeAccountId).toBe('acct_test_connect_1');
    expect(account.country).toBe('us');
    expect(account.status).toBe('pending');

    const fetched = await app.inject({
      method: 'GET',
      url: '/v1/stripe/connect',
      headers: { 'x-api-key': apiKey },
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().id).toBe(account.id);

    const onboard = await app.inject({
      method: 'POST',
      url: '/v1/stripe/connect/onboarding',
      headers: { 'x-api-key': apiKey },
      payload: {
        returnUrl: 'https://app.example/return',
        refreshUrl: 'https://app.example/refresh',
      },
    });
    expect(onboard.statusCode).toBe(200);
    expect(onboard.json().url).toContain('connect.stripe.test');

    const updated = await prisma.stripeConnectAccount.findUnique({
      where: { orgId },
      select: { status: true, onboardingUrl: true },
    });
    expect(updated?.status).toBe('onboarding');
    expect(updated?.onboardingUrl).toContain('connect.stripe.test');

    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/stripe/connect',
      headers: { 'x-api-key': apiKey },
      payload: { country: 'us' },
    });
    expect(conflict.statusCode).toBe(409);

    const disconnected = await app.inject({
      method: 'DELETE',
      url: '/v1/stripe/connect',
      headers: { 'x-api-key': apiKey },
    });
    expect(disconnected.statusCode).toBe(204);

    const missing = await app.inject({
      method: 'GET',
      url: '/v1/stripe/connect',
      headers: { 'x-api-key': apiKey },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('returns 404 when connect account was never created', async () => {
    const other = await createTestOrgWithKey({
      tier: 'developer',
      scopes: ['read:billing'],
    });
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/stripe/connect',
        headers: { 'x-api-key': other.plaintextKey },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('STRIPE_CONNECT_NOT_FOUND');
    } finally {
      await cleanupOrg(other.org.id);
    }
  });
});
