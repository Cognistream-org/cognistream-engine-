import type { AgentStatus, Prisma } from '@prisma/client';
import { Prisma as PrismaNS } from '@prisma/client';
import type { CreateAgentInput, ListAgentsQuery } from '@cognistream/shared';
import { prisma } from '../lib/prisma.js';
import { createId } from '../lib/uuid.js';
import { AppError } from '../lib/errors.js';
import { recordAudit } from '../security/audit-runtime.js';

export const agentSelect = {
  id: true,
  orgId: true,
  name: true,
  publicKey: true,
  capabilities: true,
  pricingModel: true,
  unitPriceCents: true,
  reputationScore: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AgentSelect;

export type AgentRow = Prisma.AgentGetPayload<{ select: typeof agentSelect }>;

export type AgentWithReputation = AgentRow & {
  reputationEvents: Array<{
    id: string;
    eventType: string;
    delta: Prisma.Decimal;
    createdAt: Date;
  }>;
};

export class AgentConflictError extends AppError {
  constructor(requestId = 'unknown') {
    super('AGENT_CONFLICT', 'Agent with this public key already exists', 409, requestId);
    this.name = 'AgentConflictError';
  }
}

export class AgentNotFoundError extends AppError {
  constructor(requestId = 'unknown') {
    super('AGENT_NOT_FOUND', 'Agent not found', 404, requestId);
    this.name = 'AgentNotFoundError';
  }
}

export async function createAgent(
  orgId: string,
  input: CreateAgentInput,
  requestId = 'unknown',
): Promise<AgentRow> {
  try {
    const agent = await prisma.agent.create({
      data: {
        id: createId(),
        orgId,
        name: input.name,
        publicKey: input.publicKey,
        capabilities: input.capabilities,
        pricingModel: input.pricingModel,
        unitPriceCents:
          input.unitPriceCents === undefined ? undefined : BigInt(input.unitPriceCents),
      },
      select: agentSelect,
    });
    void recordAudit({
      orgId,
      action: 'agent.created',
      entityType: 'agent',
      entityId: agent.id,
      actorType: 'api_key',
      result: 'success',
      changes: { name: input.name, status: 'active' },
    });
    return agent;
  } catch (error) {
    if (
      error instanceof PrismaNS.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AgentConflictError(requestId);
    }
    throw error;
  }
}

export async function listAgents(
  orgId: string,
  query: ListAgentsQuery,
): Promise<{ items: AgentRow[]; total: number; page: number; limit: number }> {
  const where: Prisma.AgentWhereInput = {
    orgId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.capability ? { capabilities: { has: query.capability } } : {}),
  };

  const [total, items] = await prisma.$transaction([
    prisma.agent.count({ where }),
    prisma.agent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: agentSelect,
    }),
  ]);

  return { items, total, page: query.page, limit: query.limit };
}

export async function getAgentForOrg(
  orgId: string,
  agentId: string,
  requestId = 'unknown',
): Promise<AgentRow> {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, orgId },
    select: agentSelect,
  });
  if (!agent) {
    throw new AgentNotFoundError(requestId);
  }
  return agent;
}

export async function getAgentWithReputation(
  orgId: string,
  agentId: string,
  requestId = 'unknown',
): Promise<AgentWithReputation> {
  const agent = await prisma.agent.findFirst({
    where: { id: agentId, orgId },
    select: {
      ...agentSelect,
      reputationEvents: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          eventType: true,
          delta: true,
          createdAt: true,
        },
      },
    },
  });
  if (!agent) {
    throw new AgentNotFoundError(requestId);
  }
  return agent;
}

export async function setAgentStatus(
  orgId: string,
  agentId: string,
  status: Extract<AgentStatus, 'active' | 'inactive'>,
  requestId = 'unknown',
): Promise<AgentRow> {
  const existing = await prisma.agent.findFirst({
    where: { id: agentId, orgId },
    select: { id: true },
  });
  if (!existing) {
    throw new AgentNotFoundError(requestId);
  }

  const updated = await prisma.agent.update({
    where: { id: agentId },
    data: { status },
    select: agentSelect,
  });
  void recordAudit({
    orgId,
    action: 'agent.status_changed',
    entityType: 'agent',
    entityId: agentId,
    actorType: 'api_key',
    result: 'success',
    changes: { status },
  });
  return updated;
}
