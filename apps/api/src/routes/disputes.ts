import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  CreateDisputeSchema,
  DisputeIdParamsSchema,
  ListDisputesQuerySchema,
  ResolveDisputeSchema,
  TransactionIdParamsSchema,
} from '@cognistream/shared';
import { parseOrReply } from '../lib/http.js';
import { AppError, errorBody } from '../lib/errors.js';
import { prisma } from '../lib/prisma.js';
import { toDisputeResponse, toTransactionResponse } from '../lib/serializers.js';
import {
  createDispute,
  getDispute,
  listDisputes,
  resolveDispute,
} from '../services/disputes.js';

async function resolveAgentId(
  orgId: string,
  headerValue: string | string[] | undefined,
  reply: FastifyReply,
  requestId: string,
): Promise<string | null> {
  if (typeof headerValue !== 'string' || headerValue.length === 0) {
    await reply.status(422).send(
      errorBody('VALIDATION_ERROR', 'Validation failed', requestId, [
        { path: 'x-agent-id', message: 'X-Agent-Id header is required' },
      ]),
    );
    return null;
  }

  const agent = await prisma.agent.findFirst({
    where: { id: headerValue, orgId, status: 'active' },
    select: { id: true },
  });
  if (!agent) {
    await reply.status(404).send(
      errorBody('AGENT_NOT_FOUND', 'Agent not found in this organization', requestId),
    );
    return null;
  }
  return agent.id;
}

export const disputeRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/transactions/:id/dispute',
    { preHandler: [app.requireScopes('write:transactions')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const params = parseOrReply(TransactionIdParamsSchema, request.params, reply, requestId);
      const body = parseOrReply(CreateDisputeSchema, request.body, reply, requestId);
      if (!params || !body || !request.auth) return;

      const agentId = await resolveAgentId(
        request.auth.orgId,
        request.headers['x-agent-id'],
        reply,
        requestId,
      );
      if (!agentId) return;

      try {
        const dispute = await createDispute(
          request.auth.orgId,
          agentId,
          params.id,
          body,
          requestId,
          app.redis,
        );
        return reply.status(201).send({ dispute: toDisputeResponse(dispute) });
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw error;
      }
    },
  );

  app.post(
    '/disputes/:id/resolve',
    { preHandler: [app.requireScopes('admin:disputes')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const params = parseOrReply(DisputeIdParamsSchema, request.params, reply, requestId);
      const body = parseOrReply(ResolveDisputeSchema, request.body, reply, requestId);
      if (!params || !body || !request.auth) return;

      const result = await resolveDispute(params.id, body, requestId, app.redis);
      return reply.send({
        dispute: toDisputeResponse(result.dispute),
        transaction: toTransactionResponse(result.transaction),
      });
    },
  );

  app.get(
    '/disputes',
    { preHandler: [app.requireScopes('read:transactions')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const query = parseOrReply(ListDisputesQuerySchema, request.query, reply, requestId);
      if (!query || !request.auth) return;

      const result = await listDisputes(request.auth.orgId, query);
      return reply.send({
        data: result.items.map(toDisputeResponse),
        meta: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit) || 1,
        },
      });
    },
  );

  app.get(
    '/disputes/:id',
    { preHandler: [app.requireScopes('read:transactions')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const params = parseOrReply(DisputeIdParamsSchema, request.params, reply, requestId);
      if (!params || !request.auth) return;

      const dispute = await getDispute(request.auth.orgId, params.id, requestId);
      return reply.send({
        dispute: toDisputeResponse(dispute),
        transaction: toTransactionResponse(dispute.transaction),
      });
    },
  );
};
