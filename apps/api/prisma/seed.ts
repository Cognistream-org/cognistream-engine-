import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { generateApiKey, hashApiKey } from '../src/lib/api-key.js';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  // Clean dependent tables for a deterministic seed
  await prisma.reputationEvent.deleteMany();
  await prisma.dispute.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.escrow.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.webhook.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.organization.deleteMany();

  const freeOrg = await prisma.organization.create({
    data: {
      id: uuidv7(),
      name: 'Acme Free Org',
      slug: 'acme-free',
      tier: 'free',
      balanceCents: 50_000n,
    },
  });

  const devOrg = await prisma.organization.create({
    data: {
      id: uuidv7(),
      name: 'DevTools Labs',
      slug: 'devtools-labs',
      tier: 'developer',
      balanceCents: 250_000n,
    },
  });

  const orgs = [freeOrg, devOrg];
  const agentsByOrg: Record<string, string[]> = {};

  for (const org of orgs) {
    const agents = [];
    for (let i = 1; i <= 3; i += 1) {
      const agent = await prisma.agent.create({
        data: {
          id: uuidv7(),
          orgId: org.id,
          name: `${org.slug}-agent-${i}`,
          publicKey: `pk_${org.slug}_${i}_${uuidv7()}`,
          capabilities: i === 1 ? ['chat', 'search'] : i === 2 ? ['codegen'] : ['embeddings'],
          pricingModel: 'per_request',
          unitPriceCents: BigInt(100 * i),
          balanceCents: BigInt(100_000 * i),
          reputationScore: 0.5 + i * 0.05,
          status: 'active',
        },
      });
      agents.push(agent);
    }
    agentsByOrg[org.id] = agents.map((a) => a.id);

    const { key, keyPrefix } = generateApiKey();
    const keyHash = await hashApiKey(key);
    await prisma.apiKey.create({
      data: {
        id: uuidv7(),
        orgId: org.id,
        name: `${org.slug}-root`,
        keyPrefix,
        keyHash,
        scopes: ['read:agents', 'write:agents', 'read:transactions', 'write:transactions', 'admin:keys'],
      },
    });

    // eslint-disable-next-line no-console -- seed script feedback
    console.log(`API key for ${org.slug}: ${key}`);
  }

  const e2eKey = process.env.E2E_API_KEY?.trim();
  if (e2eKey && e2eKey.length >= 16) {
    const keyHash = await hashApiKey(e2eKey);
    await prisma.apiKey.create({
      data: {
        id: uuidv7(),
        orgId: freeOrg.id,
        name: 'e2e-ci-root',
        keyPrefix: e2eKey.slice(0, 16),
        keyHash,
        scopes: [
          'read:agents',
          'write:agents',
          'read:transactions',
          'write:transactions',
          'admin:keys',
        ],
      },
    });
    // eslint-disable-next-line no-console -- seed script feedback
    console.log(`E2E API key seeded for acme-free (prefix ${e2eKey.slice(0, 16)})`);
  }

  const freeAgents = agentsByOrg[freeOrg.id] ?? [];
  const devAgents = agentsByOrg[devOrg.id] ?? [];

  const pairs: Array<{ buyerId: string; sellerId: string; amount: bigint; fee: bigint }> = [
    { buyerId: freeAgents[0]!, sellerId: freeAgents[1]!, amount: 1_000n, fee: 30n },
    { buyerId: freeAgents[1]!, sellerId: freeAgents[2]!, amount: 2_500n, fee: 75n },
    { buyerId: freeAgents[2]!, sellerId: freeAgents[0]!, amount: 750n, fee: 25n },
    { buyerId: freeAgents[0]!, sellerId: freeAgents[2]!, amount: 5_000n, fee: 150n },
    { buyerId: freeAgents[1]!, sellerId: freeAgents[0]!, amount: 1_200n, fee: 36n },
  ];

  // Prefer cross-org if both orgs have agents; otherwise use free-org pairs above
  if (devAgents.length >= 2) {
    pairs[3] = {
      buyerId: freeAgents[0]!,
      sellerId: devAgents[0]!,
      amount: 5_000n,
      fee: 150n,
    };
    pairs[4] = {
      buyerId: devAgents[1]!,
      sellerId: freeAgents[1]!,
      amount: 1_200n,
      fee: 36n,
    };
  }

  for (const [index, pair] of pairs.entries()) {
    const txId = uuidv7();
    const status = index % 2 === 0 ? 'settled' : 'escrowed';
    await prisma.transaction.create({
      data: {
        id: txId,
        buyerId: pair.buyerId,
        sellerId: pair.sellerId,
        amountCents: pair.amount,
        feeCents: pair.fee,
        description: `Seed transaction ${index + 1}`,
        metadata: { seed: true, index },
        status,
        settledAt: status === 'settled' ? new Date() : null,
        escrow: {
          create: {
            id: uuidv7(),
            amountCents: pair.amount,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            released: status === 'settled',
            releasedAt: status === 'settled' ? new Date() : null,
          },
        },
      },
    });
  }

  // eslint-disable-next-line no-console -- seed script feedback
  console.log(
    `Seeded ${orgs.length} orgs, ${orgs.length * 3} agents, ${orgs.length} API keys, ${pairs.length} transactions`,
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
