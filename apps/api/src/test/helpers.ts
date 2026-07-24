import pino from 'pino';
import type { FastifyInstance } from 'fastify';
import { loadEnv } from '../config.js';
import { buildApp } from '../app.js';
import { prisma } from '../lib/prisma.js';
import { createId } from '../lib/uuid.js';
import { generateApiKey, hashApiKey } from '../lib/api-key.js';

export async function buildTestApp(): Promise<FastifyInstance> {
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
  });
  return buildApp(env, pino({ level: 'silent' }));
}

export async function createTestOrgWithKey(options?: {
  scopes?: string[];
  tier?: 'free' | 'developer' | 'enterprise';
  orgBalanceCents?: bigint;
}): Promise<{
  org: { id: string; tier: string };
  apiKey: { id: string };
  plaintextKey: string;
}> {
  const id = createId();
  const org = await prisma.organization.create({
    data: {
      id,
      name: `Test Org ${id}`,
      slug: `test-${id.replace(/-/g, '')}`,
      tier: options?.tier ?? 'developer',
      balanceCents: options?.orgBalanceCents ?? 10_000n,
    },
  });

  const { key, keyPrefix } = generateApiKey();
  const keyHash = await hashApiKey(key);
  const apiKey = await prisma.apiKey.create({
    data: {
      id: createId(),
      orgId: org.id,
      name: 'test-key',
      keyPrefix,
      keyHash,
      scopes: options?.scopes ?? [
        'read:agents',
        'write:agents',
        'read:transactions',
        'write:transactions',
        'admin:keys',
      ],
    },
  });

  return { org, apiKey, plaintextKey: key };
}

export async function createTestAgent(
  orgId: string,
  options?: { balanceCents?: bigint; name?: string },
): Promise<{ id: string; orgId: string; balanceCents: bigint }> {
  const id = createId();
  const agent = await prisma.agent.create({
    data: {
      id,
      orgId,
      name: options?.name ?? `agent-${id.slice(0, 8)}`,
      publicKey: `pk_${id}`,
      capabilities: ['chat'],
      balanceCents: options?.balanceCents ?? 100_000n,
      status: 'active',
    },
    select: { id: true, orgId: true, balanceCents: true },
  });
  return agent;
}

export async function cleanupOrg(orgId: string): Promise<void> {
  const agents = await prisma.agent.findMany({
    where: { orgId },
    select: { id: true },
  });
  const agentIds = agents.map((agent) => agent.id);

  if (agentIds.length > 0) {
    await prisma.dispute.deleteMany({
      where: {
        OR: [
          { raisedById: { in: agentIds } },
          { transaction: { OR: [{ buyerId: { in: agentIds } }, { sellerId: { in: agentIds } }] } },
        ],
      },
    });
    await prisma.reputationEvent.deleteMany({
      where: { agentId: { in: agentIds } },
    });
    await prisma.transaction.deleteMany({
      where: {
        OR: [{ buyerId: { in: agentIds } }, { sellerId: { in: agentIds } }],
      },
    });
  }

  await prisma.auditLog.deleteMany({ where: { orgId } });
  await prisma.webhook.deleteMany({ where: { orgId } });
  await prisma.agent.deleteMany({ where: { orgId } });
  await prisma.apiKey.deleteMany({ where: { orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
}
