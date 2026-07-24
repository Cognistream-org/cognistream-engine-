import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoginForm } from '@/components/auth/login-form';

type LoginState = { error: string } | undefined;

const mockFormAction = vi.fn();
const useActionStateMock = vi.fn((): [LoginState, typeof mockFormAction, boolean] => [
  undefined,
  mockFormAction,
  false,
]);

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useActionState: () => useActionStateMock(),
  };
});

describe('LoginForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useActionStateMock.mockReturnValue([undefined, mockFormAction, false]);
  });

  it('shows error when state contains validation message', () => {
    useActionStateMock.mockReturnValue([{ error: 'API key is required' }, mockFormAction, false]);

    render(<LoginForm />);

    expect(screen.getByRole('alert')).toHaveTextContent('API key is required');
  });

  it('marks api key field as required', () => {
    render(<LoginForm />);

    expect(screen.getByLabelText(/api key/i)).toBeRequired();
  });
});

describe('loginAction validation', () => {
  it('returns error for empty api key', async () => {
    const { loginAction } = await import('@/app/actions/auth');
    const formData = new FormData();
    formData.set('apiKey', '   ');

    const result = await loginAction(undefined, formData);
    expect(result).toEqual({ error: 'API key is required' });
  });
});
