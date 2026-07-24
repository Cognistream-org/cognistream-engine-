import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildTestApp,
  cleanupOrg,
  createTestAgent,
  createTestOrgWithKey,
} from '../test/helpers.js';
import { prisma } from '../lib/prisma.js';
import { createTransaction } from '../services/transactions.js';

describe('disputes API integration', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let buyerOrgId: string;
  let sellerOrgId: string;
  let buyerKey: string;
  let adminKey: string;
  let buyerId: string;
  let sellerId: string;

  beforeAll(async () => {
    app = await buildTestApp();
    const buyer = await createTestOrgWithKey({
      scopes: [
        'read:transactions',
        'write:transactions',
        'admin:disputes',
        'read:agents',
        'write:agents',
        'admin:keys',
      ],
    });
    buyerOrgId = buyer.org.id;
    buyerKey = buyer.plaintextKey;
    adminKey = buyer.plaintextKey;

    const seller = await createTestOrgWithKey();
    sellerOrgId = seller.org.id;

    buyerId = (await createTestAgent(buyerOrgId, { balanceCents: 100_000n })).id;
    sellerId = (await createTestAgent(sellerOrgId, { balanceCents: 0n })).id;
  }, 60_000);

  afterAll(async () => {
    await cleanupOrg(buyerOrgId);
    await cleanupOrg(sellerOrgId);
    await app.close();
  });

  it('creates a dispute on escrowed transaction', async () => {
    const created = await createTransaction(buyerId, { sellerId, amountCents: 1_000 });
    const response = await app.inject({
      method: 'POST',
      url: `/v1/transactions/${created.transaction.id}/dispute`,
      headers: { 'x-api-key': buyerKey, 'x-agent-id': buyerId },
      payload: { reason: 'Service not delivered' },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json().dispute.status).toBe('open');

    const tx = await prisma.transaction.findUniqueOrThrow({
      where: { id: created.transaction.id },
    });
    expect(tx.status).toBe('disputed');
  });

  it('rejects duplicate dispute', async () => {
    const created = await createTransaction(buyerId, { sellerId, amountCents: 500 });
    await app.inject({
      method: 'POST',
      url: `/v1/transactions/${created.transaction.id}/dispute`,
      headers: { 'x-api-key': buyerKey, 'x-agent-id': buyerId },
      payload: { reason: 'first' },
    });
    const second = await app.inject({
      method: 'POST',
      url: `/v1/transactions/${created.transaction.id}/dispute`,
      headers: { 'x-api-key': buyerKey, 'x-agent-id': buyerId },
      payload: { reason: 'second' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('DISPUTE_ALREADY_OPEN');
  });

  it('resolves dispute in favor of buyer (refund)', async () => {
    const created = await createTransaction(buyerId, { sellerId, amountCents: 2_000 });
    const disputeRes = await app.inject({
      method: 'POST',
      url: `/v1/transactions/${created.transaction.id}/dispute`,
      headers: { 'x-api-key': buyerKey, 'x-agent-id': buyerId },
      payload: { reason: 'refund please' },
    });
    const disputeId = disputeRes.json().dispute.id as string;
    const beforeBuyer = (
      await prisma.agent.findUniqueOrThrow({ where: { id: buyerId } })
    ).balanceCents;

    const resolve = await app.inject({
      method: 'POST',
      url: `/v1/disputes/${disputeId}/resolve`,
      headers: { 'x-api-key': adminKey },
      payload: { resolution: 'buyer', notes: 'Buyer wins' },
    });
    expect(resolve.statusCode).toBe(200);
    expect(resolve.json().dispute.status).toBe('resolved_buyer');
    expect(resolve.json().transaction.status).toBe('refunded');

    const afterBuyer = (
      await prisma.agent.findUniqueOrThrow({ where: { id: buyerId } })
    ).balanceCents;
    expect(afterBuyer).toBe(beforeBuyer + 2_000n);
  });

  it('resolves dispute in favor of seller (settle)', async () => {
    const created = await createTransaction(buyerId, { sellerId, amountCents: 1_500 });
    const disputeRes = await app.inject({
      method: 'POST',
      url: `/v1/transactions/${created.transaction.id}/dispute`,
      headers: { 'x-api-key': buyerKey, 'x-agent-id': buyerId },
      payload: { reason: 'seller should win' },
    });
    const disputeId = disputeRes.json().dispute.id as string;
    const beforeSeller = (
      await prisma.agent.findUniqueOrThrow({ where: { id: sellerId } })
    ).balanceCents;

    const resolve = await app.inject({
      method: 'POST',
      url: `/v1/disputes/${disputeId}/resolve`,
      headers: { 'x-api-key': adminKey },
      payload: { resolution: 'seller' },
    });
    expect(resolve.statusCode).toBe(200);
    expect(resolve.json().transaction.status).toBe('settled');

    const afterSeller = (
      await prisma.agent.findUniqueOrThrow({ where: { id: sellerId } })
    ).balanceCents;
    expect(afterSeller).toBe(beforeSeller + (1_500n - created.transaction.feeCents));
  });

  it('lists and gets disputes', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/disputes?limit=10',
      headers: { 'x-api-key': buyerKey },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.length).toBeGreaterThan(0);

    const id = list.json().data[0].id as string;
    const get = await app.inject({
      method: 'GET',
      url: `/v1/disputes/${id}`,
      headers: { 'x-api-key': buyerKey },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().dispute.id).toBe(id);
  });
});
