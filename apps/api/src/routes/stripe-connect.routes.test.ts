import { beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import fp from 'fastify-plugin';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { registerErrorHandler } from '../lib/error-handler.js';
import { AppError } from '../lib/errors.js';
import { forbidden } from '../lib/http.js';

let authScopes: string[] = ['read:billing', 'write:billing'];
let setAuth = true;

vi.mock('../services/stripe-connect.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    createAccount: vi.fn(),
    getConnectAccount: vi.fn(),
    createOnboardingLink: vi.fn(),
    disconnectAccount: vi.fn(),
  };
});

import {
  StripeConnectConflictError,
  StripeConnectError,
  StripeConnectNotFoundError,
  createAccount,
  createOnboardingLink,
  disconnectAccount,
  getConnectAccount,
} from '../services/stripe-connect.js';
import { stripeConnectRoutes } from './stripe-connect.js';

const connectRow = {
  id: '01900000-0000-7000-8000-000000000099',
  orgId: 'org-1',
  stripeAccountId: 'acct_test_123',
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

async function buildConnectApp(options?: { skipScopeCheck?: boolean }) {
  const app = Fastify({ logger: false });
  registerErrorHandler(app as never);
  app.decorate('redis', { status: 'ready' } as never);

  await app.register(
    fp(
      async (instance) => {
        instance.decorate('authenticate', async (req: FastifyRequest, _reply: FastifyReply) => {
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

  await app.register(stripeConnectRoutes, { prefix: '/v1' });
  return app;
}

describe('stripe-connect routes (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authScopes = ['read:billing', 'write:billing'];
    setAuth = true;
  });

  it('POST /v1/stripe/connect creates account', async () => {
    vi.mocked(createAccount).mockResolvedValue(connectRow as never);

    const app = await buildConnectApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/connect',
      payload: { country: 'US' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      id: connectRow.id,
      stripeAccountId: 'acct_test_123',
      country: 'us',
    });
    expect(createAccount).toHaveBeenCalledWith('org-1', 'us', expect.any(Object));
    await app.close();
  });

  it('GET /v1/stripe/connect returns account', async () => {
    vi.mocked(getConnectAccount).mockResolvedValue(connectRow as never);

    const app = await buildConnectApp();
    const res = await app.inject({ method: 'GET', url: '/v1/stripe/connect' });
    expect(res.statusCode).toBe(200);
    expect(res.json().stripeAccountId).toBe('acct_test_123');
    await app.close();
  });

  it('POST /v1/stripe/connect/onboarding returns url', async () => {
    vi.mocked(getConnectAccount).mockResolvedValue(connectRow as never);
    vi.mocked(createOnboardingLink).mockResolvedValue('https://connect.stripe.com/setup/test');

    const app = await buildConnectApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/connect/onboarding',
      payload: {
        returnUrl: 'https://app.example/return',
        refreshUrl: 'https://app.example/refresh',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: 'https://connect.stripe.com/setup/test' });
    expect(createOnboardingLink).toHaveBeenCalledWith(
      connectRow.id,
      'https://app.example/return',
      'https://app.example/refresh',
      expect.any(Object),
    );
    await app.close();
  });

  it('DELETE /v1/stripe/connect disconnects', async () => {
    vi.mocked(disconnectAccount).mockResolvedValue(undefined);

    const app = await buildConnectApp();
    const res = await app.inject({ method: 'DELETE', url: '/v1/stripe/connect' });
    expect(res.statusCode).toBe(204);
    expect(disconnectAccount).toHaveBeenCalledWith('org-1', expect.any(Object));
    await app.close();
  });

  it('returns 422 for invalid create body', async () => {
    const app = await buildConnectApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/connect',
      payload: { country: 'USA' },
    });
    expect(res.statusCode).toBe(422);
    expect(createAccount).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns 422 for invalid onboarding body', async () => {
    const app = await buildConnectApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/connect/onboarding',
      payload: { returnUrl: '/relative', refreshUrl: 'https://app.example/refresh' },
    });
    expect(res.statusCode).toBe(422);
    expect(createOnboardingLink).not.toHaveBeenCalled();
    await app.close();
  });

  it('propagates StripeConnectConflictError on create', async () => {
    vi.mocked(createAccount).mockRejectedValue(new StripeConnectConflictError('req-1'));

    const app = await buildConnectApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/connect',
      payload: { country: 'us' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('STRIPE_CONNECT_CONFLICT');
    await app.close();
  });

  it('propagates StripeConnectNotFoundError on get', async () => {
    vi.mocked(getConnectAccount).mockRejectedValue(new StripeConnectNotFoundError('req-1'));

    const app = await buildConnectApp();
    const res = await app.inject({ method: 'GET', url: '/v1/stripe/connect' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('STRIPE_CONNECT_NOT_FOUND');
    await app.close();
  });

  it('propagates StripeConnectNotFoundError on onboarding', async () => {
    vi.mocked(getConnectAccount).mockRejectedValue(new StripeConnectNotFoundError('req-1'));

    const app = await buildConnectApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/connect/onboarding',
      payload: {
        returnUrl: 'https://app.example/return',
        refreshUrl: 'https://app.example/refresh',
      },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('propagates StripeConnectNotFoundError on disconnect', async () => {
    vi.mocked(disconnectAccount).mockRejectedValue(new StripeConnectNotFoundError('req-1'));

    const app = await buildConnectApp();
    const res = await app.inject({ method: 'DELETE', url: '/v1/stripe/connect' });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('propagates StripeConnectError on create', async () => {
    vi.mocked(createAccount).mockRejectedValue(new StripeConnectError('stripe down', 'req-1'));

    const app = await buildConnectApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/connect',
      payload: { country: 'us' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('STRIPE_ERROR');
    await app.close();
  });

  it('propagates AppError on get', async () => {
    vi.mocked(getConnectAccount).mockRejectedValue(
      new AppError('GENERIC', 'boom', 400, 'req-1'),
    );

    const app = await buildConnectApp();
    const res = await app.inject({ method: 'GET', url: '/v1/stripe/connect' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('GENERIC');
    await app.close();
  });

  it('propagates unexpected errors on create', async () => {
    vi.mocked(createAccount).mockRejectedValue(new Error('unexpected'));

    const app = await buildConnectApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/connect',
      payload: { country: 'us' },
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('propagates unexpected errors on get', async () => {
    vi.mocked(getConnectAccount).mockRejectedValue(new Error('unexpected'));

    const app = await buildConnectApp();
    const res = await app.inject({ method: 'GET', url: '/v1/stripe/connect' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('propagates unexpected errors on onboarding', async () => {
    vi.mocked(getConnectAccount).mockResolvedValue(connectRow as never);
    vi.mocked(createOnboardingLink).mockRejectedValue(new Error('link fail'));

    const app = await buildConnectApp();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/stripe/connect/onboarding',
      payload: {
        returnUrl: 'https://app.example/return',
        refreshUrl: 'https://app.example/refresh',
      },
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('propagates unexpected errors on disconnect', async () => {
    vi.mocked(disconnectAccount).mockRejectedValue(new Error('disconnect fail'));

    const app = await buildConnectApp();
    const res = await app.inject({ method: 'DELETE', url: '/v1/stripe/connect' });
    expect(res.statusCode).toBe(500);
    await app.close();
  });

  it('returns early when auth is missing on create', async () => {
    setAuth = false;
    const app = await buildConnectApp({ skipScopeCheck: true });
    await app.inject({
      method: 'POST',
      url: '/v1/stripe/connect',
      payload: { country: 'us' },
    });
    expect(createAccount).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns early when auth is missing on get', async () => {
    setAuth = false;
    const app = await buildConnectApp({ skipScopeCheck: true });
    await app.inject({ method: 'GET', url: '/v1/stripe/connect' });
    expect(getConnectAccount).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns early when auth is missing on onboarding', async () => {
    setAuth = false;
    const app = await buildConnectApp({ skipScopeCheck: true });
    await app.inject({
      method: 'POST',
      url: '/v1/stripe/connect/onboarding',
      payload: {
        returnUrl: 'https://app.example/return',
        refreshUrl: 'https://app.example/refresh',
      },
    });
    expect(getConnectAccount).not.toHaveBeenCalled();
    await app.close();
  });

  it('returns early when auth is missing on disconnect', async () => {
    setAuth = false;
    const app = await buildConnectApp({ skipScopeCheck: true });
    await app.inject({ method: 'DELETE', url: '/v1/stripe/connect' });
    expect(disconnectAccount).not.toHaveBeenCalled();
    await app.close();
  });
});


