import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { createId } from '../lib/uuid.js';
import {
  buildTestApp,
  cleanupOrg,
  createTestOrgWithKey,
} from '../test/helpers.js';

describe('billing API', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let orgId: string;
  let apiKey: string;
  let subscriptionId: string;
  let invoiceId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    const org = await createTestOrgWithKey({
      tier: 'free',
      scopes: [
        'read:billing',
        'write:billing',
        'read:agents',
        'write:agents',
        'read:transactions',
        'write:transactions',
        'admin:keys',
      ],
    });
    orgId = org.org.id;
    apiKey = org.plaintextKey;

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);

    subscriptionId = createId();
    await prisma.subscription.create({
      data: {
        id: subscriptionId,
        orgId,
        tier: 'free',
        status: 'active',
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd: false,
      },
      select: { id: true },
    });

    invoiceId = createId();
    await prisma.invoice.create({
      data: {
        id: invoiceId,
        orgId,
        subscriptionId,
        invoiceNumber: `INV-TEST-${invoiceId.slice(0, 8)}`,
        status: 'paid',
        amountDueCents: 0n,
        amountPaidCents: 0n,
        currency: 'usd',
        lineItems: [{ description: 'Free tier', amountCents: 0 }],
        paidAt: now,
      },
      select: { id: true },
    });
  });

  afterAll(async () => {
    await cleanupOrg(orgId);
    await app.close();
  });

  it('returns billing profile', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/billing/profile',
      headers: { 'x-api-key': apiKey },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.organization.id).toBe(orgId);
    expect(body.organization.tier).toBe('free');
    expect(body.organization.balanceCents).toMatch(/^\d+$/);
    expect(body.subscription?.id).toBe(subscriptionId);
    expect(body.pricing.name).toBe('Free');
  });

  it('returns subscription', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/billing/subscription',
      headers: { 'x-api-key': apiKey },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.id).toBe(subscriptionId);
    expect(body.tier).toBe('free');
    expect(body.currentPeriodStart).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('lists and fetches invoices', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/billing/invoices?page=1&limit=10',
      headers: { 'x-api-key': apiKey },
    });
    expect(list.statusCode).toBe(200);
    const listed = list.json();
    expect(listed.data.length).toBeGreaterThanOrEqual(1);
    expect(listed.data[0].amountDueCents).toBe('0');
    expect(listed.meta.total).toBeGreaterThanOrEqual(1);

    const one = await app.inject({
      method: 'GET',
      url: `/v1/billing/invoices/${invoiceId}`,
      headers: { 'x-api-key': apiKey },
    });
    expect(one.statusCode).toBe(200);
    expect(one.json().id).toBe(invoiceId);
  });

  it('returns usage and limits via redis', async () => {
    const usage = await app.inject({
      method: 'GET',
      url: '/v1/billing/usage',
      headers: { 'x-api-key': apiKey },
    });
    expect(usage.statusCode).toBe(200);
    const usageBody = usage.json();
    expect(usageBody.orgId).toBe(orgId);
    expect(usageBody.tier).toBe('free');
    expect(usageBody.meters.api_calls).toMatchObject({
      usage: expect.any(Number),
      limit: expect.any(Number),
      hardLimit: expect.any(Number),
    });

    const limits = await app.inject({
      method: 'GET',
      url: '/v1/billing/limits',
      headers: { 'x-api-key': apiKey },
    });
    expect(limits.statusCode).toBe(200);
    const limitsBody = limits.json();
    expect(limitsBody.tier).toBe('free');
    expect(limitsBody.softLimitRatio).toBe(0.8);
    expect(limitsBody.hardLimitRatio).toBe(1);
  });

  it('rejects checkout without write scope validation for free tier body', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      headers: { 'x-api-key': apiKey },
      payload: {
        tier: 'free',
        successUrl: 'https://app.example/success',
        cancelUrl: 'https://app.example/cancel',
      },
    });
    expect(response.statusCode).toBe(422);
  });

  it('returns 404 for missing invoice', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/v1/billing/invoices/${createId()}`,
      headers: { 'x-api-key': apiKey },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('BILLING_NOT_FOUND');
  });
});
