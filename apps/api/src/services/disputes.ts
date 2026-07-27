import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import type {
  CreateDisputeInput,
  ListDisputesQuery,
  ResolveDisputeInput,
} from '@cognistream/shared';
import { prisma } from '../lib/prisma.js';
import { createId } from '../lib/uuid.js';
import { AppError } from '../lib/errors.js';
import { withSpan, observeDisputeResolution } from '../telemetry/index.js';
import { dispatchEvent } from './webhooks.js';
import { updateReputation } from './reputation.js';
import { transactionDetailSelect } from './transactions.js';
import type { Redis } from 'ioredis';
import { publishRealtime } from '../lib/realtime.js';

const disputeSelect = {
  id: true,
  transactionId: true,
  raisedById: true,
  reason: true,
  status: true,
  resolution: true,
  resolvedAt: true,
  createdAt: true,
  raisedBy: {
    select: {
      id: true,
      orgId: true,
      name: true,
      status: true,
    },
  },
  transaction: {
    select: transactionDetailSelect,
  },
} satisfies PrismaTypes.DisputeSelect;

export type DisputeDetail = PrismaTypes.DisputeGetPayload<{ select: typeof disputeSelect }>;

async function lockAgent(
  tx: PrismaTypes.TransactionClient,
  agentId: string,
): Promise<{ id: string; org_id: string; balance_cents: bigint } | null> {
  const rows = await tx.$queryRaw<Array<{ id: string; org_id: string; balance_cents: bigint }>>`
    SELECT id, org_id, balance_cents
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

export async function createDispute(
  orgId: string,
  raisedByAgentId: string,
  transactionId: string,
  input: CreateDisputeInput,
  requestId = 'unknown',
  redis?: Redis,
): Promise<DisputeDetail> {
  const dispute = await prisma.$transaction(
    async (tx) => {
      const transaction = await tx.transaction.findFirst({
        where: {
          id: transactionId,
          OR: [{ buyer: { orgId } }, { seller: { orgId } }],
        },
        select: {
          id: true,
          status: true,
          buyerId: true,
          sellerId: true,
          buyer: { select: { orgId: true } },
          seller: { select: { orgId: true } },
          dispute: { select: { id: true, status: true } },
        },
      });

      if (!transaction) {
        throw new AppError('TRANSACTION_NOT_FOUND', 'Transaction not found', 404, requestId);
      }

      if (transaction.dispute) {
        throw new AppError(
          'DISPUTE_ALREADY_OPEN',
          'A dispute already exists for this transaction',
          409,
          requestId,
        );
      }

      if (transaction.status !== 'escrowed' && transaction.status !== 'settled') {
        throw new AppError(
          'DISPUTE_NOT_ALLOWED',
          'Disputes can only be raised on escrowed or settled transactions',
          409,
          requestId,
        );
      }

      if (
        raisedByAgentId !== transaction.buyerId &&
        raisedByAgentId !== transaction.sellerId
      ) {
        throw new AppError(
          'FORBIDDEN',
          'Only buyer or seller may raise a dispute',
          403,
          requestId,
        );
      }

      const raiser = await tx.agent.findFirst({
        where: { id: raisedByAgentId, orgId },
        select: { id: true },
      });
      if (!raiser) {
        throw new AppError('AGENT_NOT_FOUND', 'Raising agent not found', 404, requestId);
      }

      const id = createId();
      await tx.dispute.create({
        data: {
          id,
          transactionId,
          raisedById: raisedByAgentId,
          reason: input.reason,
          status: 'open',
        },
      });

      await tx.transaction.update({
        where: { id: transactionId },
        data: { status: 'disputed' },
      });

      return tx.dispute.findUniqueOrThrow({
        where: { id },
        select: disputeSelect,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  void dispatchEvent(orgId, 'dispute.created', {
    disputeId: dispute.id,
    transactionId: dispute.transactionId,
    reason: dispute.reason,
  }).catch(() => undefined);

  if (redis) {
    void publishRealtime(redis, orgId, 'dispute.created', {
      disputeId: dispute.id,
      transactionId: dispute.transactionId,
    }).catch(() => undefined);
  }

  return dispute;
}

export async function resolveDispute(
  disputeId: string,
  input: ResolveDisputeInput,
  requestId = 'unknown',
  redis?: Redis,
): Promise<{ dispute: DisputeDetail; transaction: DisputeDetail['transaction'] }> {
  return withSpan(
    'dispute.resolve',
    async (span) => {
      const started = process.hrtime.bigint();
      span.setAttribute('dispute.id', disputeId);
      span.setAttribute('dispute.resolution', input.resolution);

      const result = await prisma.$transaction(
        async (tx) => {
          const existing = await tx.dispute.findUnique({
            where: { id: disputeId },
            select: {
              id: true,
              status: true,
              transactionId: true,
              transaction: {
                select: {
                  id: true,
                  status: true,
                  amountCents: true,
                  feeCents: true,
                  buyerId: true,
                  sellerId: true,
                  settledAt: true,
                  buyer: { select: { orgId: true } },
                  seller: { select: { orgId: true } },
                  escrow: {
                    select: {
                      id: true,
                      released: true,
                      amountCents: true,
                    },
                  },
                },
              },
            },
          });

          if (!existing) {
            throw new AppError('DISPUTE_NOT_FOUND', 'Dispute not found', 404, requestId);
          }

          if (existing.status !== 'open' && existing.status !== 'under_review') {
            throw new AppError(
              'DISPUTE_ALREADY_RESOLVED',
              'Dispute is already resolved or closed',
              409,
              requestId,
            );
          }

          const now = new Date();
          const txRow = existing.transaction;
          const sellerCredit = txRow.amountCents - txRow.feeCents;
          const wasSettled = txRow.escrow?.released === true || Boolean(txRow.settledAt);

          await lockAgent(tx, txRow.buyerId);
          await lockAgent(tx, txRow.sellerId);
          await lockOrganization(tx, txRow.buyer.orgId);

          if (input.resolution === 'buyer') {
            // Refund full amount to buyer; reverse settlement if needed.
            if (wasSettled) {
              await tx.agent.update({
                where: { id: txRow.sellerId },
                data: { balanceCents: { decrement: sellerCredit } },
              });
              await tx.organization.update({
                where: { id: txRow.buyer.orgId },
                data: { balanceCents: { decrement: txRow.feeCents } },
              });
            }

            await tx.agent.update({
              where: { id: txRow.buyerId },
              data: { balanceCents: { increment: txRow.amountCents } },
            });

            if (txRow.escrow && !txRow.escrow.released) {
              await tx.escrow.update({
                where: { id: txRow.escrow.id },
                data: { released: true, releasedAt: now },
              });
            }

            await tx.transaction.update({
              where: { id: txRow.id },
              data: { status: 'refunded', settledAt: null },
            });
          } else {
            // Seller wins: ensure funds released to seller if still in escrow.
            if (!wasSettled) {
              await tx.agent.update({
                where: { id: txRow.sellerId },
                data: { balanceCents: { increment: sellerCredit } },
              });
              await tx.organization.update({
                where: { id: txRow.buyer.orgId },
                data: { balanceCents: { increment: txRow.feeCents } },
              });
              if (txRow.escrow) {
                await tx.escrow.update({
                  where: { id: txRow.escrow.id },
                  data: { released: true, releasedAt: now },
                });
              }
            }

            await tx.transaction.update({
              where: { id: txRow.id },
              data: { status: 'settled', settledAt: wasSettled ? txRow.settledAt ?? now : now },
            });
          }

          const disputeStatus =
            input.resolution === 'buyer' ? 'resolved_buyer' : 'resolved_seller';

          await tx.dispute.update({
            where: { id: disputeId },
            data: {
              status: disputeStatus,
              resolution: input.notes ?? `Resolved in favor of ${input.resolution}`,
              resolvedAt: now,
            },
          });

          return {
            buyerId: txRow.buyerId,
            sellerId: txRow.sellerId,
            buyerOrgId: txRow.buyer.orgId,
            sellerOrgId: txRow.seller.orgId,
            resolution: input.resolution,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (result.resolution === 'buyer') {
        void updateReputation(result.sellerId, 'dispute_resolved', undefined, {
          favorable: false,
          metadata: { disputeId },
          requestId,
        }).catch(() => undefined);
      } else {
        void updateReputation(result.buyerId, 'dispute_resolved', undefined, {
          favorable: false,
          metadata: { disputeId },
          requestId,
        }).catch(() => undefined);
      }

      const dispute = await prisma.dispute.findUniqueOrThrow({
        where: { id: disputeId },
        select: disputeSelect,
      });

      for (const org of [result.buyerOrgId, result.sellerOrgId]) {
        void dispatchEvent(org, 'dispute.resolved', {
          disputeId: dispute.id,
          transactionId: dispute.transactionId,
          resolution: result.resolution,
          status: dispute.status,
        }).catch(() => undefined);

        if (redis) {
          void publishRealtime(redis, org, 'dispute.resolved', {
            disputeId: dispute.id,
            transactionId: dispute.transactionId,
            resolution: result.resolution,
          }).catch(() => undefined);
        }
      }

      observeDisputeResolution(Number(process.hrtime.bigint() - started) / 1e9);
      span.setAttribute('dispute.status', dispute.status);
      return { dispute, transaction: dispute.transaction };
    },
    { 'request.id': requestId },
  );
}

export async function getDispute(
  orgId: string,
  disputeId: string,
  requestId = 'unknown',
): Promise<DisputeDetail> {
  const dispute = await prisma.dispute.findFirst({
    where: {
      id: disputeId,
      OR: [
        { transaction: { buyer: { orgId } } },
        { transaction: { seller: { orgId } } },
      ],
    },
    select: disputeSelect,
  });
  if (!dispute) {
    throw new AppError('DISPUTE_NOT_FOUND', 'Dispute not found', 404, requestId);
  }
  return dispute;
}

export async function listDisputes(
  orgId: string,
  filters: ListDisputesQuery,
): Promise<{ items: DisputeDetail[]; total: number; page: number; limit: number }> {
  const where: PrismaTypes.DisputeWhereInput = {
    AND: [
      {
        OR: [
          { transaction: { buyer: { orgId } } },
          { transaction: { seller: { orgId } } },
        ],
      },
      ...(filters.status ? [{ status: filters.status }] : []),
    ],
  };

  const [total, items] = await prisma.$transaction([
    prisma.dispute.count({ where }),
    prisma.dispute.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (filters.page - 1) * filters.limit,
      take: filters.limit,
      select: disputeSelect,
    }),
  ]);

  return { items, total, page: filters.page, limit: filters.limit };
}
