import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { Redis } from 'ioredis';

const createTransfer = vi.fn();
const canReceivePayouts = vi.fn();

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    platformFeeLedger: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    stripeConnectAccount: { findUnique: vi.fn() },
  },
}));

vi.mock('../security/audit-runtime.js', () => ({
  recordAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../lib/uuid.js', () => ({
  createId: vi.fn(() => '01900000-0000-7000-8000-0000000000fe'),
}));

vi.mock('./stripe-connect.js', () => ({
  createTransfer: (...args: unknown[]) => createTransfer(...args),
  canReceivePayouts: (...args: unknown[]) => canReceivePayouts(...args),
}));

import { prisma } from '../lib/prisma.js';
import { recordAudit } from '../security/audit-runtime.js';
import {
  PlatformFeeLedgerConflictError,
  clearTransferRetry,
  markLedgerTransferred,
  markLedgerTransferredByTransferId,
  markTransferRetry,
  recordFee,
} from './platform-fee-ledger.js';

function createMemoryRedis() {
  const store = new Map<string, string>();
  const redis = {
    status: 'ready' as const,
    connect: vi.fn(async () => undefined),
    set: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
      return 1;
    }),
  };
  return { redis: redis as unknown as Redis, store };
}

const orgId = '01900000-0000-7000-8000-0000000000aa';
const txId = '01900000-0000-7000-8000-0000000000tx';

const ledgerRow = {
  id: '01900000-0000-7000-8000-0000000000fe',
  transactionId: txId,
  orgId,
  grossAmountCents: 10_000n,
  platformFeeCents: 250n,
  netAmountCents: 9_750n,
  feeBasisPoints: 250,
  stripeTransferId: null,
  transferredAt: null,
  createdAt: new Date('2026-07-01T00:00:00.000Z'),
};

