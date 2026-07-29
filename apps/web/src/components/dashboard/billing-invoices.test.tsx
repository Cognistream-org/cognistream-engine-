import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

const swrMockFn = vi.fn();
const formatCents = vi.fn((value: string | number) => `fmt:${value}`);
const formatDate = vi.fn((iso: string) => `date:${iso}`);

vi.mock('swr', () => ({
  default: (...args: unknown[]) => swrMockFn(...args),
}));

vi.mock('@/lib/api', () => ({
  proxyUrl: (path: string) => `/api/${path}`,
  fetchInvoices: vi.fn(),
}));

vi.mock('@/lib/format', () => ({
  formatCents: (value: string | number) => formatCents(value),
  formatDate: (iso: string) => formatDate(iso),
}));

import { BillingInvoices } from '@/components/dashboard/billing-invoices';

const invoice = {
  id: 'inv-1',
  orgId: 'org-1',
  subscriptionId: 'sub-1',
  stripeInvoiceId: 'in_1',
  invoiceNumber: 'INV-100',
  status: 'paid',
  amountDueCents: '4900',
  amountPaidCents: '4900',
  currency: 'usd',
  pdfUrl: null,
  hostedUrl: null,
  dueDate: null,
  paidAt: '2026-07-02T00:00:00.000Z',
  lineItems: [],
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-02T00:00:00.000Z',
};

describe('BillingInvoices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    formatCents.mockImplementation((value: string | number) => `fmt:${value}`);
    formatDate.mockImplementation((iso: string) => `date:${iso}`);
  });

  afterEach(() => {
    cleanup();
  });

  it('shows loading skeletons while loading', () => {
    swrMockFn.mockReturnValue({ data: undefined, isLoading: true, error: undefined });
    const { container } = render(<BillingInvoices />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });

  it('shows empty state when there are no invoices', () => {
    swrMockFn.mockReturnValue({
      data: { data: [], meta: { page: 1, limit: 50, total: 0, totalPages: 0 } },
      isLoading: false,
      error: undefined,
    });
    render(<BillingInvoices />);
    expect(screen.getByText('No invoices yet.')).toBeInTheDocument();
  });

  it('lists invoices with numbers and formatted amounts', () => {
    swrMockFn.mockReturnValue({
      data: { data: [invoice], meta: { page: 1, limit: 50, total: 1, totalPages: 1 } },
      isLoading: false,
      error: undefined,
    });
    render(<BillingInvoices />);

    expect(screen.getByText('INV-100')).toBeInTheDocument();
    expect(formatCents).toHaveBeenCalledWith('4900');
    expect(screen.getAllByText('fmt:4900').length).toBeGreaterThan(0);
  });

  it('shows error message on failure', () => {
    swrMockFn.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('Failed to load invoices'),
    });
    render(<BillingInvoices />);
    expect(screen.getByText('Failed to load invoices')).toBeInTheDocument();
  });
});
