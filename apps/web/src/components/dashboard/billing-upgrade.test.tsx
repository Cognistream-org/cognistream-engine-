import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const createCheckoutSession = vi.fn();
const formatCents = vi.fn((value: string | number) => `fmt:${value}`);

vi.mock('@/lib/api', () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSession(...args),
}));

vi.mock('@/lib/format', () => ({
  formatCents: (value: string | number) => formatCents(value),
}));

import { BillingUpgrade } from '@/components/dashboard/billing-upgrade';

describe('BillingUpgrade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    formatCents.mockImplementation((value: string | number) => `fmt:${value}`);
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        origin: 'http://localhost:3000',
        href: 'http://localhost:3000/dashboard/billing/upgrade',
      },
      writable: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('shows Developer and Enterprise tiers', () => {
    render(<BillingUpgrade />);
    expect(screen.getByText('Developer')).toBeInTheDocument();
    expect(screen.getByText('Enterprise')).toBeInTheDocument();
  });

  it('starts checkout for developer with success and cancel urls', async () => {
    const user = userEvent.setup();
    createCheckoutSession.mockResolvedValue({
      url: 'https://checkout.stripe.com/pay/cs_test',
      sessionId: 'cs_test',
    });
    render(<BillingUpgrade />);

    await user.click(screen.getByRole('button', { name: /upgrade to developer/i }));
    await waitFor(() => {
      expect(createCheckoutSession).toHaveBeenCalledWith({
        tier: 'developer',
        cycle: 'monthly',
        successUrl: 'http://localhost:3000/dashboard/billing?checkout=success',
        cancelUrl: 'http://localhost:3000/dashboard/billing/upgrade?checkout=cancel',
      });
      expect(window.location.href).toBe('https://checkout.stripe.com/pay/cs_test');
    });
  });

  it('shows error when createCheckoutSession rejects', async () => {
    const user = userEvent.setup();
    createCheckoutSession.mockRejectedValue(new Error('Checkout failed'));
    render(<BillingUpgrade />);

    await user.click(screen.getByRole('button', { name: /upgrade to developer/i }));
    await waitFor(() => {
      expect(screen.getByText('Checkout failed')).toBeInTheDocument();
    });
  });
});
