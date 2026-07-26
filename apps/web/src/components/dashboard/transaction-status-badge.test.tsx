import { describe, expect, it, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { TransactionStatus } from '@cognistream/shared';
import { TransactionStatusBadge } from '@/components/dashboard/transaction-status-badge';

const cases: Array<{ status: TransactionStatus; classFragment: string }> = [
  { status: 'pending', classFragment: 'bg-muted' },
  { status: 'escrowed', classFragment: 'bg-amber-500/15' },
  { status: 'settled', classFragment: 'bg-emerald-500/15' },
  { status: 'disputed', classFragment: 'bg-red-500/15' },
  { status: 'refunded', classFragment: 'bg-secondary' },
  { status: 'failed', classFragment: 'bg-red-500/15' },
];

describe('TransactionStatusBadge', () => {
  afterEach(() => {
    cleanup();
  });

  for (const { status, classFragment } of cases) {
    it(`renders ${status} badge`, () => {
      const { container } = render(<TransactionStatusBadge status={status} />);
      expect(screen.getByText(status)).toBeInTheDocument();
      expect(container.firstChild).toHaveClass(classFragment);
    });
  }
});
