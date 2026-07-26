import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const swrMockFn = vi.fn();
const formatCents = vi.fn((value: string | number) => `$${String(value)}`);

vi.mock('swr', () => ({
  default: (...args: unknown[]) => swrMockFn(...args),
}));

vi.mock('@/lib/api', () => ({
  proxyUrl: (path: string) => `/api/${path}`,
  fetchOverview: vi.fn(),
}));

vi.mock('@/lib/format', () => ({
  formatCents: (value: string | number) => formatCents(value),
}));

import { OverviewCards } from '@/components/dashboard/overview-cards';

describe('OverviewCards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    formatCents.mockImplementation((value: string | number) => `fmt:${value}`);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders all 4 stat cards with correct titles', () => {
    swrMockFn.mockReturnValue({ data: undefined, isLoading: false });
    render(<OverviewCards />);

    expect(screen.getByText('Transactions this month')).toBeInTheDocument();
    expect(screen.getByText('Volume this month')).toBeInTheDocument();
    expect(screen.getByText('Active agents')).toBeInTheDocument();
    expect(screen.getByText('Org balance')).toBeInTheDocument();
  });

  it('shows skeleton loaders while loading', () => {
    swrMockFn.mockReturnValue({ data: undefined, isLoading: true });
    const { container } = render(<OverviewCards />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(4);
  });

  it('displays correct values from API', () => {
    swrMockFn.mockReturnValue({
      data: {
        organization: {
          id: 'org-1',
          name: 'Acme',
          slug: 'acme',
          tier: 'free',
          balanceCents: '50000',
        },
        stats: {
          transactionsThisMonth: 12,
          volumeCentsThisMonth: '250000',
          activeAgents: 3,
        },
      },
      isLoading: false,
    });
    render(<OverviewCards />);

    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('fmt:250000')).toBeInTheDocument();
    expect(screen.getByText('fmt:50000')).toBeInTheDocument();
  });

  it('formats currency correctly', () => {
    swrMockFn.mockReturnValue({
      data: {
        organization: {
          id: 'org-1',
          name: 'Acme',
          slug: 'acme',
          tier: 'free',
          balanceCents: '12345',
        },
        stats: {
          transactionsThisMonth: 0,
          volumeCentsThisMonth: '999',
          activeAgents: 0,
        },
      },
      isLoading: false,
    });
    render(<OverviewCards />);

    expect(formatCents).toHaveBeenCalledWith('999');
    expect(formatCents).toHaveBeenCalledWith('12345');
    expect(screen.getByText('fmt:999')).toBeInTheDocument();
    expect(screen.getByText('fmt:12345')).toBeInTheDocument();
  });
});
