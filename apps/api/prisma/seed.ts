import 'dotenv/config';
import { PrismaClient, type OrganizationTier } from '@prisma/client';
import { uuidv7 } from 'uuidv7';

const prisma = new PrismaClient();

const organizations: Array<{
  name: string;
  slug: string;
  tier: OrganizationTier;
  balanceCents: bigint;
}> = [
  {
    name: 'Acme Free Org',
    slug: 'acme-free',
    tier: 'free',
    balanceCents: 0n,
  },
  {
    name: 'DevTools Labs',
    slug: 'devtools-labs',
    tier: 'developer',
    balanceCents: 10_000n,
  },
  {
    name: 'Enterprise Corp',
    slug: 'enterprise-corp',
    tier: 'enterprise',
    balanceCents: 1_000_000n,
  },
];

async function main(): Promise<void> {
  for (const org of organizations) {
    await prisma.organization.upsert({
      where: { slug: org.slug },
      create: {
        id: uuidv7(),
        name: org.name,
        slug: org.slug,
        tier: org.tier,
        balanceCents: org.balanceCents,
      },
      update: {
        name: org.name,
        tier: org.tier,
        balanceCents: org.balanceCents,
      },
    });
  }

  // eslint-disable-next-line no-console -- seed script feedback
  console.log(`Seeded ${organizations.length} organizations`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
