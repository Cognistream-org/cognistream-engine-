import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import type { CreateTransactionInput, ListTransactionsQuery } from '@cognistream/shared';
import type { Redis } from 'ioredis';
import { prisma } from '../lib/prisma.js';
import { createId } from '../lib/uuid.js';
import { AppError } from '../lib/errors.js';
import {
  withSpan,
  recordTransaction,
  adjustEscrowActiveAmount,
} from '../telemetry/index.js';
import { updateReputation, type ReputationRating } from './reputation.js';
import { dispatchEvent } from './webhooks.js';
import { publishRealtime } from '../lib/realtime.js';

/** Platform fee rate: 0.5%. Use integer math only — never float. */
export const FEE_RATE_NUMERATOR = 5n;
export const FEE_RATE_DENOMINATOR = 1000n; // 5/1000 = 0.005

/** Escrow holds funds for 24 hours; expired escrows are refunded by Sprint 3 job. */
export const ESCROW_TTL_MS = 24 * 60 * 60 * 1000;
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const agentSummarySelect = {
  id: true,
  orgId: true,
  name: true,
  publicKey: true,
  reputationScore: true,
  status: true,
} satisfies PrismaTypes.AgentSelect;

const escrowSelect = {
  id: true,
  transactionId: true,
  amountCents: true,
  expiresAt: true,
  released: true,
  releasedAt: true,
} satisfies PrismaTypes.EscrowSelect;

export const transactionDetailSelect = {
  id: true,
  buyerId: true,
  sellerId: true,
  amountCents: true,
  feeCents: true,
  description: true,
  metadata: true,
  status: true,
  idempotencyKey: true,
  createdAt: true,
  settledAt: true,
  escrow: { select: escrowSelect },
  buyer: { select: agentSummarySelect },
  seller: { select: agentSummarySelect },
} satisfies PrismaTypes.TransactionSelect;

export type TransactionDetail = PrismaTypes.TransactionGetPayload<{
  select: typeof transactionDetailSelect;
}>;

export type CreateTransactionResult = {
  transaction: TransactionDetail;
  isDuplicate: boolean;
};

/**
 * Fee = floor(amountCents * 0.005) via integer division.
 * Equivalent to Math.floor(amount * FEE_RATE) without IEEE-754 risk.
 */
export function calculateFeeCents(amountCents: bigint): bigint {
  if (amountCents <= 0n) {
    throw new Error('amountCents must be positive');
  }
  return (amountCents * FEE_RATE_NUMERATOR) / FEE_RATE_DENOMINATOR;
}

