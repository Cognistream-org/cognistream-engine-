import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { createEncryptionService } from './encryption.js';
import { encryptionExtension } from './prisma-encryption.js';
import { createId } from '../lib/uuid.js';
import { randomBytes } from 'node:crypto';

describe('encryptionExtension (integration)', () => {
  const key = randomBytes(32).toString('base64');
  const encryption = createEncryptionService(`test:${key}`);
  const prisma = new PrismaClient().$extends(encryptionExtension(encryption));

  let orgId: string;
  let agentId: string;
  let webhookId: string;

  beforeAll(async () => {
    orgId = createId();
    await prisma.organization.create({
      data: {
        id: orgId,
        name: 'Enc Test Org',
        slug: `enc-test-${orgId.slice(0, 8)}`,
        tier: 'free',
      },
    });
  });

  afterAll(async () => {
    await prisma.webhook.deleteMany({ where: { orgId } });
    await prisma.agent.deleteMany({ where: { orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  it('encrypts webhook.secret at rest and decrypts on read', async () => {
    webhookId = createId();
    const created = await prisma.webhook.create({
      data: {
        id: webhookId,
        orgId,
        url: 'https://example.com/hook',
        secret: 'whsec_plaintext_test',
        events: ['transaction.created'],
      },
    });
    expect(created.secret).toBe('whsec_plaintext_test');

    const raw = new PrismaClient();
    const stored = await raw.webhook.findUniqueOrThrow({ where: { id: webhookId } });
    expect(stored.secret).not.toBe('whsec_plaintext_test');
    expect(stored.secret).toContain('ciphertext');
    await raw.$disconnect();
  });

  it('encrypts agent.metadata at rest and decrypts on read', async () => {
    agentId = createId();
    const meta = { contactEmail: 'agent@example.com', notes: 'pii' };
    const created = await prisma.agent.create({
      data: {
        id: agentId,
        orgId,
        name: 'enc-agent',
        publicKey: `pk_enc_${agentId}`,
        metadata: meta,
      },
    });
    expect(created.metadata).toEqual(meta);

    const raw = new PrismaClient();
    const stored = await raw.agent.findUniqueOrThrow({ where: { id: agentId } });
    expect(stored.metadata).not.toEqual(meta);
    expect(stored.metadata).toMatchObject({
      ciphertext: expect.any(String),
      keyId: 'test',
    });
    await raw.$disconnect();
  });
});
