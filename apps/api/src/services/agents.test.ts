import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    agent: {
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from '../lib/prisma.js';
import {
  AgentConflictError,
  AgentNotFoundError,
  createAgent,
  getAgentForOrg,
  getAgentWithReputation,
  listAgents,
  setAgentStatus,
} from './agents.js';

const baseAgent = {
  id: '01900000-0000-7000-8000-000000000001',
  orgId: '01900000-0000-7000-8000-0000000000aa',
  name: 'Agent',
  publicKey: 'pk_test',
  capabilities: ['chat'],
  pricingModel: null,
  unitPriceCents: null,
  reputationScore: new Prisma.Decimal('0.5000'),
  status: 'active' as const,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

describe('agents service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('createAgent returns created row', async () => {
    vi.mocked(prisma.agent.create).mockResolvedValue(baseAgent as never);
    const result = await createAgent(baseAgent.orgId, {
      name: 'Agent',
      publicKey: 'pk_test',
      capabilities: ['chat'],
    });
    expect(result.id).toBe(baseAgent.id);
    expect(prisma.agent.create).toHaveBeenCalledWith(
      expect.objectContaining({ select: expect.any(Object) }),
    );
  });

  it('createAgent maps P2002 to AgentConflictError', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: '6',
    });
    vi.mocked(prisma.agent.create).mockRejectedValue(err);
    await expect(
      createAgent(baseAgent.orgId, {
        name: 'Agent',
        publicKey: 'pk_test',
        capabilities: [],
      }),
    ).rejects.toBeInstanceOf(AgentConflictError);
  });

  it('listAgents returns paginated items', async () => {
    vi.mocked(prisma.$transaction).mockResolvedValue([1, [baseAgent]]);
    const result = await listAgents(baseAgent.orgId, {
      page: 1,
      limit: 20,
    });
    expect(result.total).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  it('getAgentForOrg throws when missing', async () => {
    vi.mocked(prisma.agent.findFirst).mockResolvedValue(null);
    await expect(getAgentForOrg(baseAgent.orgId, baseAgent.id)).rejects.toBeInstanceOf(
      AgentNotFoundError,
    );
  });

  it('getAgentWithReputation returns events', async () => {
    vi.mocked(prisma.agent.findFirst).mockResolvedValue({
      ...baseAgent,
      reputationEvents: [],
    } as never);
    const result = await getAgentWithReputation(baseAgent.orgId, baseAgent.id);
    expect(result.reputationEvents).toEqual([]);
  });

  it('setAgentStatus updates status', async () => {
    vi.mocked(prisma.agent.findFirst).mockResolvedValue({ id: baseAgent.id } as never);
    vi.mocked(prisma.agent.update).mockResolvedValue({
      ...baseAgent,
      status: 'inactive',
    } as never);
    const result = await setAgentStatus(baseAgent.orgId, baseAgent.id, 'inactive');
    expect(result.status).toBe('inactive');
  });
});
