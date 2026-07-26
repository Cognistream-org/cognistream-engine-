import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ApiKeyMetadata, CreatedApiKey } from '@cognistream/shared';

const swrMockFn = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const createApiKey = vi.fn();
const revokeApiKey = vi.fn();
const mutate = vi.fn();

vi.mock('swr', () => ({
  default: (...args: unknown[]) => swrMockFn(...args),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock('@/lib/api', () => ({
  proxyUrl: (path: string) => `/api/${path}`,
  fetchApiKeys: vi.fn(),
  createApiKey: (...args: unknown[]) => createApiKey(...args),
  revokeApiKey: (...args: unknown[]) => revokeApiKey(...args),
}));

vi.mock('@/lib/format', () => ({
  formatDate: (iso: string) => `date:${iso}`,
}));

import { ApiKeysPanel } from '@/components/dashboard/api-keys-panel';

function makeKey(overrides: Partial<ApiKeyMetadata> = {}): ApiKeyMetadata {
  return {
    id: '01900000-0000-7000-8000-0000000000aa',
    name: 'Production dashboard',
    scopes: ['read:agents', 'write:transactions'],
    lastUsedAt: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    expiresAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe('ApiKeysPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('renders API keys list', () => {
    swrMockFn.mockReturnValue({
      data: {
        data: [
          makeKey(),
          makeKey({
            id: '01900000-0000-7000-8000-0000000000bb',
            name: 'CI runner',
            scopes: ['admin:keys'],
          }),
        ],
        meta: { page: 1, limit: 20, total: 2, totalPages: 1 },
      },
      isLoading: false,
      mutate,
    });
    render(<ApiKeysPanel />);

    expect(screen.getByText('Production dashboard')).toBeInTheDocument();
    expect(screen.getByText('CI runner')).toBeInTheDocument();
    expect(screen.getByText('read:agents')).toBeInTheDocument();
    expect(screen.getByText('admin:keys')).toBeInTheDocument();
  });

  it('opens create dialog when clicking Create key', async () => {
    const user = userEvent.setup();
    swrMockFn.mockReturnValue({
      data: { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } },
      isLoading: false,
      mutate,
    });
    render(<ApiKeysPanel />);

    await user.click(screen.getByRole('button', { name: /create key/i }));
    expect(screen.getByRole('heading', { name: /create api key/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
  });

  it('shows error when creating without name', async () => {
    const user = userEvent.setup();
    swrMockFn.mockReturnValue({
      data: { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } },
      isLoading: false,
      mutate,
    });
    render(<ApiKeysPanel />);

    await user.click(screen.getByRole('button', { name: /create key/i }));
    await user.click(screen.getByRole('button', { name: /^create$/i }));
    expect(toastError).toHaveBeenCalledWith('Name is required');
    expect(createApiKey).not.toHaveBeenCalled();
  });

  it('calls createApiKey and shows plaintext key', async () => {
    const user = userEvent.setup();
    const created: CreatedApiKey = {
      ...makeKey({ name: 'New key' }),
      key: 'cs_live_plaintext_secret_shown_once',
    };
    createApiKey.mockResolvedValue(created);
    swrMockFn.mockReturnValue({
      data: { data: [], meta: { page: 1, limit: 20, total: 0, totalPages: 0 } },
      isLoading: false,
      mutate,
    });
    render(<ApiKeysPanel />);

    await user.click(screen.getByRole('button', { name: /create key/i }));
    await user.type(screen.getByLabelText(/name/i), 'New key');
    await user.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => {
      expect(createApiKey).toHaveBeenCalledWith({ name: 'New key' });
    });
    expect(await screen.findByText('cs_live_plaintext_secret_shown_once')).toBeInTheDocument();
    expect(toastSuccess).toHaveBeenCalledWith('API key created');
  });

  it('calls revokeApiKey on confirm', async () => {
    const user = userEvent.setup();
    const key = makeKey();
    revokeApiKey.mockResolvedValue(undefined);
    vi.stubGlobal('confirm', vi.fn(() => true));
    swrMockFn.mockReturnValue({
      data: { data: [key], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } },
      isLoading: false,
      mutate,
    });
    render(<ApiKeysPanel />);

    await user.click(screen.getByRole('button', { name: /revoke/i }));
    await waitFor(() => {
      expect(revokeApiKey).toHaveBeenCalledWith(key.id);
    });
  });

  it('does not revoke on cancel', async () => {
    const user = userEvent.setup();
    const key = makeKey();
    vi.stubGlobal('confirm', vi.fn(() => false));
    swrMockFn.mockReturnValue({
      data: { data: [key], meta: { page: 1, limit: 20, total: 1, totalPages: 1 } },
      isLoading: false,
      mutate,
    });
    render(<ApiKeysPanel />);

    await user.click(screen.getByRole('button', { name: /revoke/i }));
    expect(revokeApiKey).not.toHaveBeenCalled();
  });

  it('shows loading skeleton', () => {
    swrMockFn.mockReturnValue({ data: undefined, isLoading: true, mutate });
    const { container } = render(<ApiKeysPanel />);
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThanOrEqual(1);
  });
});