function stableMetadata(value: unknown): string {
  if (value === null || value === undefined) {
    return '{}';
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const sorted: Record<string, unknown> = {};
  for (const key of keys) {
    sorted[key] = record[key];
  }
  return JSON.stringify(sorted);
}

function payloadsMatch(
  existing: { sellerId: string; amountCents: bigint; description: string | null; metadata: unknown },
  incoming: {
    sellerId: string;
    amountCents: bigint;
    description?: string;
    metadata?: Record<string, unknown>;
  },
): boolean {
  if (existing.sellerId !== incoming.sellerId) return false;
  if (existing.amountCents !== incoming.amountCents) return false;
  if ((existing.description ?? undefined) !== incoming.description) return false;
  return stableMetadata(existing.metadata) === stableMetadata(incoming.metadata ?? {});
}

type LockedAgent = {
  id: string;
  org_id: string;
  balance_cents: bigint;
  status: string;
};

/**
 * SELECT … FOR UPDATE under Serializable isolation — prevents double-spend races.
 */
async function lockAgent(
  tx: PrismaTypes.TransactionClient,
  agentId: string,
): Promise<LockedAgent | null> {
  const rows = await tx.$queryRaw<LockedAgent[]>`
    SELECT id, org_id, balance_cents, status::text AS status
    FROM agents
    WHERE id = ${agentId}::uuid
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function lockOrganization(
  tx: PrismaTypes.TransactionClient,
  orgId: string,
): Promise<{ id: string; balance_cents: bigint } | null> {
  const rows = await tx.$queryRaw<Array<{ id: string; balance_cents: bigint }>>`
    SELECT id, balance_cents
    FROM organizations
    WHERE id = ${orgId}::uuid
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

function isSerializationFailure(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (error.code === 'P2034') {
    return true;
  }
  return error.message.includes('40001') || error.message.includes('could not serialize');
}

export async function createTransaction(
  buyerId: string,
  input: CreateTransactionInput,
  requestId = 'unknown',
  redis?: Redis,
): Promise<CreateTransactionResult> {
  return withSpan(
    'escrow.create',
    async (span) => {
      const amountCents = BigInt(input.amountCents);
      span.setAttribute('transaction.amount_cents', amountCents.toString());
      span.setAttribute('transaction.buyer_id', buyerId);
      span.setAttribute('transaction.seller_id', input.sellerId);

      if (amountCents <= 0n) {
        throw new AppError('VALIDATION_ERROR', 'amountCents must be greater than 0', 422, requestId);
      }

      if (buyerId === input.sellerId) {
        throw new AppError(
          'SELF_TRANSACTION_NOT_ALLOWED',
          'Buyer and seller must be different agents',
          422,
          requestId,
        );
      }

      const feeCents = calculateFeeCents(amountCents);
      const maxAttempts = 3;
      let lastError: unknown;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const result = await attemptCreateTransaction(
            buyerId,
            input,
            amountCents,
            feeCents,
            requestId,
          );

          if (!result.isDuplicate) {
            recordTransaction(result.transaction.status, 'escrow_create');
            adjustEscrowActiveAmount(Number(result.transaction.amountCents));
            span.setAttribute('transaction.id', result.transaction.id);
            span.setAttribute('transaction.status', result.transaction.status);

            const payload = {
              transactionId: result.transaction.id,
              buyerId: result.transaction.buyerId,
              sellerId: result.transaction.sellerId,
              amountCents: result.transaction.amountCents.toString(),
              feeCents: result.transaction.feeCents.toString(),
              status: result.transaction.status,
            };
            void dispatchEvent(result.buyerOrgId, 'transaction.created', payload).catch(() => undefined);
            if (redis) {
              void publishRealtime(redis, result.buyerOrgId, 'transaction.created', payload).catch(
                () => undefined,
              );
              void publishRealtime(
                redis,
                result.transaction.seller.orgId,
                'transaction.created',
                payload,
              ).catch(() => undefined);
            }
          }

          return { transaction: result.transaction, isDuplicate: result.isDuplicate };
        } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        if (input.idempotencyKey) {
          const existing = await prisma.transaction.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            select: transactionDetailSelect,
          });
          if (
            existing &&
            payloadsMatch(existing, {
              sellerId: input.sellerId,
              amountCents,
              description: input.description,
              metadata: input.metadata,
            })
          ) {
            return { transaction: existing, isDuplicate: true };
          }
          throw new AppError(
            'INVALID_IDEMPOTENCY_KEY',
            'Idempotency key already used with a different payload',
            409,
            requestId,
          );
        }
      }
      if (isSerializationFailure(error) && attempt < maxAttempts) {
        lastError = error;
        continue;
      }
      if (isSerializationFailure(error)) {
        throw new AppError(
          'CONFLICT',
          'Transaction conflict; please retry',
          409,
          requestId,
        );
      }
      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new AppError('CONFLICT', 'Transaction conflict; please retry', 409, requestId);
    },
    {
      'request.id': requestId,
    },
  );
}

