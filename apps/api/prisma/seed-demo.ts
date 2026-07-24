/**
 * Demo seed: 3 orgs, 10 agents, 20 transactions, 2 disputes.
 * Self-contained (no apps/api/src imports) for Docker demo image.
 */
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { uuidv7 } from 'uuidv7';

const prisma = new PrismaClient();
const FEE = (amount: bigint) => (amount * 5n) / 1000n;

function generateApiKey(): { key: string; keyPrefix: string } {
  const raw = randomBytes(24).toString('base64url');
  const key = `cs_live_${raw}`;
  return { key, keyPrefix: key.slice(0, 16) };
}

async function hashApiKey(key: string): Promise<string> {
  return bcrypt.hash(key, 12);
}

async function main(): Promise<void> {
  await prisma.reputationEvent.deleteMany();
  await prisma.dispute.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.escrow.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.webhook.deleteMany();
  await prisma.agent.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.organization.deleteMany();

  const orgSpecs = [
    { name: 'Acme Free Org', slug: 'acme-free', tier: 'free' as const, balance: 50_000n, agents: 3 },
    {
      name: 'DevTools Labs',
      slug: 'devtools-labs',
      tier: 'developer' as const,
      balance: 250_000n,
      agents: 4,
    },
    {
      name: 'Enterprise Nova',
      slug: 'enterprise-nova',
      tier: 'enterprise' as const,
      balance: 1_000_000n,
      agents: 3,
    },
  ];

  const allAgents: Array<{ id: string; orgId: string; name: string }> = [];

  for (const spec of orgSpecs) {
    const org = await prisma.organization.create({
      data: {
        id: uuidv7(),
        name: spec.name,
        slug: spec.slug,
        tier: spec.tier,
        balanceCents: spec.balance,
      },
    });

    for (let i = 1; i <= spec.agents; i += 1) {
      const agent = await prisma.agent.create({
        data: {
          id: uuidv7(),
          orgId: org.id,
          name: `${spec.slug}-agent-${i}`,
          publicKey: `pk_${spec.slug}_${i}_${uuidv7()}`,
          capabilities:
            i % 3 === 1 ? ['chat', 'search'] : i % 3 === 2 ? ['codegen'] : ['embeddings'],
          pricingModel: 'per_request',
          unitPriceCents: BigInt(100 * i),
          balanceCents: BigInt(100_000 * i),
          reputationScore: 0.5 + i * 0.05,
          status: 'active',
        },
      });
      allAgents.push({ id: agent.id, orgId: org.id, name: agent.name });
    }

    const { key, keyPrefix } = generateApiKey();
    const keyHash = await hashApiKey(key);
    await prisma.apiKey.create({
      data: {
        id: uuidv7(),
        orgId: org.id,
        name: `${spec.slug}-root`,
        keyPrefix,
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
    console.log(`API key for ${spec.slug}: ${key}`);
  }

  if (allAgents.length !== 10) {
    throw new Error(`Expected 10 agents, got ${allAgents.length}`);
  }

  const txIds: string[] = [];
  for (let index = 0; index < 20; index += 1) {
    const buyer = allAgents[index % allAgents.length]!;
    const seller = allAgents[(index + 3) % allAgents.length]!;
    const amount = BigInt(500 + index * 250);
    const status = index % 5 === 0 ? 'disputed' : index % 2 === 0 ? 'settled' : 'escrowed';
    const txId = uuidv7();
    txIds.push(txId);

    await prisma.transaction.create({
      data: {
        id: txId,
        buyerId: buyer.id,
        sellerId: seller.id,
        amountCents: amount,
        feeCents: FEE(amount),
        description: `Demo transaction ${index + 1}`,
        metadata: { demo: true, index, fingerprint: createHash('sha256').update(txId).digest('hex').slice(0, 8) },
        status,
        settledAt: status === 'settled' ? new Date() : null,
        escrow: {
          create: {
            id: uuidv7(),
            amountCents: amount,
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
            released: status === 'settled',
            releasedAt: status === 'settled' ? new Date() : null,
          },
        },
      },
    });
  }

  const disputed = txIds.filter((_, i) => i % 5 === 0).slice(0, 2);
  for (const [i, txId] of disputed.entries()) {
    const tx = await prisma.transaction.findUniqueOrThrow({ where: { id: txId } });
    await prisma.dispute.create({
      data: {
        id: uuidv7(),
        transactionId: tx.id,
        raisedById: tx.buyerId,
        reason: i === 0 ? 'Incomplete delivery of inference results' : 'Quality below agreed SLA',
        status: 'open',
      },
    });
  }

  // eslint-disable-next-line no-console -- seed script feedback
  console.log(
    `Demo seed: ${orgSpecs.length} orgs, ${allAgents.length} agents, ${txIds.length} transactions, ${disputed.length} disputes`,
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
