import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clientFetch,
  createCheckoutSession,
  createConnectOnboarding,
  createStripeConnect,
  disconnectStripeConnect,
  fetchBillingLimits,
  fetchBillingProfile,
  fetchBillingUsage,
  fetchInvoices,
  fetchOverview,
  fetchStripeConnect,
  proxyUrl,
} from './api';

const fetchMock = vi.fn();
global.fetch = fetchMock;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  });
});

describe('proxyUrl', () => {
  it('prefixes path with /api/', () => {
    expect(proxyUrl('v1/billing/profile')).toBe('/api/v1/billing/profile');
  });

  it('strips leading slash before prefixing', () => {
    expect(proxyUrl('/v1/x')).toBe('/api/v1/x');
  });
});

describe('clientFetch', () => {
  it('fetches via proxyUrl with Content-Type and returns parsed JSON', async () => {
    const payload = { hello: 'world' };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => payload,
    });

    const result = await clientFetch<{ hello: string }>('v1/billing/profile');

    expect(fetchMock).toHaveBeenCalledWith('/api/v1/billing/profile', {
      headers: {
        'Content-Type': 'application/json',
      },
    });
    expect(result).toEqual(payload);
  });

  it('throws Error with message from error body', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'Nope' } }),
    });

    await expect(clientFetch('v1/x')).rejects.toThrow('Nope');
  });

  it('throws Request failed (status) when error has no message', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    });

    await expect(clientFetch('v1/x')).rejects.toThrow('Request failed (502)');
  });

  it('returns undefined for 204 responses', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error('should not parse body');
      },
    });

    await expect(clientFetch('v1/x')).resolves.toBeUndefined();
  });
});

describe('billing helpers', () => {
  it('fetchBillingProfile', async () => {
    await fetchBillingProfile();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/billing/profile',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('fetchBillingUsage', async () => {
    await fetchBillingUsage();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/billing/usage',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('fetchBillingLimits', async () => {
    await fetchBillingLimits();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/billing/limits',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('fetchInvoices without params', async () => {
    await fetchInvoices();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/billing/invoices',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('fetchInvoices with params', async () => {
    await fetchInvoices({ page: '2', limit: '10' });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/billing/invoices?page=2&limit=10',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('createCheckoutSession', async () => {
    const body = {
      tier: 'developer' as const,
      cycle: 'monthly' as const,
      successUrl: 'https://example.com/success',
      cancelUrl: 'https://example.com/cancel',
    };
    await createCheckoutSession(body);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/billing/checkout',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('fetchStripeConnect', async () => {
    await fetchStripeConnect();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/stripe/connect',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('createStripeConnect', async () => {
    const body = { country: 'US' };
    await createStripeConnect(body);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/stripe/connect',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('createConnectOnboarding', async () => {
    const body = {
      returnUrl: 'https://example.com/return',
      refreshUrl: 'https://example.com/refresh',
    };
    await createConnectOnboarding(body);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/stripe/connect/onboarding',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('disconnectStripeConnect uses DELETE and handles 204', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => {
        throw new Error('should not parse body');
      },
    });

    await expect(disconnectStripeConnect()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/stripe/connect',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });
});

describe('non-billing helpers', () => {
  it('fetchOverview', async () => {
    await fetchOverview();
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/v1/overview',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });
});
