/**
 * Temporary helper: mint a fresh API key for Sprint 1 testing
 * after losing the seed-script output.
 *
 * Usage (from repo root or apps/api):
 *   npx tsx apps/api/scripts/generate-test-key.ts
 *   npx tsx scripts/generate-test-key.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { uuidv7 } from 'uuidv7';
import { generateApiKey, hashApiKey } from '../src/lib/api-key.js';

const PREFERRED_SLUGS = ['devtools-labs', 'acme-free'] as const;

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const preferred = await prisma.organization.findFirst({
    where: { slug: { in: [...PREFERRED_SLUGS] } },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true, slug: true, tier: true },
  });

  const org =
    preferred ??
    (await prisma.organization.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, slug: true, tier: true },
    }));

  if (!org) {
    throw new Error('No Organization found in the database. Run the seed script first.');
  }

  const { key, keyPrefix } = generateApiKey();
  const keyHash = await hashApiKey(key);

  const record = await prisma.apiKey.create({
    data: {
      id: uuidv7(),
      orgId: org.id,
      name: `sprint1-test-${Date.now()}`,
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
    select: { id: true, name: true, keyPrefix: true, createdAt: true },
  });

  // eslint-disable-next-line no-console -- temporary script: user must copy the raw key
  console.log('\n========================================');
  console.log('  NEW TEST API KEY (copy now — shown once)');
  console.log('========================================');
  console.log(`  Org:     ${org.name} (${org.slug}) [${org.tier}]`);
  console.log(`  Key ID:  ${record.id}`);
  console.log(`  Name:    ${record.name}`);
  console.log(`  Prefix:  ${record.keyPrefix}`);
  console.log('----------------------------------------');
  console.log(`  RAW KEY: ${key}`);
  console.log('========================================\n');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
