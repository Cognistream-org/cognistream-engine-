import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ApiKeyIdParamsSchema, CreateApiKeySchema } from '@cognistream/shared';
import { parseOrReply } from '../lib/http.js';
import { toApiKeyMetadata, toCreatedApiKey } from '../lib/serializers.js';
import {
  ApiKeyNotFoundError,
  createApiKey,
  listApiKeys,
  revokeApiKey,
} from '../services/api-keys.js';

const ListApiKeysQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const apiKeyRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/api-keys',
    { preHandler: [app.requireScopes('admin:keys')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const body = parseOrReply(CreateApiKeySchema, request.body, reply, requestId);
      if (!body || !request.auth) {
        return;
      }

      const { record, plaintext } = await createApiKey(request.auth.orgId, body);
      return reply.status(201).send(toCreatedApiKey(record, plaintext));
    },
  );

  app.get(
    '/api-keys',
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const requestId = String(request.id);
      const query = parseOrReply(ListApiKeysQuerySchema, request.query, reply, requestId);
      if (!query || !request.auth) {
        return;
      }

      const result = await listApiKeys(request.auth.orgId, query);
      return reply.send({
        data: result.items.map(toApiKeyMetadata),
        meta: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: Math.ceil(result.total / result.limit) || 1,
        },
      });
    },
  );

  app.delete(
    '/api-keys/:id',
    { preHandler: [app.requireScopes('admin:keys')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const params = parseOrReply(ApiKeyIdParamsSchema, request.params, reply, requestId);
      if (!params || !request.auth) {
        return;
      }

      try {
        const revoked = await revokeApiKey(request.auth.orgId, params.id, requestId);
        await app.invalidateApiKeyCache(params.id);
        return reply.send(toApiKeyMetadata(revoked));
      } catch (error) {
        if (error instanceof ApiKeyNotFoundError) {
          throw error;
        }
        throw error;
      }
    },
  );
};
