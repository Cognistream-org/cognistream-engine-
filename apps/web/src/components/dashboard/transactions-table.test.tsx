import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TransactionsTable } from '@/components/dashboard/transactions-table';

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

import type { TransactionResponse } from '@cognistream/shared';

const sampleTransactions: TransactionResponse[] = [
  {
    id: '01900000-0000-7000-8000-000000000001',
    buyerId: '01900000-0000-7000-8000-000000000010',
    sellerId: '01900000-0000-7000-8000-000000000020',
    amountCents: '5000',
    feeCents: '150',
    description: 'Test payment',
    metadata: null,
    status: 'escrowed',
    idempotencyKey: null,
    createdAt: '2026-07-01T12:00:00.000Z',
    settledAt: null,
    buyer: {
      id: '01900000-0000-7000-8000-000000000010',
      orgId: 'org-1',
      name: 'Buyer Bot',
      publicKey: 'pk',
      reputationScore: '85',
      status: 'active',
    },
    seller: {
      id: '01900000-0000-7000-8000-000000000020',
      orgId: 'org-2',
      name: 'Seller Bot',
      publicKey: 'pk2',
      reputationScore: '90',
      status: 'active',
    },
  },
  {
    id: '01900000-0000-7000-8000-000000000002',
    buyerId: '01900000-0000-7000-8000-000000000011',
    sellerId: '01900000-0000-7000-8000-000000000021',
    amountCents: '10000',
    feeCents: '300',
    description: null,
    metadata: null,
    status: 'settled',
    idempotencyKey: null,
    createdAt: '2026-07-02T12:00:00.000Z',
    settledAt: '2026-07-03T12:00:00.000Z',
    buyer: { id: 'b', orgId: 'o', name: 'Alpha', publicKey: 'p', reputationScore: '50', status: 'active' },
    seller: { id: 's', orgId: 'o', name: 'Beta', publicKey: 'p', reputationScore: '50', status: 'active' },
  },
];

describe('TransactionsTable', () => {
  it('renders rows from props', () => {
    render(<TransactionsTable transactions={sampleTransactions} />);

    expect(screen.getByText('Buyer Bot')).toBeInTheDocument();
    expect(screen.getByText('Seller Bot')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(screen.getByText('escrowed')).toBeInTheDocument();
    expect(screen.getByText('settled')).toBeInTheDocument();
  });

  it('shows empty state when no transactions', () => {
    render(<TransactionsTable transactions={[]} />);

    expect(screen.getByText(/no transactions match/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view agents/i })).toBeInTheDocument();
  });
});
