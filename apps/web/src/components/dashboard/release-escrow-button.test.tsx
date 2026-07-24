import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReleaseEscrowButton } from '@/components/dashboard/release-escrow-button';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

describe('ReleaseEscrowButton', () => {
  it('is disabled when status is not escrowed', () => {
    render(
      <ReleaseEscrowButton
        transactionId="01900000-0000-7000-8000-000000000001"
        status="settled"
      />,
    );

    expect(screen.getByRole('button', { name: /release escrow/i })).toBeDisabled();
    expect(screen.getByText(/only escrowed transactions/i)).toBeInTheDocument();
  });

  it('is enabled when status is escrowed', () => {
    render(
      <ReleaseEscrowButton
        transactionId="01900000-0000-7000-8000-000000000001"
        status="escrowed"
      />,
    );

    expect(screen.getByRole('button', { name: /release escrow/i })).toBeEnabled();
  });
});
