import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupOrg,
  createTestAgent,
  createTestOrgWithKey,
} from '../test/helpers.js';
import { prisma } from '../lib/prisma.js';
import { createTransaction } from '../services/transactions.js';
import { processExpiredEscrows } from '../jobs/escrow-refund.js';

describe('escrow auto-refund job', () => {
  let orgId: string;
  let sellerOrgId: string;
  let buyerId: string;
  let sellerId: string;

  beforeAll(async () => {
    const buyer = await createTestOrgWithKey();
    const seller = await createTestOrgWithKey();
    orgId = buyer.org.id;
    sellerOrgId = seller.org.id;
    buyerId = (await createTestAgent(orgId, { balanceCents: 50_000n })).id;
    sellerId = (await createTestAgent(sellerOrgId, { balanceCents: 0n })).id;
  });

  afterAll(async () => {
    await cleanupOrg(orgId);
    await cleanupOrg(sellerOrgId);
  });

  it('refunds expired escrow idempotently', async () => {
    const created = await createTransaction(buyerId, {
      sellerId,
      amountCents: 3_000,
      description: 'expire-job',
    });
    const txId = created.transaction.id;

    await prisma.escrow.update({
      where: { transactionId: txId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const before = (await prisma.agent.findUniqueOrThrow({ where: { id: buyerId } })).balanceCents;

    const first = await processExpiredEscrows();
    expect(first.refundedIds).toContain(txId);

    const after = (await prisma.agent.findUniqueOrThrow({ where: { id: buyerId } })).balanceCents;
    expect(after).toBe(before + 3_000n);

    const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: txId } });
    expect(tx.status).toBe('refunded');

    const escrow = await prisma.escrow.findUniqueOrThrow({ where: { transactionId: txId } });
    expect(escrow.released).toBe(true);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'escrow.auto_refund', entityId: escrow.id },
    });
    expect(audit).toBeTruthy();

    const second = await processExpiredEscrows();
    expect(second.refundedIds).not.toContain(txId);

    const afterAgain = (
      await prisma.agent.findUniqueOrThrow({ where: { id: buyerId } })
    ).balanceCents;
    expect(afterAgain).toBe(after);
  });
});
