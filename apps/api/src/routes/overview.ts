import type { FastifyPluginAsync } from 'fastify';
import { prisma } from '../lib/prisma.js';

/**
 * Dashboard overview stats for the authenticated org.
 * Exposes org balance only (not agent wallets).
 */
export const overviewRoutes: FastifyPluginAsync = async (app) => {
  app.get(
    '/overview',
    { preHandler: [app.requireScopes('read:transactions')] },
    async (request, reply) => {
      if (!request.auth) return;
      const orgId = request.auth.orgId;
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);

      const [org, activeAgents, monthTx] = await Promise.all([
        prisma.organization.findUniqueOrThrow({
          where: { id: orgId },
          select: { id: true, name: true, slug: true, tier: true, balanceCents: true },
        }),
        prisma.agent.count({ where: { orgId, status: 'active' } }),
        prisma.transaction.findMany({
          where: {
            createdAt: { gte: monthStart },
            OR: [{ buyer: { orgId } }, { seller: { orgId } }],
          },
          select: { amountCents: true },
        }),
      ]);

      const volumeCents = monthTx.reduce((sum, tx) => sum + tx.amountCents, 0n);

      return reply.send({
        organization: {
          id: org.id,
          name: org.name,
          slug: org.slug,
          tier: org.tier,
          balanceCents: org.balanceCents.toString(),
        },
        stats: {
          transactionsThisMonth: monthTx.length,
          volumeCentsThisMonth: volumeCents.toString(),
          activeAgents,
        },
      });
    },
  );
};
