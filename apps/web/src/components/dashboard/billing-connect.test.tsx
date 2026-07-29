import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const swrMockFn = vi.fn();
const mutate = vi.fn();
const createStripeConnect = vi.fn();
const createConnectOnboarding = vi.fn();
const disconnectStripeConnect = vi.fn();

vi.mock('swr', () => ({
  default: (...args: unknown[]) => swrMockFn(...args),
}));

vi.mock('@/lib/api', () => ({
  proxyUrl: (path: string) => `/api/${path}`,
  fetchStripeConnect: vi.fn(),
  createStripeConnect: (...args: unknown[]) => createStripeConnect(...args),
  createConnectOnboarding: (...args: unknown[]) => createConnectOnboarding(...args),
  disconnectStripeConnect: (...args: unknown[]) => disconnectStripeConnect(...args),
}));

import { BillingConnect } from '@/components/dashboard/billing-connect';

const connectAccount = {
  id: 'conn-1',
  orgId: 'org-1',
  stripeAccountId: 'acct_123',
  status: 'pending',
  chargesEnabled: false,
  payoutsEnabled: false,
  onboardingUrl: null,
  onboardingUrlExpiresAt: null,
  defaultCurrency: 'usd',
  country: 'us',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

describe('BillingConnect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutate.mockResolvedValue(undefined);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'http://localhost:3000',
        href: 'http://localhost:3000/dashboard/billing/connect',
      },
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows Create Connect account when missing and creates on click', async () => {
    const user = userEvent.setup();
    createStripeConnect.mockResolvedValue(connectAccount);
    swrMockFn.mockReturnValue({
      data: undefined,
      error: new Error('Not found'),
      isLoading: false,
      mutate,
    });
    render(<BillingConnect />);

    expect(screen.getByRole('button', { name: /create connect account/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /create connect account/i }));
    await waitFor(() => {
      expect(createStripeConnect).toHaveBeenCalledWith({ country: 'us' });
      expect(mutate).toHaveBeenCalled();
    });
  });

  it('shows status badges when data is present', () => {
    swrMockFn.mockReturnValue({
      data: {
        ...connectAccount,
        status: 'active',
        chargesEnabled: true,
        payoutsEnabled: false,
      },
      isLoading: false,
      mutate,
    });
    render(<BillingConnect />);

    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('Charges enabled')).toBeInTheDocument();
    expect(screen.getByText('Payouts disabled')).toBeInTheDocument();
  });

  it('continues onboarding and redirects to returned url', async () => {
    const user = userEvent.setup();
    createConnectOnboarding.mockResolvedValue({ url: 'https://connect.stripe.com/setup/s/abc' });
    swrMockFn.mockReturnValue({
      data: connectAccount,
      isLoading: false,
      mutate,
    });
    render(<BillingConnect />);

    await user.click(screen.getByRole('button', { name: /continue onboarding/i }));
    await waitFor(() => {
      expect(createConnectOnboarding).toHaveBeenCalledWith({
        returnUrl: 'http://localhost:3000/dashboard/billing/connect?onboarding=return',
        refreshUrl: 'http://localhost:3000/dashboard/billing/connect?onboarding=refresh',
      });
      expect(window.location.href).toBe('https://connect.stripe.com/setup/s/abc');
    });
  });

  it('disconnects Connect account and mutates', async () => {
    const user = userEvent.setup();
    disconnectStripeConnect.mockResolvedValue(undefined);
    swrMockFn.mockReturnValue({
      data: {
        ...connectAccount,
        chargesEnabled: true,
        payoutsEnabled: true,
      },
      isLoading: false,
      mutate,
    });
    render(<BillingConnect />);

    await user.click(screen.getByRole('button', { name: /disconnect/i }));
    await waitFor(() => {
      expect(disconnectStripeConnect).toHaveBeenCalled();
      expect(mutate).toHaveBeenCalled();
    });
  });
});
