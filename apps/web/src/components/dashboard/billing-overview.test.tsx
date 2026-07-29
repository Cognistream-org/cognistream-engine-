import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const swrMockFn = vi.fn();
const formatCents = vi.fn((value: string | number) => `fmt:${value}`);
const formatDate = vi.fn((iso: string) => `date:${iso}`);

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: ReactNode;
    href: string;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('swr', () => ({
  default: (...args: unknown[]) => swrMockFn(...args),
}));

vi.mock('@/lib/api', () => ({
  proxyUrl: (path: string) => `/api/${path}`,
  fetchBillingProfile: vi.fn(),
  fetchBillingUsage: vi.fn(),
  fetchInvoices: vi.fn(),
}));

vi.mock('@/lib/format', () => ({
  formatCents: (value: string | number) => formatCents(value),
  formatDate: (iso: string) => formatDate(iso),
}));

import { BillingOverview } from '@/components/dashboard/billing-overview';

const profile = {
  organization: {
    id: 'org-1',
    name: 'Acme',
    slug: 'acme',
    tier: 'developer',
    balanceCents: '0',
  },
  subscription: {
    id: 'sub-1',
    orgId: 'org-1',
    tier: 'developer' as const,
    status: 'active',
    stripeSubscriptionId: 'sub_stripe',
    stripeCustomerId: 'cus_1',
    trialEndsAt: null,
    currentPeriodStart: '2026-07-01T00:00:00.000Z',
    currentPeriodEnd: '2026-08-01T00:00:00.000Z',
    cancelAtPeriodEnd: false,
    canceledAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  },
  pricing: {
    name: 'Developer',
    monthlyPriceCents: 4900,
    yearlyPriceCents: 49000,
    limits: {},
    features: {},
    platformFeeBasisPoints: 250,
    overage: null,
  },
};

const usage = {
  orgId: 'org-1',
  billingPeriod: '2026-07',
  tier: 'developer',
  meters: {
    api_calls: { usage: 100, limit: 10000, hardLimit: 12000 },
    transactions: { usage: 5, limit: 1000, hardLimit: 1200 },
  },
};

const invoices = {
  data: [
    {
      id: 'inv-1',
      orgId: 'org-1',
      subscriptionId: 'sub-1',
      stripeInvoiceId: 'in_1',
      invoiceNumber: 'INV-001',
      status: 'open',
      amountDueCents: '4900',
      amountPaidCents: '0',
      currency: 'usd',
      pdfUrl: null,
      hostedUrl: null,
      dueDate: '2026-08-01T00:00:00.000Z',
      paidAt: null,
      lineItems: [],
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
  ],
  meta: { page: 1, limit: 1, total: 1, totalPages: 1 },
};

function mockSwrReady() {
  swrMockFn.mockImplementation((key: string) => {
    if (String(key).includes('profile')) return { data: profile, isLoading: false };
    if (String(key).includes('usage')) return { data: usage, isLoading: false };
    if (String(key).includes('invoices')) return { data: invoices, isLoading: false };
    return { data: undefined, isLoading: false };
  });
}

describe('BillingOverview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    formatCents.mockImplementation((value: string | number) => `fmt:${value}`);
    formatDate.mockImplementation((iso: string) => `date:${iso}`);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows loading skeletons when profile or usage is loading', () => {
    swrMockFn.mockImplementation((key: string) => {
      if (String(key).includes('profile')) return { data: undefined, isLoading: true };
      if (String(key).includes('usage')) return { data: undefined, isLoading: true };
      if (String(key).includes('invoices')) return { data: undefined, isLoading: false };
      return { data: undefined, isLoading: false };
    });
    const { container } = render(<BillingOverview />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('shows plan name and subscription status badge', () => {
    mockSwrReady();
    render(<BillingOverview />);

    expect(screen.getByText('developer')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
  });

  it('shows usage bars with meter labels', () => {
    mockSwrReady();
    render(<BillingOverview />);

    expect(screen.getByText('API calls')).toBeInTheDocument();
    expect(screen.getByText('Transactions')).toBeInTheDocument();
  });

  it('shows next invoice amount via formatCents', () => {
    mockSwrReady();
    render(<BillingOverview />);

    expect(formatCents).toHaveBeenCalledWith('4900');
    expect(screen.getByText('fmt:4900')).toBeInTheDocument();
  });

  it('shows No subscription badge when subscription is null', () => {
    swrMockFn.mockImplementation((key: string) => {
      if (String(key).includes('profile')) {
        return {
          data: { ...profile, subscription: null },
          isLoading: false,
        };
      }
      if (String(key).includes('usage')) return { data: usage, isLoading: false };
      if (String(key).includes('invoices')) return { data: invoices, isLoading: false };
      return { data: undefined, isLoading: false };
    });
    render(<BillingOverview />);

    expect(screen.getByText('No subscription')).toBeInTheDocument();
    expect(screen.queryByText('active')).not.toBeInTheDocument();
  });

  it('links upgrade to /dashboard/billing/upgrade', () => {
    mockSwrReady();
    render(<BillingOverview />);

    expect(screen.getByRole('link', { name: /upgrade/i })).toHaveAttribute(
      'href',
      '/dashboard/billing/upgrade',
    );
  });
});
