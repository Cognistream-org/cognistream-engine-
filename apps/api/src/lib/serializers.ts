import type { AgentResponse, ApiKeyMetadata, CreatedApiKey } from '@cognistream/shared';
import type { Prisma } from '@prisma/client';
import type { AgentRow } from '../services/agents.js';
import type { ApiKeyMetadataRow, ApiKeyRow } from '../services/api-keys.js';

export function toAgentResponse(agent: AgentRow): AgentResponse {
  return {
    id: agent.id,
    orgId: agent.orgId,
    name: agent.name,
    publicKey: agent.publicKey,
    capabilities: agent.capabilities,
    pricingModel: agent.pricingModel,
    unitPriceCents: agent.unitPriceCents === null ? null : agent.unitPriceCents.toString(),
    reputationScore: agent.reputationScore.toFixed(4),
    status: agent.status,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
  };
}

export function toApiKeyMetadata(key: ApiKeyMetadataRow | ApiKeyRow): ApiKeyMetadata {
  return {
    id: key.id,
    name: key.name,
    scopes: key.scopes,
    lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
    createdAt: key.createdAt.toISOString(),
    expiresAt: key.expiresAt?.toISOString() ?? null,
    revokedAt: key.revokedAt?.toISOString() ?? null,
  };
}

export function toCreatedApiKey(key: ApiKeyRow, plaintext: string): CreatedApiKey {
  return {
    ...toApiKeyMetadata(key),
    key: plaintext,
  };
}

export type AgentReputationSummary = {
  score: string;
  recentEvents: Array<{
    id: string;
    eventType: string;
    delta: string;
    createdAt: string;
  }>;
};

export function toReputationSummary(
  score: Prisma.Decimal,
  events: Array<{
    id: string;
    eventType: string;
    delta: Prisma.Decimal;
    createdAt: Date;
  }>,
): AgentReputationSummary {
  return {
    score: score.toFixed(4),
    recentEvents: events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      delta: event.delta.toFixed(4),
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
