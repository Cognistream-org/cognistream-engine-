import pino from 'pino';
import { loadEnv } from '../config.js';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { createId } from '../lib/uuid.js';
import { generateApiKey, hashApiKey } from '../lib/api-key.js';

async function main(): Promise<void> {
  const env = loadEnv({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' });
  const app = await buildApp(env, pino({ level: 'silent' }));

  const buyerOrgId = createId();
  const sellerOrgId = createId();

  await prisma.organization.create({
    data: {
      id: buyerOrgId,
      name: 'Flow Buyer',
      slug: `flow-b-${buyerOrgId.slice(0, 8)}`,
      tier: 'developer',
      balanceCents: 0n,
    },
  });
  await prisma.organization.create({
    data: {
      id: sellerOrgId,
      name: 'Flow Seller',
      slug: `flow-s-${sellerOrgId.slice(0, 8)}`,
      tier: 'developer',
      balanceCents: 0n,
    },
  });

  const buyerId = createId();
  const sellerId = createId();
  await prisma.agent.create({
    data: {
      id: buyerId,
      orgId: buyerOrgId,
      name: 'buyer',
      publicKey: `pk_b_${buyerId}`,
      balanceCents: 10_000n,
      status: 'active',
    },
  });
  await prisma.agent.create({
    data: {
      id: sellerId,
      orgId: sellerOrgId,
      name: 'seller',
      publicKey: `pk_s_${sellerId}`,
      balanceCents: 0n,
      status: 'active',
    },
  });

  const { key, keyPrefix } = generateApiKey();
  const keyHash = await hashApiKey(key);
  await prisma.apiKey.create({
    data: {
      id: createId(),
      orgId: buyerOrgId,
      name: 'flow',
      keyPrefix,
      keyHash,
      scopes: ['read:transactions', 'write:transactions'],
    },
  });

  const before = {
    buyer: (await prisma.agent.findUniqueOrThrow({ where: { id: buyerId } })).balanceCents.toString(),
    seller: (await prisma.agent.findUniqueOrThrow({ where: { id: sellerId } })).balanceCents.toString(),
    org: (await prisma.organization.findUniqueOrThrow({ where: { id: buyerOrgId } })).balanceCents.toString(),
  };

  const create = await app.inject({
    method: 'POST',
    url: '/v1/transactions',
    headers: { 'x-api-key': key, 'x-agent-id': buyerId },
    payload: { sellerId, amountCents: 2000, description: 'sample flow' },
  });
  const tx = create.json().transaction as {
    id: string;
    amountCents: string;
    feeCents: string;
  };
  const afterCreateBuyer = (
    await prisma.agent.findUniqueOrThrow({ where: { id: buyerId } })
  ).balanceCents.toString();

  const release = await app.inject({
    method: 'POST',
    url: `/v1/transactions/${tx.id}/release`,
    headers: { 'x-api-key': key },
    payload: { rating: 5, review: 'great' },
  });

  const after = {
    buyer: (await prisma.agent.findUniqueOrThrow({ where: { id: buyerId } })).balanceCents.toString(),
    seller: (await prisma.agent.findUniqueOrThrow({ where: { id: sellerId } })).balanceCents.toString(),
    org: (await prisma.organization.findUniqueOrThrow({ where: { id: buyerOrgId } })).balanceCents.toString(),
  };

  // eslint-disable-next-line no-console -- demo script output
  console.log(
    JSON.stringify(
      {
        createStatus: create.statusCode,
        releaseStatus: release.statusCode,
        transaction: {
          id: tx.id,
          amountCents: tx.amountCents,
          feeCents: tx.feeCents,
          statusAfterRelease: release.json().transaction.status,
        },
        balances: {
          before,
          afterCreate: { buyer: afterCreateBuyer },
          afterSettle: after,
        },
        expected: {
          buyerNet: '8000',
          sellerCredit: String(2000 - Number(tx.feeCents)),
          orgFee: tx.feeCents,
        },
      },
      null,
      2,
    ),
  );

  await prisma.reputationEvent.deleteMany({ where: { agentId: { in: [buyerId, sellerId] } } });
  await prisma.transaction.deleteMany({ where: { id: tx.id } });
  await prisma.agent.deleteMany({ where: { id: { in: [buyerId, sellerId] } } });
  await prisma.apiKey.deleteMany({ where: { orgId: buyerOrgId } });
  await prisma.organization.deleteMany({ where: { id: { in: [buyerOrgId, sellerOrgId] } } });
  await app.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
