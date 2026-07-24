import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { createId } from '../lib/uuid.js';
import { AppError } from '../lib/errors.js';
import { dispatchEvent } from './webhooks.js';

export type ReputationEventType = 'positive_trade' | 'negative_trade' | 'dispute_resolved';

export type ReputationRating = 1 | 2 | 3 | 4 | 5;

const SCORE_MIN = new Prisma.Decimal('0.0000');
const SCORE_MAX = new Prisma.Decimal('1.0000');

/**
 * Pure reputation delta calculator — no float accumulation in callers.
 * Deltas are fixed decimal strings to avoid IEEE-754 drift.
 */
export function calculateReputationDelta(
  eventType: ReputationEventType,
  rating?: ReputationRating,
  favorable?: boolean,
): Prisma.Decimal {
  switch (eventType) {
    case 'positive_trade': {
      const resolved = rating ?? 3;
      if (resolved === 5) return new Prisma.Decimal('0.0020');
      if (resolved === 4) return new Prisma.Decimal('0.0010');
      if (resolved === 3) return new Prisma.Decimal('0.0005');
      return new Prisma.Decimal('-0.0010');
    }
    case 'negative_trade':
      return new Prisma.Decimal('-0.0050');
    case 'dispute_resolved': {
      const inFavor = favorable ?? (rating === undefined ? true : rating >= 3);
      return inFavor ? new Prisma.Decimal('0.0010') : new Prisma.Decimal('-0.0100');
    }
    default: {
      const _exhaustive: never = eventType;
      return _exhaustive;
    }
  }
}

function clampScore(score: Prisma.Decimal): Prisma.Decimal {
  if (score.lt(SCORE_MIN)) return SCORE_MIN;
  if (score.gt(SCORE_MAX)) return SCORE_MAX;
  return score;
}

export async function updateReputation(
  agentId: string,
  eventType: ReputationEventType,
  rating?: ReputationRating,
  options?: { favorable?: boolean; metadata?: Record<string, unknown>; requestId?: string },
): Promise<{ agentId: string; previousScore: string; currentScore: string; delta: string }> {
  const requestId = options?.requestId ?? 'unknown';

  if (eventType === 'positive_trade') {
    if (rating === undefined || rating < 1 || rating > 5) {
      throw new AppError('INVALID_RATING', 'Rating must be an integer from 1 to 5', 422, requestId);
    }
  }

  const delta = calculateReputationDelta(eventType, rating, options?.favorable);

  const result = await prisma.$transaction(
    async (tx) => {
      const agent = await tx.agent.findUnique({
        where: { id: agentId },
        select: { id: true, orgId: true, reputationScore: true },
      });
      if (!agent) {
        throw new AppError('AGENT_NOT_FOUND', 'Agent not found', 404, requestId);
      }

      const previous = agent.reputationScore;
      const next = clampScore(previous.add(delta));

      await tx.reputationEvent.create({
        data: {
          id: createId(),
          agentId,
          eventType,
          delta,
          metadata: {
            ...(options?.metadata ?? {}),
            ...(rating !== undefined ? { rating } : {}),
            ...(options?.favorable !== undefined ? { favorable: options.favorable } : {}),
          } as Prisma.InputJsonValue,
        },
      });

      await tx.agent.update({
        where: { id: agentId },
        data: { reputationScore: next },
      });

      return {
        orgId: agent.orgId,
        previousScore: previous,
        currentScore: next,
        delta,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  void dispatchEvent(result.orgId, 'reputation.changed', {
    agentId,
    eventType,
    delta: result.delta.toFixed(4),
    previousScore: result.previousScore.toFixed(4),
    currentScore: result.currentScore.toFixed(4),
  }).catch(() => undefined);

  return {
    agentId,
    previousScore: result.previousScore.toFixed(4),
    currentScore: result.currentScore.toFixed(4),
    delta: result.delta.toFixed(4),
  };
}

export type ReputationSummary = {
  currentScore: string;
  totalTransactions: number;
  successfulTransactions: number;
  disputeRate: number;
  history: Array<{
    id: string;
    eventType: string;
    delta: string;
    metadata: unknown;
    createdAt: string;
  }>;
};

export async function getReputation(agentId: string, requestId = 'unknown'): Promise<ReputationSummary> {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    select: { id: true, reputationScore: true },
  });
  if (!agent) {
    throw new AppError('AGENT_NOT_FOUND', 'Agent not found', 404, requestId);
  }

  const [totalTransactions, successfulTransactions, disputedTransactions, history] =
    await Promise.all([
      prisma.transaction.count({
        where: {
          OR: [{ buyerId: agentId }, { sellerId: agentId }],
          status: { not: 'failed' },
        },
      }),
      prisma.transaction.count({
        where: {
          OR: [{ buyerId: agentId }, { sellerId: agentId }],
          status: 'settled',
        },
      }),
      prisma.transaction.count({
        where: {
          OR: [{ buyerId: agentId }, { sellerId: agentId }],
          status: 'disputed',
        },
      }),
      prisma.reputationEvent.findMany({
        where: { agentId },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          eventType: true,
          delta: true,
          metadata: true,
          createdAt: true,
        },
      }),
    ]);

  const disputeRate =
    totalTransactions === 0 ? 0 : Number((disputedTransactions / totalTransactions).toFixed(4));

  return {
    currentScore: agent.reputationScore.toFixed(4),
    totalTransactions,
    successfulTransactions,
    disputeRate,
    history: history.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      delta: event.delta.toFixed(4),
      metadata: event.metadata,
      createdAt: event.createdAt.toISOString(),
    })),
  };
}
