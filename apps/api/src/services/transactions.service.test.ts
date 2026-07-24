import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  cleanupOrg,
  createTestAgent,
  createTestOrgWithKey,
} from '../test/helpers.js';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../lib/errors.js';
import {
  createTransaction,
  getTransaction,
  listTransactions,
  releaseEscrow,
} from './transactions.js';

describe('transactions service', () => {
  let orgId: string;
  let sellerOrgId: string;
  let buyerId: string;
  let sellerId: string;
  let inactiveId: string;

  beforeAll(async () => {
    const buyerOrg = await createTestOrgWithKey();
    const sellerOrg = await createTestOrgWithKey();
    orgId = buyerOrg.org.id;
    sellerOrgId = sellerOrg.org.id;
    buyerId = (await createTestAgent(orgId, { balanceCents: 100_000n })).id;
    sellerId = (await createTestAgent(sellerOrgId, { balanceCents: 0n })).id;
    const inactive = await createTestAgent(orgId, { balanceCents: 5_000n, name: 'inactive' });
    inactiveId = inactive.id;
    await prisma.agent.update({ where: { id: inactiveId }, data: { status: 'inactive' } });
  });

  afterAll(async () => {
    await cleanupOrg(orgId);
    await cleanupOrg(sellerOrgId);
  });

  it('rejects inactive buyer/seller', async () => {
    await expect(
      createTransaction(inactiveId, { sellerId, amountCents: 100 }),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });

    await expect(
      createTransaction(buyerId, { sellerId: inactiveId, amountCents: 100 }),
    ).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
  });

  it('lists and gets transactions for org', async () => {
    const created = await createTransaction(buyerId, {
      sellerId,
      amountCents: 400,
      description: 'list-me',
      metadata: { a: 1 },
    });

    const listed = await listTransactions(orgId, { page: 1, limit: 10 });
    expect(listed.total).toBeGreaterThan(0);

    const fetched = await getTransaction(created.transaction.id, orgId);
    expect(fetched.id).toBe(created.transaction.id);

    await expect(getTransaction(created.transaction.id, sellerOrgId)).resolves.toBeTruthy();
  });

  it('rejects release from non-buyer org', async () => {
    const created = await createTransaction(buyerId, { sellerId, amountCents: 120 });
    await expect(releaseEscrow(created.transaction.id, sellerOrgId)).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it('rejects invalid rating on release', async () => {
    const created = await createTransaction(buyerId, { sellerId, amountCents: 130 });
    await expect(
      releaseEscrow(created.transaction.id, orgId, { rating: 0 }),
    ).rejects.toMatchObject({ code: 'INVALID_RATING' });
  });
});
