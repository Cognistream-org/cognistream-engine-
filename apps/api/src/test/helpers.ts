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
      balanceCents: 10_000n,
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
        'write:transactions',
        'admin:keys',
      ],
    },
  });

  return { org, apiKey, plaintextKey: key };
}

export async function cleanupOrg(orgId: string): Promise<void> {
  const agents = await prisma.agent.findMany({
    where: { orgId },
    select: { id: true },
  });
  const agentIds = agents.map((agent) => agent.id);

  if (agentIds.length > 0) {
    await prisma.reputationEvent.deleteMany({
      where: { agentId: { in: agentIds } },
    });
    await prisma.transaction.deleteMany({
      where: {
        OR: [{ buyerId: { in: agentIds } }, { sellerId: { in: agentIds } }],
      },
    });
  }

  await prisma.agent.deleteMany({ where: { orgId } });
  await prisma.apiKey.deleteMany({ where: { orgId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
}
