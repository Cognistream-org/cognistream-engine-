import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AgentResponse } from '@cognistream/shared';

const swrMockFn = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const activateAgent = vi.fn();
const deactivateAgent = vi.fn();
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
  fetchAgents: vi.fn(),
  activateAgent: (...args: unknown[]) => activateAgent(...args),
  deactivateAgent: (...args: unknown[]) => deactivateAgent(...args),
}));

vi.mock('@/lib/format', () => ({
  formatDate: (iso: string) => `formatted:${iso}`,
}));

import { AgentsTable } from '@/components/dashboard/agents-table';

function makeAgent(overrides: Partial<AgentResponse> = {}): AgentResponse {
  return {
    id: '01900000-0000-7000-8000-000000000001',
    orgId: 'org-1',
    name: 'Alpha Bot',
    publicKey: 'pk_alpha',
    capabilities: ['chat', 'search'],
    pricingModel: 'per_request',
    unitPriceCents: '100',
    reputationScore: '0.8500',
    status: 'active',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('AgentsTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
  });

  it('renders loading skeletons when data is loading', () => {
    swrMockFn.mockReturnValue({ data: undefined, isLoading: true, mutate });
    const { container } = render(<AgentsTable />);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
  });

  it('renders empty state when no agents', () => {
    swrMockFn.mockReturnValue({
      data: { data: [], meta: { page: 1, limit: 50, total: 0, totalPages: 0 } },
      isLoading: false,
      mutate,
    });
    render(<AgentsTable />);
    expect(screen.getByText(/no agents yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders agents with correct data', () => {
    const agents = [
      makeAgent(),
      makeAgent({
        id: '01900000-0000-7000-8000-000000000002',
        name: 'Beta Bot',
        status: 'inactive',
        reputationScore: '0.5000',
        capabilities: ['codegen'],
      }),
    ];
    swrMockFn.mockReturnValue({
      data: { data: agents, meta: { page: 1, limit: 50, total: 2, totalPages: 1 } },
      isLoading: false,
      mutate,
    });
    render(<AgentsTable />);

    expect(screen.getByText('Alpha Bot')).toBeInTheDocument();
    expect(screen.getByText('Beta Bot')).toBeInTheDocument();
    expect(screen.getByText('active')).toBeInTheDocument();
    expect(screen.getByText('inactive')).toBeInTheDocument();
    expect(screen.getByText('0.8500')).toBeInTheDocument();
    expect(screen.getByText('0.5000')).toBeInTheDocument();
    expect(screen.getByText('chat')).toBeInTheDocument();
    expect(screen.getByText('search')).toBeInTheDocument();
    expect(screen.getByText('codegen')).toBeInTheDocument();
  });

  it('calls activateAgent when toggling inactive agent', async () => {
    const user = userEvent.setup();
    const agent = makeAgent({ status: 'inactive', name: 'Idle Bot' });
    activateAgent.mockResolvedValue({ ...agent, status: 'active' });
    swrMockFn.mockReturnValue({
      data: { data: [agent], meta: { page: 1, limit: 50, total: 1, totalPages: 1 } },
      isLoading: false,
      mutate,
    });
    render(<AgentsTable />);

    await user.click(screen.getByRole('button', { name: /activate/i }));
    await waitFor(() => {
      expect(activateAgent).toHaveBeenCalledWith(agent.id);
    });
  });

  it('calls deactivateAgent when toggling active agent', async () => {
    const user = userEvent.setup();
    const agent = makeAgent({ status: 'active' });
    deactivateAgent.mockResolvedValue({ ...agent, status: 'inactive' });
    swrMockFn.mockReturnValue({
      data: { data: [agent], meta: { page: 1, limit: 50, total: 1, totalPages: 1 } },
      isLoading: false,
      mutate,
    });
    render(<AgentsTable />);

    await user.click(screen.getByRole('button', { name: /deactivate/i }));
    await waitFor(() => {
      expect(deactivateAgent).toHaveBeenCalledWith(agent.id);
    });
  });

  it('shows success toast on successful toggle', async () => {
    const user = userEvent.setup();
    const agent = makeAgent({ status: 'active', name: 'Alpha Bot' });
    deactivateAgent.mockResolvedValue({ ...agent, status: 'inactive' });
    swrMockFn.mockReturnValue({
      data: { data: [agent], meta: { page: 1, limit: 50, total: 1, totalPages: 1 } },
      isLoading: false,
      mutate,
    });
    render(<AgentsTable />);

    await user.click(screen.getByRole('button', { name: /deactivate/i }));
    await waitFor(() => {
      expect(toastSuccess).toHaveBeenCalledWith('Alpha Bot deactivated');
    });
  });

  it('shows error toast on failed toggle', async () => {
    const user = userEvent.setup();
    const agent = makeAgent({ status: 'active' });
    deactivateAgent.mockRejectedValue(new Error('Action failed'));
    swrMockFn.mockReturnValue({
      data: { data: [agent], meta: { page: 1, limit: 50, total: 1, totalPages: 1 } },
      isLoading: false,
      mutate,
    });
    render(<AgentsTable />);

    await user.click(screen.getByRole('button', { name: /deactivate/i }));
    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Action failed');
    });
  });
});
