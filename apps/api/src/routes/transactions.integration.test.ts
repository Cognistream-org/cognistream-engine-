import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildTestApp,
  cleanupOrg,
  createTestAgent,
  createTestOrgWithKey,
} from '../test/helpers.js';
import { prisma } from '../lib/prisma.js';
import { createId } from '../lib/uuid.js';
import { calculateFeeCents, createTransaction } from '../services/transactions.js';

describe('transactions API integration', () => {
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let orgId: string;
  let apiKey: string;
  let readOnlyKey: string;
  let readOnlyOrgId: string;
  let buyerId: string;
  let sellerId: string;
  let sellerOrgId: string;
  let sellerKey: string;

  beforeAll(async () => {
    app = await buildTestApp();

    const buyerOrg = await createTestOrgWithKey();
    orgId = buyerOrg.org.id;
    apiKey = buyerOrg.plaintextKey;

    const sellerOrg = await createTestOrgWithKey();
    sellerOrgId = sellerOrg.org.id;
    sellerKey = sellerOrg.plaintextKey;

    const readOnly = await createTestOrgWithKey({
      scopes: ['read:transactions'],
    });
    readOnlyOrgId = readOnly.org.id;
    readOnlyKey = readOnly.plaintextKey;

    const buyer = await createTestAgent(orgId, { balanceCents: 500_000n, name: 'buyer' });
    const seller = await createTestAgent(sellerOrgId, { balanceCents: 0n, name: 'seller' });
    buyerId = buyer.id;
    sellerId = seller.id;
  }, 60_000);

  afterAll(async () => {
    await cleanupOrg(orgId);
    await cleanupOrg(sellerOrgId);
    await cleanupOrg(readOnlyOrgId);
    await app.close();
  });

  it('returns 403 without write:transactions scope', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: {
        'x-api-key': readOnlyKey,
        'x-agent-id': buyerId,
      },
      payload: { sellerId, amountCents: 100 },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('FORBIDDEN');
  });

  it('creates a transaction (happy path)', async () => {
    const beforeBuyer = await prisma.agent.findUniqueOrThrow({
      where: { id: buyerId },
      select: { balanceCents: true },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: {
        'x-api-key': apiKey,
        'x-agent-id': buyerId,
      },
      payload: {
        sellerId,
        amountCents: 10_000,
        description: 'inference job',
        metadata: { job: 'embed' },
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.transaction.status).toBe('escrowed');
    expect(body.transaction.amountCents).toBe('10000');
    expect(body.transaction.feeCents).toBe(calculateFeeCents(10_000n).toString());
    expect(body.transaction.escrow).toBeTruthy();
    expect(body.transaction.escrow.released).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/balance/i);

    const afterBuyer = await prisma.agent.findUniqueOrThrow({
      where: { id: buyerId },
      select: { balanceCents: true },
    });
    expect(afterBuyer.balanceCents).toBe(beforeBuyer.balanceCents - 10_000n);
  });

  it('returns 402 on insufficient balance', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: {
        'x-api-key': apiKey,
        'x-agent-id': buyerId,
      },
      payload: { sellerId, amountCents: 999_999_999 },
    });
    expect(response.statusCode).toBe(402);
    expect(response.json().error.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('returns 422 when buyer equals seller', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: {
        'x-api-key': apiKey,
        'x-agent-id': buyerId,
      },
      payload: { sellerId: buyerId, amountCents: 100 },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('SELF_TRANSACTION_NOT_ALLOWED');
  });

  it('returns 422 for negative / zero amount', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: {
        'x-api-key': apiKey,
        'x-agent-id': buyerId,
      },
      payload: { sellerId, amountCents: -1 },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 404 for invalid seller', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: {
        'x-api-key': apiKey,
        'x-agent-id': buyerId,
      },
      payload: { sellerId: createId(), amountCents: 100 },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('AGENT_NOT_FOUND');
  });

  it('idempotency: same key + payload returns 200 with same transaction', async () => {
    const key = `idem-${createId().slice(0, 20)}`;
    const payload = { sellerId, amountCents: 500, description: 'idem', idempotencyKey: key };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: { 'x-api-key': apiKey, 'x-agent-id': buyerId },
      payload,
    });
    expect(first.statusCode).toBe(201);
    const txId = first.json().transaction.id;

    const second = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: { 'x-api-key': apiKey, 'x-agent-id': buyerId },
      payload,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().transaction.id).toBe(txId);
  });

  it('idempotency: same key + different payload returns 409', async () => {
    const key = `idem-diff-${createId().slice(0, 16)}`;
    const first = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: { 'x-api-key': apiKey, 'x-agent-id': buyerId },
      payload: { sellerId, amountCents: 300, idempotencyKey: key },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: { 'x-api-key': apiKey, 'x-agent-id': buyerId },
      payload: { sellerId, amountCents: 400, idempotencyKey: key },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('INVALID_IDEMPOTENCY_KEY');
  });

  it('releases escrow and settles balances correctly', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: { 'x-api-key': apiKey, 'x-agent-id': buyerId },
      payload: { sellerId, amountCents: 2_000, description: 'settle-me' },
    });
    expect(create.statusCode).toBe(201);
    const txId = create.json().transaction.id as string;
    const feeCents = BigInt(create.json().transaction.feeCents);

    const sellerBefore = await prisma.agent.findUniqueOrThrow({
      where: { id: sellerId },
      select: { balanceCents: true },
    });
    const orgBefore = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { balanceCents: true },
    });

    const release = await app.inject({
      method: 'POST',
      url: `/v1/transactions/${txId}/release`,
      headers: { 'x-api-key': apiKey },
      payload: { rating: 5, review: 'excellent' },
    });
    expect(release.statusCode).toBe(200);
    expect(release.json().transaction.status).toBe('settled');
    expect(release.json().escrow.released).toBe(true);
    expect(JSON.stringify(release.json())).not.toMatch(/balanceCents/);

    const sellerAfter = await prisma.agent.findUniqueOrThrow({
      where: { id: sellerId },
      select: { balanceCents: true },
    });
    const orgAfter = await prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: { balanceCents: true },
    });

    expect(sellerAfter.balanceCents).toBe(sellerBefore.balanceCents + (2_000n - feeCents));
    expect(orgAfter.balanceCents).toBe(orgBefore.balanceCents + feeCents);
  });

  it('returns 409 when escrow already released', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: { 'x-api-key': apiKey, 'x-agent-id': buyerId },
      payload: { sellerId, amountCents: 200 },
    });
    expect(create.statusCode).toBe(201);
    const txId = create.json().transaction.id as string;
    const firstRelease = await app.inject({
      method: 'POST',
      url: `/v1/transactions/${txId}/release`,
      headers: { 'x-api-key': apiKey },
      payload: {},
    });
    expect(firstRelease.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/v1/transactions/${txId}/release`,
      headers: { 'x-api-key': apiKey },
      payload: {},
    });
    expect(second.statusCode).toBe(409);
    expect(['ESCROW_ALREADY_RELEASED', 'TRANSACTION_ALREADY_SETTLED']).toContain(
      second.json().error.code,
    );
  });

  it('returns 409 for expired escrow', async () => {
    const created = await createTransaction(buyerId, {
      sellerId,
      amountCents: 150,
      description: 'expire-me',
    });
    const txId = created.transaction.id;

    await prisma.escrow.update({
      where: { transactionId: txId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const release = await app.inject({
      method: 'POST',
      url: `/v1/transactions/${txId}/release`,
      headers: { 'x-api-key': apiKey },
      payload: {},
    });
    expect(release.statusCode).toBe(409);
    expect(release.json().error.code).toBe('ESCROW_EXPIRED');
  });

  it('returns 422 for invalid rating', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: { 'x-api-key': apiKey, 'x-agent-id': buyerId },
      payload: { sellerId, amountCents: 100 },
    });
    expect(create.statusCode).toBe(201);
    const txId = create.json().transaction.id as string;

    const release = await app.inject({
      method: 'POST',
      url: `/v1/transactions/${txId}/release`,
      headers: { 'x-api-key': apiKey },
      payload: { rating: 9 },
    });
    expect(release.statusCode).toBe(422);
    expect(release.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('gets and lists transactions without leaking balances', async () => {
    const list = await app.inject({
      method: 'GET',
      url: '/v1/transactions?limit=5',
      headers: { 'x-api-key': apiKey },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data.length).toBeGreaterThan(0);
    expect(JSON.stringify(list.json())).not.toMatch(/balanceCents/);

    const id = list.json().data[0].id as string;
    const get = await app.inject({
      method: 'GET',
      url: `/v1/transactions/${id}`,
      headers: { 'x-api-key': apiKey },
    });
    expect(get.statusCode).toBe(200);
    expect(get.json().transaction.id).toBe(id);

    const sellerList = await app.inject({
      method: 'GET',
      url: '/v1/transactions',
      headers: { 'x-api-key': sellerKey },
    });
    expect(sellerList.statusCode).toBe(200);
  });

  it('prevents double-spend under concurrent creates', async () => {
    const poorBuyer = await createTestAgent(orgId, {
      balanceCents: 1_000n,
      name: 'poor-buyer',
    });

    const results = await Promise.allSettled([
      createTransaction(poorBuyer.id, { sellerId, amountCents: 800 }),
      createTransaction(poorBuyer.id, { sellerId, amountCents: 800 }),
    ]);

    const successes = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    const finalBalance = await prisma.agent.findUniqueOrThrow({
      where: { id: poorBuyer.id },
      select: { balanceCents: true },
    });
    expect(finalBalance.balanceCents).toBe(200n);
    expect(finalBalance.balanceCents).toBeGreaterThanOrEqual(0n);
  });

  it('returns 404 for unknown transaction and requires X-Agent-Id', async () => {
    const missingAgent = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: { 'x-api-key': apiKey },
      payload: { sellerId, amountCents: 100 },
    });
    expect(missingAgent.statusCode).toBe(422);

    const get = await app.inject({
      method: 'GET',
      url: `/v1/transactions/${createId()}`,
      headers: { 'x-api-key': apiKey },
    });
    expect(get.statusCode).toBe(404);
  });

  it('accepts idempotency key from header', async () => {
    const key = `hdr-${createId().slice(0, 20)}`;
    const first = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: {
        'x-api-key': apiKey,
        'x-agent-id': buyerId,
        'x-idempotency-key': key,
      },
      payload: { sellerId, amountCents: 250 },
    });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: {
        'x-api-key': apiKey,
        'x-agent-id': buyerId,
        'x-idempotency-key': key,
      },
      payload: { sellerId, amountCents: 250 },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().transaction.id).toBe(first.json().transaction.id);
  });
});
