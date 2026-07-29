import { Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';
import { AppError } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { createId } from '../lib/uuid.js';
import { recordAudit } from '../security/audit-runtime.js';
import {
  canReceivePayouts,
  createTransfer,
  type StripeConnectOptions,
} from './stripe-connect.js';
import { calculatePlatformFee, feeCentsHalfUp } from './platform-fee.js';

export const PLATFORM_FEE_RETRY_PREFIX = 'cognistream:platform-fee:retry:';
export const PLATFORM_FEE_RETRY_TTL_SECONDS = 24 * 60 * 60;

const ledgerSelect = {
  id: true,
  transactionId: true,
  orgId: true,
  grossAmountCents: true,
  platformFeeCents: true,
  netAmountCents: true,
  feeBasisPoints: true,
  stripeTransferId: true,
  transferredAt: true,
  createdAt: true,
} satisfies Prisma.PlatformFeeLedgerSelect;

export type PlatformFeeLedgerRow = Prisma.PlatformFeeLedgerGetPayload<{
  select: typeof ledgerSelect;
}>;

export type RecordFeeResult = {
  ledger: PlatformFeeLedgerRow;
  transferId: string | null;
  transferPendingRetry: boolean;
};

export type RecordFeeOptions = StripeConnectOptions & {
  currency?: string;
  description?: string;
};

export class PlatformFeeLedgerConflictError extends AppError {
  constructor(requestId = 'unknown') {
    super(
      'PLATFORM_FEE_CONFLICT',
      'Platform fee ledger entry already exists for this transaction',
      409,
      requestId,
    );
    this.name = 'PlatformFeeLedgerConflictError';
  }
}

/**
 * Append-only fee ledger write. Never mutates monetary columns after insert.
 * Optionally initiates a Connect transfer for the net amount.
 */
export async function recordFee(
  transactionId: string,
  orgId: string,
  grossAmountCents: bigint,
  feeBasisPoints?: number,
  options: RecordFeeOptions = {},
): Promise<RecordFeeResult> {
  const requestId = options.requestId ?? 'unknown';

  const existing = await prisma.platformFeeLedger.findUnique({
    where: { transactionId },
    select: { id: true },
  });
  if (existing) {
    throw new PlatformFeeLedgerConflictError(requestId);
  }

  const calc = await calculatePlatformFee(orgId, grossAmountCents, { requestId });
  const bps = feeBasisPoints ?? calc.feeBasisPoints;
  const platformFeeCents =
    feeBasisPoints === undefined
      ? calc.platformFeeCents
      : feeCentsHalfUp(grossAmountCents, bps);
  const netAmountCents = grossAmountCents - platformFeeCents;

  let ledger: PlatformFeeLedgerRow;
  try {
    ledger = await prisma.platformFeeLedger.create({
      data: {
        id: createId(),
        transactionId,
        orgId,
        grossAmountCents,
        platformFeeCents,
        netAmountCents,
        feeBasisPoints: bps,
        stripeTransferId: null,
        transferredAt: null,
      },
      select: ledgerSelect,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new PlatformFeeLedgerConflictError(requestId);
    }
    throw error;
  }

  void recordAudit({
    orgId,
    action: 'platform_fee.recorded',
    entityType: 'platform_fee_ledger',
    entityId: ledger.id,
    actorType: 'system',
    result: 'success',
    changes: {
      transactionId,
      grossAmountCents: grossAmountCents.toString(),
      platformFeeCents: platformFeeCents.toString(),
      netAmountCents: netAmountCents.toString(),
      feeBasisPoints: bps,
    },
  });

  let transferId: string | null = null;
  let transferPendingRetry = false;

  const eligible = await canReceivePayouts(orgId);
  if (eligible && netAmountCents > 0n) {
    const connect = await prisma.stripeConnectAccount.findUnique({
      where: { orgId },
      select: { stripeAccountId: true },
    });

    if (connect?.stripeAccountId) {
      try {
        transferId = await createTransfer(
          {
            stripeAccountId: connect.stripeAccountId,
            amountCents: netAmountCents,
            currency: options.currency ?? 'usd',
            transactionId,
            description:
              options.description ?? `Platform net payout for transaction ${transactionId}`,
          },
          {
            requestId,
            stripe: options.stripe,
            redis: options.redis,
          },
        );

        const refreshed = await prisma.platformFeeLedger.findUnique({
          where: { transactionId },
          select: ledgerSelect,
        });
        if (refreshed) {
          ledger = refreshed;
        }
      } catch (error) {
        transferPendingRetry = true;
        if (options.redis) {
          await markTransferRetry(options.redis, transactionId);
        }
        void recordAudit({
          orgId,
          action: 'platform_fee.transfer_failed',
          entityType: 'platform_fee_ledger',
          entityId: ledger.id,
          actorType: 'system',
          result: 'failure',
          metadata: {
            transactionId,
            retry: true,
            error: error instanceof Error ? error.message : 'transfer failed',
          },
        });
      }
    }
  }

  return { ledger, transferId, transferPendingRetry };
}

export async function markTransferRetry(
  redis: Redis,
  transactionId: string,
): Promise<void> {
  if (redis.status !== 'ready') {
    await redis.connect();
  }
  await redis.set(
    `${PLATFORM_FEE_RETRY_PREFIX}${transactionId}`,
    '1',
    'EX',
    PLATFORM_FEE_RETRY_TTL_SECONDS,
  );
}

export async function clearTransferRetry(
  redis: Redis,
  transactionId: string,
): Promise<void> {
  if (redis.status !== 'ready') {
    await redis.connect();
  }
  await redis.del(`${PLATFORM_FEE_RETRY_PREFIX}${transactionId}`);
}

/**
 * Webhook/transfer lifecycle: set transfer id + transferredAt only (monetary fields immutable).
 */
export async function markLedgerTransferred(
  transactionId: string,
  stripeTransferId: string,
  transferredAt = new Date(),
): Promise<PlatformFeeLedgerRow | null> {
  try {
    return await prisma.platformFeeLedger.update({
      where: { transactionId },
      data: { stripeTransferId, transferredAt },
      select: ledgerSelect,
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    ) {
      return null;
    }
    throw error;
  }
}

export async function markLedgerTransferredByTransferId(
  stripeTransferId: string,
  transferredAt = new Date(),
): Promise<PlatformFeeLedgerRow | null> {
  const existing = await prisma.platformFeeLedger.findFirst({
    where: { stripeTransferId },
    select: { transactionId: true },
  });
  if (!existing) {
    return null;
  }
  return markLedgerTransferred(existing.transactionId, stripeTransferId, transferredAt);
}
