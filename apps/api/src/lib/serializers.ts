import type {
  AgentResponse,
  ApiKeyMetadata,
  CreatedApiKey,
  DisputeResponse,
  EscrowResponse,
  TransactionAgentSummary,
  TransactionResponse,
} from '@cognistream/shared';
import type { Prisma } from '@prisma/client';
import type { AgentRow } from '../services/agents.js';
import type { ApiKeyMetadataRow, ApiKeyRow } from '../services/api-keys.js';
import type { TransactionDetail } from '../services/transactions.js';
import type { DisputeDetail } from '../services/disputes.js';

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

function toAgentSummary(agent: {
  id: string;
  orgId: string;
  name: string;
  publicKey: string;
  reputationScore: Prisma.Decimal;
  status: string;
}): TransactionAgentSummary {
  return {
    id: agent.id,
    orgId: agent.orgId,
    name: agent.name,
    publicKey: agent.publicKey,
    reputationScore: agent.reputationScore.toFixed(4),
    status: agent.status,
  };
}

export function toEscrowResponse(escrow: {
  id: string;
  transactionId: string;
  amountCents: bigint;
  expiresAt: Date;
  released: boolean;
  releasedAt: Date | null;
}): EscrowResponse {
  return {
    id: escrow.id,
    transactionId: escrow.transactionId,
    amountCents: escrow.amountCents.toString(),
    expiresAt: escrow.expiresAt.toISOString(),
    released: escrow.released,
    releasedAt: escrow.releasedAt?.toISOString() ?? null,
  };
}

/** Serialize transaction for API — never includes agent or org balances. */
export function toTransactionResponse(tx: TransactionDetail): TransactionResponse {
  return {
    id: tx.id,
    buyerId: tx.buyerId,
    sellerId: tx.sellerId,
    amountCents: tx.amountCents.toString(),
    feeCents: tx.feeCents.toString(),
    description: tx.description,
    metadata: tx.metadata,
    status: tx.status,
    idempotencyKey: tx.idempotencyKey,
    createdAt: tx.createdAt.toISOString(),
    settledAt: tx.settledAt?.toISOString() ?? null,
    escrow: tx.escrow ? toEscrowResponse(tx.escrow) : null,
    buyer: toAgentSummary(tx.buyer),
    seller: toAgentSummary(tx.seller),
  };
}

export function toDisputeResponse(dispute: DisputeDetail): DisputeResponse {
  return {
    id: dispute.id,
    transactionId: dispute.transactionId,
    raisedById: dispute.raisedById,
    reason: dispute.reason,
    status: dispute.status,
    resolution: dispute.resolution,
    resolvedAt: dispute.resolvedAt?.toISOString() ?? null,
    createdAt: dispute.createdAt.toISOString(),
  };
}
