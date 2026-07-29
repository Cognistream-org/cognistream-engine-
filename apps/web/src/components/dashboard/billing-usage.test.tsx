import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type React from 'react';

const swrMockFn = vi.fn();
const formatCents = vi.fn((value: string | number) => `fmt:${value}`);

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="chart">{children}</div>
  ),
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null,
  Tooltip: () => null,
  Bar: () => null,
}));

vi.mock('swr', () => ({
  default: (...args: unknown[]) => swrMockFn(...args),
}));

vi.mock('@/lib/api', () => ({
  proxyUrl: (path: string) => `/api/${path}`,
  fetchBillingUsage: vi.fn(),
}));

vi.mock('@/lib/format', () => ({
  formatCents: (value: string | number) => formatCents(value),
}));

import { BillingUsage } from '@/components/dashboard/billing-usage';

const usage = {
  orgId: 'org-1',
  billingPeriod: '2026-07',
  tier: 'developer',
  meters: {
    api_calls: { usage: 250, limit: 10000, hardLimit: 12000 },
    transactions: { usage: 10, limit: 1000, hardLimit: 1200 },
  },
};

describe('BillingUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    formatCents.mockImplementation((value: string | number) => `fmt:${value}`);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows loading skeleton while loading', () => {
    swrMockFn.mockReturnValue({ data: undefined, isLoading: true, error: undefined });
    const { container } = render(<BillingUsage />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(1);
  });

  it('shows error message on failure', () => {
    swrMockFn.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Usage unavailable'),
    });
    render(<BillingUsage />);
    expect(screen.getByText('Usage unavailable')).toBeInTheDocument();
  });

  it('shows chart and quota meters when data is present', () => {
    swrMockFn.mockReturnValue({ data: usage, isLoading: false, error: undefined });
    render(<BillingUsage />);

    expect(screen.getByTestId('chart')).toBeInTheDocument();
    expect(screen.getAllByText('API calls').length).toBeGreaterThan(0);
    expect(screen.getByText('Quota progress')).toBeInTheDocument();
  });
});