async function attemptCreateTransaction(
  buyerId: string,
  input: CreateTransactionInput,
  amountCents: bigint,
  feeCents: bigint,
  requestId: string,
): Promise<CreateTransactionResult & { buyerOrgId: string }> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ESCROW_TTL_MS);

  return prisma.$transaction(
    async (tx) => {
      if (input.idempotencyKey) {
        const existing = await tx.transaction.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
          select: transactionDetailSelect,
        });

        if (existing) {
          const ageMs = now.getTime() - existing.createdAt.getTime();
          if (ageMs < IDEMPOTENCY_TTL_MS) {
            if (
              !payloadsMatch(existing, {
                sellerId: input.sellerId,
                amountCents,
                description: input.description,
                metadata: input.metadata,
              })
            ) {
              throw new AppError(
                'INVALID_IDEMPOTENCY_KEY',
                'Idempotency key already used with a different payload',
                409,
                requestId,
              );
            }
            return { transaction: existing, isDuplicate: true, buyerOrgId: existing.buyer.orgId };
          }
        }
      }

      const buyer = await lockAgent(tx, buyerId);
      if (!buyer) {
        throw new AppError('AGENT_NOT_FOUND', 'Buyer agent not found', 404, requestId);
      }
      if (buyer.status !== 'active') {
        throw new AppError('AGENT_NOT_FOUND', 'Buyer agent is not active', 404, requestId);
      }

      const seller = await lockAgent(tx, input.sellerId);
      if (!seller) {
        throw new AppError('AGENT_NOT_FOUND', 'Seller agent not found', 404, requestId);
      }
      if (seller.status !== 'active') {
        throw new AppError('AGENT_NOT_FOUND', 'Seller agent is not active', 404, requestId);
      }

      if (buyer.balance_cents < amountCents) {
        throw new AppError(
          'INSUFFICIENT_BALANCE',
          'Buyer has insufficient balance for this transaction',
          402,
          requestId,
        );
      }

      await tx.agent.update({
        where: { id: buyerId },
        data: { balanceCents: { decrement: amountCents } },
      });

      const transactionId = createId();
      const escrowId = createId();

      await tx.transaction.create({
        data: {
          id: transactionId,
          buyerId,
          sellerId: input.sellerId,
          amountCents,
          feeCents,
          description: input.description,
          metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
          status: 'escrowed',
          idempotencyKey: input.idempotencyKey,
          escrow: {
            create: {
              id: escrowId,
              amountCents,
              expiresAt,
              released: false,
            },
          },
        },
      });

      const transaction = await tx.transaction.findUniqueOrThrow({
        where: { id: transactionId },
        select: transactionDetailSelect,
      });

      return { transaction, isDuplicate: false, buyerOrgId: buyer.org_id };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5_000,
      timeout: 15_000,
    },
  );
}

