import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { registerErrorHandler } from '../lib/error-handler.js';
import { AppError } from '../lib/errors.js';
import { forbidden } from '../lib/http.js';

let authScopes: string[] = ['read:billing', 'write:billing'];
let setAuth = true;
let authenticateSendsReply = false;

vi.mock('../services/billing.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getBillingProfile: vi.fn(),
    createCheckoutSession: vi.fn(),
    createPortalSession: vi.fn(),
    getSubscription: vi.fn(),
    changeTier: vi.fn(),
    cancelSubscription: vi.fn(),
    listInvoices: vi.fn(),
    getInvoice: vi.fn(),
    getUsageSummary: vi.fn(),
    getLimits: vi.fn(),
  };
});

import {
  BillingConflictError,
  BillingNotFoundError,
  BillingStripeError,
  cancelSubscription,
  changeTier,
  createCheckoutSession,
  createPortalSession,
  getBillingProfile,
  getInvoice,
  getLimits,
  getSubscription,
  getUsageSummary,
  listInvoices,
} from '../services/billing.js';
import { billingRoutes } from './billing.js';

const subscriptionRow = {
  id: '01900000-0000-7000-8000-000000000099',
  orgId: 'org-1',
  stripeSubscriptionId: 'sub_123',
  stripeCustomerId: 'cus_123',
  tier: 'developer' as const,
  status: 'active' as const,
  trialEndsAt: null,
  currentPeriodStart: new Date('2026-07-01T00:00:00.000Z'),
  currentPeriodEnd: new Date('2026-08-01T00:00:00.000Z'),
  cancelAtPeriodEnd: false,
  canceledAt: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-01T00:00:00.000Z'),
};

const invoiceRow = {
  id: '01900000-0000-7000-8000-0000000000aa',
  orgId: 'org-1',
  subscriptionId: subscriptionRow.id,
  stripeInvoiceId: 'in_123',
  invoiceNumber: 'INV-001',
  status: 'paid',
  amountDueCents: 4900n,
  amountPaidCents: 4900n,
  currency: 'usd',
  pdfUrl: 'https://files.stripe.com/inv.pdf',
  hostedUrl: 'https://invoice.stripe.com/i/test',
  dueDate: new Date('2026-07-15T00:00:00.000Z'),
  paidAt: new Date('2026-07-10T00:00:00.000Z'),
  lineItems: [],
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
  updatedAt: new Date('2026-07-01T00:00:00.000Z'),
};

async function buildBillingApp(options?: { skipScopeCheck?: boolean }) {
  const app = Fastify({ logger: false });
  registerErrorHandler(app as never);
  app.decorate('redis', { status: 'ready' } as never);

  await app.register(
    fp(
      async (instance) => {
        instance.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply) => {
          if (authenticateSendsReply) {
            reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'nope' } });
            return;
          }
          if (setAuth) {
            req.auth = {
              orgId: 'org-1',
              apiKeyId: 'k',
              scopes: [...authScopes],
              tier: 'developer',
            };
          }
        });
        instance.decorate(
          'requireScopes',
          (...required: string[]) =>
            async (req: FastifyRequest, reply: FastifyReply) => {
              await instance.authenticate(req, reply);
              if (reply.sent) {
                return;
              }
              if (options?.skipScopeCheck) {
                return;
              }
              const scopes = req.auth?.scopes ?? [];
              const missing = required.filter((scope) => !scopes.includes(scope));
              if (missing.length > 0) {
                forbidden(
                  reply,
                  String(req.id),
                  `Missing required scope(s): ${missing.join(', ')}`,
                );
              }
            },
        );
      },
      { name: 'auth-plugin' },
    ),
  );

  await app.register(billingRoutes, { prefix: '/v1' });
  return app;
}