describe('platform-fee-ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({ tier: 'developer' } as never);
    vi.mocked(prisma.platformFeeLedger.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.platformFeeLedger.create).mockResolvedValue(ledgerRow as never);
    canReceivePayouts.mockResolvedValue(false);
  });

  it('creates an append-only ledger entry before any transfer', async () => {
    const result = await recordFee(txId, orgId, 10_000n);
    expect(prisma.platformFeeLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          transactionId: txId,
          orgId,
          grossAmountCents: 10_000n,
          stripeTransferId: null,
          transferredAt: null,
        }),
      }),
    );
    expect(createTransfer).not.toHaveBeenCalled();
    expect(result.transferId).toBeNull();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'platform_fee.recorded', result: 'success' }),
    );
  });

  it('rejects duplicate transaction ledger rows', async () => {
    vi.mocked(prisma.platformFeeLedger.findUnique).mockResolvedValue({ id: 'x' } as never);
    await expect(recordFee(txId, orgId, 100n)).rejects.toBeInstanceOf(
      PlatformFeeLedgerConflictError,
    );

    vi.mocked(prisma.platformFeeLedger.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.platformFeeLedger.create).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' }),
    );
    await expect(recordFee(txId, orgId, 100n)).rejects.toBeInstanceOf(
      PlatformFeeLedgerConflictError,
    );
  });

  it('transfers net amount when Connect payouts are enabled', async () => {
    canReceivePayouts.mockResolvedValue(true);
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue({
      stripeAccountId: 'acct_1',
    } as never);
    createTransfer.mockResolvedValue('tr_123');
    vi.mocked(prisma.platformFeeLedger.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        ...ledgerRow,
        stripeTransferId: 'tr_123',
        transferredAt: new Date(),
      } as never);

    const { redis } = createMemoryRedis();
    const result = await recordFee(txId, orgId, 10_000n, undefined, { redis });
    expect(createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeAccountId: 'acct_1',
        amountCents: 9_750n,
        transactionId: txId,
      }),
      expect.objectContaining({ redis }),
    );
    expect(result.transferId).toBe('tr_123');
    expect(result.transferPendingRetry).toBe(false);
  });

  it('marks retry when transfer fails and leaves stripeTransferId null', async () => {
    canReceivePayouts.mockResolvedValue(true);
    vi.mocked(prisma.stripeConnectAccount.findUnique).mockResolvedValue({
      stripeAccountId: 'acct_1',
    } as never);
    createTransfer.mockRejectedValue(new Error('stripe down'));
    const { redis, store } = createMemoryRedis();

    const result = await recordFee(txId, orgId, 10_000n, undefined, { redis });
    expect(result.transferId).toBeNull();
    expect(result.transferPendingRetry).toBe(true);
    expect(result.ledger.stripeTransferId).toBeNull();
    expect([...store.keys()][0]).toContain(txId);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'platform_fee.transfer_failed',
        result: 'failure',
        metadata: expect.objectContaining({ retry: true }),
      }),
    );
  });

  it('markLedgerTransferred updates transfer fields only', async () => {
    vi.mocked(prisma.platformFeeLedger.update).mockResolvedValue({
      ...ledgerRow,
      stripeTransferId: 'tr_9',
      transferredAt: new Date('2026-07-02T00:00:00.000Z'),
    } as never);

    const updated = await markLedgerTransferred(txId, 'tr_9', new Date('2026-07-02T00:00:00.000Z'));
    expect(updated?.stripeTransferId).toBe('tr_9');
    expect(prisma.platformFeeLedger.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stripeTransferId: 'tr_9' }),
      }),
    );
  });

  it('markTransferRetry / clearTransferRetry use Redis flags', async () => {
    const { redis, store } = createMemoryRedis();
    await markTransferRetry(redis, txId);
    expect(store.size).toBe(1);
    await clearTransferRetry(redis, txId);
    expect(store.size).toBe(0);
  });


  it('uses custom feeBasisPoints override when provided', async () => {
    const result = await recordFee(txId, orgId, 10_000n, 100);
    expect(prisma.platformFeeLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          feeBasisPoints: 100,
          platformFeeCents: 100n,
          netAmountCents: 9_900n,
        }),
      }),
    );
    expect(result.ledger).toBeDefined();
  });

  it('rethrows unexpected create errors', async () => {
    vi.mocked(prisma.platformFeeLedger.create).mockRejectedValue(new Error('db down'));
    await expect(recordFee(txId, orgId, 100n)).rejects.toThrow('db down');
  });

  it('connects redis when status is not ready for retry helpers', async () => {
    const { redis } = createMemoryRedis();
    (redis as { status: string }).status = 'wait';
    await markTransferRetry(redis, txId);
    expect(redis.connect).toHaveBeenCalled();
    await clearTransferRetry(redis, txId);
    expect(redis.connect).toHaveBeenCalledTimes(2);
  });

  it('markLedgerTransferred returns null on P2025 and rethrows other errors', async () => {
    vi.mocked(prisma.platformFeeLedger.update).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('missing', { code: 'P2025', clientVersion: '6' }),
    );
    await expect(markLedgerTransferred(txId, 'tr_x')).resolves.toBeNull();

    vi.mocked(prisma.platformFeeLedger.update).mockRejectedValueOnce(new Error('boom'));
    await expect(markLedgerTransferred(txId, 'tr_x')).rejects.toThrow('boom');
  });

  it('markLedgerTransferredByTransferId looks up then updates', async () => {
    vi.mocked(prisma.platformFeeLedger.findFirst).mockResolvedValueOnce(null);
    await expect(markLedgerTransferredByTransferId('tr_missing')).resolves.toBeNull();

    vi.mocked(prisma.platformFeeLedger.findFirst).mockResolvedValueOnce({
      transactionId: txId,
    } as never);
    vi.mocked(prisma.platformFeeLedger.update).mockResolvedValue({
      ...ledgerRow,
      stripeTransferId: 'tr_9',
    } as never);
    const row = await markLedgerTransferredByTransferId('tr_9');
    expect(row?.stripeTransferId).toBe('tr_9');
  });

});
