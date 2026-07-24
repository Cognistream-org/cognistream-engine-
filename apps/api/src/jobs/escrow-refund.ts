import { Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';
import pino from 'pino';
import { prisma } from '../lib/prisma.js';
import { createId } from '../lib/uuid.js';
import { dispatchEvent } from '../services/webhooks.js';
import { publishRealtime } from '../lib/realtime.js';

const jobLogger = pino({
  name: 'escrow-refund',
  level: process.env.NODE_ENV === 'test' ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
});

export type EscrowRefundResult = {
  processed: number;
  skipped: number;
  refundedIds: string[];
};

/**
 * Idempotent escrow auto-refund: expired + unreleased + still escrowed.
 * Safe to run concurrently — each row is locked and re-checked inside the txn.
 */
export async function processExpiredEscrows(redis?: Redis): Promise<EscrowRefundResult> {
  const now = new Date();
  const candidates = await prisma.escrow.findMany({
    where: {
      released: false,
      expiresAt: { lt: now },
      transaction: { status: 'escrowed' },
    },
    select: {
      id: true,
      transactionId: true,
      amountCents: true,
      transaction: {
        select: {
          id: true,
          buyerId: true,
          sellerId: true,
          status: true,
          buyer: { select: { orgId: true } },
          seller: { select: { orgId: true } },
        },
      },
    },
    take: 100,
  });

  let processed = 0;
  let skipped = 0;
  const refundedIds: string[] = [];

  for (const escrow of candidates) {
    try {
      const refunded = await refundOneEscrow(escrow.id, now);
      if (!refunded) {
        skipped += 1;
        continue;
      }

      processed += 1;
      refundedIds.push(escrow.transactionId);

      const payload = {
        transactionId: escrow.transactionId,
        escrowId: escrow.id,
        amountCents: escrow.amountCents.toString(),
      };

      void dispatchEvent(escrow.transaction.buyer.orgId, 'escrow.expired', payload).catch(
        () => undefined,
      );
      void dispatchEvent(escrow.transaction.seller.orgId, 'escrow.expired', payload).catch(
        () => undefined,
      );

      if (redis) {
        void publishRealtime(
          redis,
          escrow.transaction.buyer.orgId,
          'escrow.expired',
          payload,
        ).catch(() => undefined);
        void publishRealtime(
          redis,
          escrow.transaction.seller.orgId,
          'escrow.expired',
          payload,
        ).catch(() => undefined);
      }
    } catch (error) {
      skipped += 1;
      jobLogger.error(
        { err: error, escrowId: escrow.id, transactionId: escrow.transactionId },
        'Escrow refund failed',
      );
    }
  }

  return { processed, skipped, refundedIds };
}

async function refundOneEscrow(escrowId: string, now: Date): Promise<boolean> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          transaction_id: string;
          amount_cents: bigint;
          released: boolean;
          buyer_id: string;
          buyer_org_id: string;
          tx_status: string;
        }>
      >`
        SELECT e.id, e.transaction_id, e.amount_cents, e.released,
               t.buyer_id, a.org_id AS buyer_org_id, t.status::text AS tx_status
        FROM escrow e
        JOIN transactions t ON t.id = e.transaction_id
        JOIN agents a ON a.id = t.buyer_id
        WHERE e.id = ${escrowId}::uuid
        FOR UPDATE OF e, t, a
      `;

      const row = rows[0];
      if (!row) return false;
      if (row.released) return false;
      if (row.tx_status !== 'escrowed') return false;

      await tx.agent.update({
        where: { id: row.buyer_id },
        data: { balanceCents: { increment: row.amount_cents } },
      });

      await tx.transaction.update({
        where: { id: row.transaction_id },
        data: { status: 'refunded' },
      });

      await tx.escrow.update({
        where: { id: row.id },
        data: { released: true, releasedAt: now },
      });

      await tx.auditLog.create({
        data: {
          id: createId(),
          orgId: row.buyer_org_id,
          action: 'escrow.auto_refund',
          entityType: 'escrow',
          entityId: row.id,
          metadata: {
            transactionId: row.transaction_id,
            amountCents: row.amount_cents.toString(),
            reason: 'expired',
          },
        },
      });

      return true;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