export async function releaseEscrow(
  transactionId: string,
  buyerOrgId: string,
  options?: { rating?: number; review?: string; requestId?: string; redis?: Redis },
): Promise<TransactionDetail> {
  const requestId = options?.requestId ?? 'unknown';
  const rating = options?.rating;

  return withSpan(
    'transaction.settle',
    async (span) => {
      span.setAttribute('transaction.id', transactionId);
      span.setAttribute('organization.id', buyerOrgId);

      if (rating !== undefined && (!Number.isInteger(rating) || rating < 1 || rating > 5)) {
        throw new AppError('INVALID_RATING', 'Rating must be an integer from 1 to 5', 422, requestId);
      }

      const result = await prisma.$transaction(
        async (tx) => {
          const existing = await tx.transaction.findUnique({
            where: { id: transactionId },
            select: {
              ...transactionDetailSelect,
              buyer: { select: { ...agentSummarySelect, balanceCents: true } },
            },
          });

          if (!existing || existing.buyer.orgId !== buyerOrgId) {
            throw new AppError('TRANSACTION_NOT_FOUND', 'Transaction not found', 404, requestId);
          }

          if (existing.status === 'settled') {
            throw new AppError(
              'TRANSACTION_ALREADY_SETTLED',
              'Transaction has already been settled',
              409,
              requestId,
            );
          }

          if (existing.status !== 'escrowed' || !existing.escrow) {
            throw new AppError(
              'TRANSACTION_NOT_FOUND',
              'Transaction is not in escrowed state',
              404,
              requestId,
            );
          }

          if (existing.escrow.released) {
            throw new AppError(
              'ESCROW_ALREADY_RELEASED',
              'Escrow has already been released',
              409,
              requestId,
            );
          }

          const now = new Date();
          if (existing.escrow.expiresAt.getTime() <= now.getTime()) {
            throw new AppError('ESCROW_EXPIRED', 'Escrow has expired', 409, requestId);
          }

          // Lock seller + buyer's org for settlement credits
          const seller = await lockAgent(tx, existing.sellerId);
          if (!seller) {
            throw new AppError('AGENT_NOT_FOUND', 'Seller agent not found', 404, requestId);
          }

          const org = await lockOrganization(tx, existing.buyer.orgId);
          if (!org) {
            throw new AppError('NOT_FOUND', 'Buyer organization not found', 404, requestId);
          }

          const sellerCredit = existing.amountCents - existing.feeCents;

          await tx.agent.update({
            where: { id: existing.sellerId },
            data: { balanceCents: { increment: sellerCredit } },
          });

          await tx.organization.update({
            where: { id: existing.buyer.orgId },
            data: { balanceCents: { increment: existing.feeCents } },
          });

          await tx.escrow.update({
            where: { id: existing.escrow.id },
            data: { released: true, releasedAt: now },
          });

          await tx.transaction.update({
            where: { id: transactionId },
            data: {
              status: 'settled',
              settledAt: now,
              ...(options?.review
                ? {
                    metadata: {
                      ...((existing.metadata as Record<string, unknown> | null) ?? {}),
                      review: options.review,
                    } as Prisma.InputJsonValue,
                  }
                : {}),
            },
          });

          return tx.transaction.findUniqueOrThrow({
            where: { id: transactionId },
            select: transactionDetailSelect,
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 5_000,
          timeout: 15_000,
        },
      );

      recordTransaction(result.status, 'settlement');
      adjustEscrowActiveAmount(-Number(result.amountCents));
      span.setAttribute('transaction.status', result.status);

      if (rating !== undefined) {
        void updateReputation(result.sellerId, 'positive_trade', rating as ReputationRating, {
          metadata: { transactionId: result.id, review: options?.review },
          requestId,
        }).catch(() => undefined);
      }

      void dispatchEvent(result.buyer.orgId, 'transaction.settled', {
        transactionId: result.id,
        buyerId: result.buyerId,
        sellerId: result.sellerId,
        amountCents: result.amountCents.toString(),
        feeCents: result.feeCents.toString(),
        status: result.status,
      }).catch(() => undefined);

      void dispatchEvent(result.buyer.orgId, 'escrow.released', {
        transactionId: result.id,
        escrowId: result.escrow?.id,
        amountCents: result.amountCents.toString(),
      }).catch(() => undefined);

      if (options?.redis) {
        const settledPayload = {
          transactionId: result.id,
          buyerId: result.buyerId,
          sellerId: result.sellerId,
          amountCents: result.amountCents.toString(),
          feeCents: result.feeCents.toString(),
          status: result.status,
        };
        void publishRealtime(options.redis, result.buyer.orgId, 'transaction.settled', settledPayload).catch(
          () => undefined,
        );
        void publishRealtime(options.redis, result.seller.orgId, 'transaction.settled', settledPayload).catch(
          () => undefined,
        );
      }

      return result;
    },
    { 'request.id': requestId },
  );
}

export async function getTransaction(
  transactionId: string,
  orgId: string,
  requestId = 'unknown',
): Promise<TransactionDetail> {
  const transaction = await prisma.transaction.findFirst({
    where: {
      id: transactionId,
      OR: [{ buyer: { orgId } }, { seller: { orgId } }],
    },
    select: transactionDetailSelect,
  });

  if (!transaction) {
    throw new AppError('TRANSACTION_NOT_FOUND', 'Transaction not found', 404, requestId);
  }

  return transaction;
}

export async function listTransactions(
  orgId: string,
  filters: ListTransactionsQuery,
): Promise<{ items: TransactionDetail[]; total: number; page: number; limit: number }> {
  const where: PrismaTypes.TransactionWhereInput = {
    AND: [
      { OR: [{ buyer: { orgId } }, { seller: { orgId } }] },
      ...(filters.buyerId ? [{ buyerId: filters.buyerId }] : []),
      ...(filters.sellerId ? [{ sellerId: filters.sellerId }] : []),
      ...(filters.status ? [{ status: filters.status }] : []),
    ],
  };

  const [total, items] = await prisma.$transaction([
    prisma.transaction.count({ where }),
    prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
      select: transactionDetailSelect,
    }),
  ]);

  return { items, total, page: filters.page, limit: filters.limit };
}