describe('billing routes (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authScopes = ['read:billing', 'write:billing'];
    setAuth = true;
    authenticateSendsReply = false;
  });

  it('GET /v1/billing/profile returns profile', async () => {
    vi.mocked(getBillingProfile).mockResolvedValue({
      organization: {
        id: 'org-1',
        name: 'Acme',
        slug: 'acme',
        tier: 'developer',
        balanceCents: 10_000n,
      },
      subscription: subscriptionRow,
      pricing: {
        name: 'Developer',
        monthlyPriceCents: 4900,
        yearlyPriceCents: 49_000,
        limits: {},
        features: {},
        platformFeeBasisPoints: 250,
        overage: null,
      },
    } as never);

    const app = await buildBillingApp();
    const res = await app.inject({ method: 'GET', url: '/v1/billing/profile' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      organization: { id: 'org-1', balanceCents: '10000', tier: 'developer' },
      subscription: { id: subscriptionRow.id, tier: 'developer' },
      pricing: { name: 'Developer' },
    });
    await app.close();
  });

  it('GET /v1/billing/profile returns null subscription', async () => {
    vi.mocked(getBillingProfile).mockResolvedValue({
      organization: {
        id: 'org-1',
        name: 'Acme',
        slug: 'acme',
        tier: 'free',
        balanceCents: 0n,
      },
      subscription: null,
      pricing: {
        name: 'Free',
        monthlyPriceCents: 0,
        yearlyPriceCents: 0,
        limits: {},
        features: {},
        platformFeeBasisPoints: 300,
        overage: null,
      },
    } as never);

    const app = await buildBillingApp();
    const res = await app.inject({ method: 'GET', url: '/v1/billing/profile' });
    expect(res.statusCode).toBe(200);
    expect(res.json().subscription).toBeNull();
    await app.close();
  });

  it('POST /v1/billing/checkout returns session url', async () => {
    vi.mocked(createCheckoutSession).mockResolvedValue({
      url: 'https://checkout.stripe.com/c/test',
      sessionId: 'cs_test',
    });

    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      payload: {
        tier: 'developer',
        cycle: 'monthly',
        successUrl: 'https://app.example/success',
        cancelUrl: 'https://app.example/cancel',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      url: 'https://checkout.stripe.com/c/test',
      sessionId: 'cs_test',
    });
    await app.close();
  });

  it('GET /v1/billing/portal returns portal url with read:billing', async () => {
    authScopes = ['read:billing'];
    vi.mocked(createPortalSession).mockResolvedValue('https://billing.stripe.com/p/test');

    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/billing/portal?returnUrl=https%3A%2F%2Fapp.example%2Fbilling',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: 'https://billing.stripe.com/p/test' });
    await app.close();
  });

  it('GET /v1/billing/portal returns portal url with write:billing only', async () => {
    authScopes = ['write:billing'];
    vi.mocked(createPortalSession).mockResolvedValue('https://billing.stripe.com/p/write');

    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/billing/portal?returnUrl=https%3A%2F%2Fapp.example%2Fbilling',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: 'https://billing.stripe.com/p/write' });
    await app.close();
  });

  it('GET /v1/billing/subscription returns subscription', async () => {
    vi.mocked(getSubscription).mockResolvedValue(subscriptionRow as never);

    const app = await buildBillingApp();
    const res = await app.inject({ method: 'GET', url: '/v1/billing/subscription' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: subscriptionRow.id, tier: 'developer' });
    await app.close();
  });

  it('PATCH /v1/billing/subscription changes tier', async () => {
    vi.mocked(changeTier).mockResolvedValue({
      ...subscriptionRow,
      tier: 'enterprise',
    } as never);

    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/billing/subscription',
      payload: { tier: 'enterprise' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().tier).toBe('enterprise');
    await app.close();
  });

  it('DELETE /v1/billing/subscription cancels', async () => {
    vi.mocked(cancelSubscription).mockResolvedValue({
      ...subscriptionRow,
      cancelAtPeriodEnd: true,
    } as never);

    const app = await buildBillingApp();
    const res = await app.inject({ method: 'DELETE', url: '/v1/billing/subscription' });
    expect(res.statusCode).toBe(200);
    expect(res.json().cancelAtPeriodEnd).toBe(true);
    await app.close();
  });

  it('GET /v1/billing/invoices lists invoices', async () => {
    vi.mocked(listInvoices).mockResolvedValue({
      items: [invoiceRow],
      total: 1,
      page: 1,
      limit: 20,
    });

    const app = await buildBillingApp();
    const res = await app.inject({ method: 'GET', url: '/v1/billing/invoices' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      data: [{ invoiceNumber: 'INV-001', amountDueCents: '4900' }],
      meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });
    await app.close();
  });

  it('GET /v1/billing/invoices/:id returns invoice', async () => {
    vi.mocked(getInvoice).mockResolvedValue(invoiceRow);

    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/billing/invoices/${invoiceRow.id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().invoiceNumber).toBe('INV-001');
    await app.close();
  });

  it('GET /v1/billing/usage returns usage summary', async () => {
    vi.mocked(getUsageSummary).mockResolvedValue({
      orgId: 'org-1',
      billingPeriod: '2026-07',
      tier: 'developer',
      meters: {
        api_calls: { usage: 10, quota: 10_000, hardLimit: 12_000 },
      },
    } as never);

    const app = await buildBillingApp();
    const res = await app.inject({ method: 'GET', url: '/v1/billing/usage' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ billingPeriod: '2026-07', tier: 'developer' });
    await app.close();
  });

  it('GET /v1/billing/limits returns limits', async () => {
    vi.mocked(getLimits).mockResolvedValue({
      tier: 'developer',
      limits: { apiCallsPerMonth: 10_000 },
      usage: { api_calls: { usage: 1, limit: 10_000, hardLimit: 12_000 } },
      softLimitRatio: 0.8,
      hardLimitRatio: 1.2,
    } as never);

    const app = await buildBillingApp();
    const res = await app.inject({ method: 'GET', url: '/v1/billing/limits' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ softLimitRatio: 0.8, hardLimitRatio: 1.2 });
    await app.close();
  });

  it('propagates BillingStripeError from checkout', async () => {
    vi.mocked(createCheckoutSession).mockRejectedValue(
      new BillingStripeError('stripe down', 'req-1'),
    );

    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      payload: {
        tier: 'developer',
        successUrl: 'https://app.example/success',
        cancelUrl: 'https://app.example/cancel',
      },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('STRIPE_ERROR');
    await app.close();
  });

  it('propagates BillingNotFoundError from checkout', async () => {
    vi.mocked(createCheckoutSession).mockRejectedValue(
      new BillingNotFoundError('Organization not found', 'req-1'),
    );

    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      payload: {
        tier: 'developer',
        successUrl: 'https://app.example/success',
        cancelUrl: 'https://app.example/cancel',
      },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('BILLING_NOT_FOUND');
    await app.close();
  });

  it('propagates BillingConflictError from changeTier', async () => {
    vi.mocked(changeTier).mockRejectedValue(new BillingConflictError('conflict', 'req-1'));

    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/billing/subscription',
      payload: { tier: 'enterprise' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('BILLING_CONFLICT');
    await app.close();
  });

  it('propagates BillingNotFoundError from cancel', async () => {
    vi.mocked(cancelSubscription).mockRejectedValue(
      new BillingNotFoundError('Subscription not found', 'req-1'),
    );

    const app = await buildBillingApp();
    const res = await app.inject({ method: 'DELETE', url: '/v1/billing/subscription' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('BILLING_NOT_FOUND');
    await app.close();
  });

  it('propagates BillingNotFoundError from getInvoice', async () => {
    vi.mocked(getInvoice).mockRejectedValue(new BillingNotFoundError('Invoice not found', 'req-1'));

    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/billing/invoices/${invoiceRow.id}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('BILLING_NOT_FOUND');
    await app.close();
  });

  
  it('propagates unexpected errors from profile', async () => {
    vi.mocked(getBillingProfile).mockRejectedValue(new Error('profile fail'));

    const app = await buildBillingApp();
    const res = await app.inject({ method: 'GET', url: '/v1/billing/profile' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('propagates AppError from profile', async () => {
    vi.mocked(getBillingProfile).mockRejectedValue(
      new AppError('GENERIC', 'boom', 400, 'req-1'),
    );

    const app = await buildBillingApp();
    const res = await app.inject({ method: 'GET', url: '/v1/billing/profile' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('GENERIC');
    await app.close();
  });

  it('propagates unexpected errors from checkout', async () => {
    vi.mocked(createCheckoutSession).mockRejectedValue(new Error('unexpected'));

    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      payload: {
        tier: 'developer',
        successUrl: 'https://app.example/success',
        cancelUrl: 'https://app.example/cancel',
      },
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('propagates unexpected errors from portal', async () => {
    vi.mocked(createPortalSession).mockRejectedValue(new Error('portal fail'));

    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/billing/portal?returnUrl=https%3A%2F%2Fapp.example%2Fbilling',
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('propagates unexpected errors from subscription GET', async () => {
    vi.mocked(getSubscription).mockRejectedValue(new Error('sub fail'));

    const app = await buildBillingApp();
    const res = await app.inject({ method: 'GET', url: '/v1/billing/subscription' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('propagates unexpected errors from changeTier', async () => {
    vi.mocked(changeTier).mockRejectedValue(new Error('tier fail'));

    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/billing/subscription',
      payload: { tier: 'enterprise' },
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('propagates unexpected errors from cancel', async () => {
    vi.mocked(cancelSubscription).mockRejectedValue(new Error('cancel fail'));

    const app = await buildBillingApp();
    const res = await app.inject({ method: 'DELETE', url: '/v1/billing/subscription' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('propagates unexpected errors from getInvoice', async () => {
    vi.mocked(getInvoice).mockRejectedValue(new Error('invoice fail'));

    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/billing/invoices/${invoiceRow.id}`,
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('propagates unexpected errors from usage', async () => {
    vi.mocked(getUsageSummary).mockRejectedValue(new Error('usage fail'));

    const app = await buildBillingApp();
    const res = await app.inject({ method: 'GET', url: '/v1/billing/usage' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('propagates unexpected errors from limits', async () => {
    vi.mocked(getLimits).mockRejectedValue(new Error('limits fail'));

    const app = await buildBillingApp();
    const res = await app.inject({ method: 'GET', url: '/v1/billing/limits' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('returns early when auth is missing on profile', async () => {
    setAuth = false;
    const app = await buildBillingApp({ skipScopeCheck: true });
    const res = await app.inject({ method: 'GET', url: '/v1/billing/profile' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
    expect(getBillingProfile).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns early when auth is missing on checkout', async () => {
    setAuth = false;
    const app = await buildBillingApp({ skipScopeCheck: true });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      payload: {
        tier: 'developer',
        successUrl: 'https://app.example/success',
        cancelUrl: 'https://app.example/cancel',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(createCheckoutSession).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns early when auth is missing on portal', async () => {
    setAuth = false;
    const app = await buildBillingApp({ skipScopeCheck: true });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/billing/portal?returnUrl=https%3A%2F%2Fapp.example%2Fbilling',
    });
    expect(createPortalSession).not.toHaveBeenCalled();
    expect([200, 403]).toContain(res.statusCode);
    await app.close();
  });

  it('returns early when portal authenticate already sent reply', async () => {
    authenticateSendsReply = true;
    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/billing/portal?returnUrl=https%3A%2F%2Fapp.example%2Fbilling',
    });
    expect(res.statusCode).toBe(401);
    expect(createPortalSession).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns early when auth is missing on subscription GET', async () => {
    setAuth = false;
    const app = await buildBillingApp({ skipScopeCheck: true });
    const res = await app.inject({ method: 'GET', url: '/v1/billing/subscription' });
    expect(res.body).toBe('');
    expect(getSubscription).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns early when auth is missing on PATCH subscription', async () => {
    setAuth = false;
    const app = await buildBillingApp({ skipScopeCheck: true });
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/billing/subscription',
      payload: { tier: 'enterprise' },
    });
    expect(changeTier).not.toHaveBeenCalled();
    expect(res.body).toBe('');
    await app.close();
  });

  it('returns early when auth is missing on DELETE subscription', async () => {
    setAuth = false;
    const app = await buildBillingApp({ skipScopeCheck: true });
    await app.inject({ method: 'DELETE', url: '/v1/billing/subscription' });
    expect(cancelSubscription).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns early when auth is missing on invoices list', async () => {
    setAuth = false;
    const app = await buildBillingApp({ skipScopeCheck: true });
    await app.inject({ method: 'GET', url: '/v1/billing/invoices' });
    expect(listInvoices).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns early when auth is missing on invoice get', async () => {
    setAuth = false;
    const app = await buildBillingApp({ skipScopeCheck: true });
    await app.inject({ method: 'GET', url: `/v1/billing/invoices/${invoiceRow.id}` });
    expect(getInvoice).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns early when auth is missing on usage', async () => {
    setAuth = false;
    const app = await buildBillingApp({ skipScopeCheck: true });
    await app.inject({ method: 'GET', url: '/v1/billing/usage' });
    expect(getUsageSummary).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns early when auth is missing on limits', async () => {
    setAuth = false;
    const app = await buildBillingApp({ skipScopeCheck: true });
    await app.inject({ method: 'GET', url: '/v1/billing/limits' });
    expect(getLimits).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 422 when checkout tier is free', async () => {
    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      payload: {
        tier: 'free',
        successUrl: 'https://app.example/success',
        cancelUrl: 'https://app.example/cancel',
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    expect(createCheckoutSession).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 422 when checkout body is invalid', async () => {
    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout',
      payload: { tier: 'developer' },
    });
    expect(res.statusCode).toBe(422);
    await app.close();
  });

  it('returns 422 when portal returnUrl is missing', async () => {
    const app = await buildBillingApp();
    const res = await app.inject({ method: 'GET', url: '/v1/billing/portal' });
    expect(res.statusCode).toBe(422);
    expect(createPortalSession).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 403 when portal lacks billing scopes', async () => {
    authScopes = ['read:agents'];
    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/billing/portal?returnUrl=https%3A%2F%2Fapp.example%2Fbilling',
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('FORBIDDEN');
    expect(createPortalSession).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 422 when PATCH tier is invalid', async () => {
    const app = await buildBillingApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/billing/subscription',
      payload: { tier: 'gold' },
    });
    expect(res.statusCode).toBe(422);
    expect(changeTier).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 404 when subscription is missing on GET', async () => {
    vi.mocked(getSubscription).mockResolvedValue(null);

    const app = await buildBillingApp();
    const res = await app.inject({ method: 'GET', url: '/v1/billing/subscription' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('BILLING_NOT_FOUND');
    await app.close();
  });
});



