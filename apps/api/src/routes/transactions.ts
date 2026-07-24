import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import {
  CreateTransactionSchema,
  ListTransactionsQuerySchema,
  ReleaseEscrowSchema,
  TransactionIdParamsSchema,
} from '@cognistream/shared';
import { parseOrReply } from '../lib/http.js';
import { AppError, errorBody } from '../lib/errors.js';
import { toEscrowResponse, toTransactionResponse } from '../lib/serializers.js';
import { enforceTransactionCreateLimit } from '../lib/rate-limit.js';
import { prisma } from '../lib/prisma.js';
import {
  createTransaction,
  getTransaction,
  listTransactions,
  releaseEscrow,
} from '../services/transactions.js';

async function resolveBuyerAgentId(
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
      errorBody('AGENT_NOT_FOUND', 'Buyer agent not found in this organization', requestId),
    );
    return null;
  }

  return agent.id;
}

export const transactionRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/transactions',
    { preHandler: [app.requireScopes('write:transactions')] },
    async (request, reply) => {
      const requestId = String(request.id);
      if (!request.auth) {
        return;
      }

      const allowed = await enforceTransactionCreateLimit({
        redis: app.redis,
        orgId: request.auth.orgId,
        request,
        reply,
      });
      if (!allowed) {
        return;
      }

      const body = parseOrReply(CreateTransactionSchema, request.body, reply, requestId);
      if (!body) {
        return;
      }

      const headerKey = request.headers['x-idempotency-key'];
      const headerIdempotency =
        typeof headerKey === 'string' && headerKey.length > 0 ? headerKey.slice(0, 64) : undefined;

      const idempotencyKey = body.idempotencyKey ?? headerIdempotency;

      const buyerId = await resolveBuyerAgentId(
        request.auth.orgId,
        request.headers['x-agent-id'],
        reply,
        requestId,
      );
      if (!buyerId) {
        return;
      }

      const result = await createTransaction(
        buyerId,
        { ...body, idempotencyKey },
        requestId,
        app.redis,
      );
      const status = result.isDuplicate ? 200 : 201;
      return reply.status(status).send({
        transaction: toTransactionResponse(result.transaction),
      });
    },
  );

  app.post(
    '/transactions/:id/release',
    { preHandler: [app.requireScopes('write:transactions')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const params = parseOrReply(TransactionIdParamsSchema, request.params, reply, requestId);
      if (!params || !request.auth) {
        return;
      }

      const body = parseOrReply(ReleaseEscrowSchema, request.body ?? {}, reply, requestId);
      if (!body) {
        return;
      }

      try {
        const transaction = await releaseEscrow(params.id, request.auth.orgId, {
          rating: body.rating,
          review: body.review,
          requestId,
          redis: app.redis,
        });

        return reply.send({
          transaction: toTransactionResponse(transaction),
          escrow: transaction.escrow ? toEscrowResponse(transaction.escrow) : null,
        });
      } catch (error) {
        if (error instanceof AppError) {
          throw error;
        }
        throw error;
      }
    },
  );

  app.get(
    '/transactions/:id',
    { preHandler: [app.requireScopes('read:transactions')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const params = parseOrReply(TransactionIdParamsSchema, request.params, reply, requestId);
      if (!params || !request.auth) {
        return;
      }

      const transaction = await getTransaction(params.id, request.auth.orgId, requestId);
      return reply.send({
        transaction: toTransactionResponse(transaction),
      });
    },
  );

  app.get(
    '/transactions',
    { preHandler: [app.requireScopes('read:transactions')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const query = parseOrReply(ListTransactionsQuerySchema, request.query, reply, requestId);
      if (!query || !request.auth) {
        return;
      }

      const result = await listTransactions(request.auth.orgId, query);
      return reply.send({
        data: result.items.map(toTransactionResponse),
        meta: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit) || 1,
        },
      });
    },
  );
};
