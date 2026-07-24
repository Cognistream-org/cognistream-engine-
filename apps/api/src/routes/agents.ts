import type { FastifyPluginAsync } from 'fastify';
import {
  AgentIdParamsSchema,
  CreateAgentSchema,
  ListAgentsQuerySchema,
} from '@cognistream/shared';
import { parseOrReply } from '../lib/http.js';
import { toAgentResponse, toReputationSummary } from '../lib/serializers.js';
import {
  AgentConflictError,
  AgentNotFoundError,
  createAgent,
  getAgentWithReputation,
  listAgents,
  setAgentStatus,
} from '../services/agents.js';

export const agentRoutes: FastifyPluginAsync = async (app) => {
  app.post(
    '/agents',
    { preHandler: [app.requireScopes('write:agents')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const body = parseOrReply(CreateAgentSchema, request.body, reply, requestId);
      if (!body || !request.auth) {
        return;
      }

      try {
        const agent = await createAgent(request.auth.orgId, body, requestId);
        return reply.status(201).send(toAgentResponse(agent));
      } catch (error) {
        if (error instanceof AgentConflictError) {
          throw error;
        }
        throw error;
      }
    },
  );

  app.get(
    '/agents',
    { preHandler: [app.requireScopes('read:agents')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const query = parseOrReply(ListAgentsQuerySchema, request.query, reply, requestId);
      if (!query || !request.auth) {
        return;
      }

      const result = await listAgents(request.auth.orgId, query);
      return reply.send({
        data: result.items.map(toAgentResponse),
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
    '/agents/:id',
    { preHandler: [app.requireScopes('read:agents')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const params = parseOrReply(AgentIdParamsSchema, request.params, reply, requestId);
      if (!params || !request.auth) {
        return;
      }

      try {
        const agent = await getAgentWithReputation(request.auth.orgId, params.id, requestId);
        const { reputationEvents, ...rest } = agent;
        return reply.send({
          ...toAgentResponse(rest),
          reputation: toReputationSummary(agent.reputationScore, reputationEvents),
        });
      } catch (error) {
        if (error instanceof AgentNotFoundError) {
          throw error;
        }
        throw error;
      }
    },
  );

  app.post(
    '/agents/:id/activate',
    { preHandler: [app.requireScopes('write:agents')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const params = parseOrReply(AgentIdParamsSchema, request.params, reply, requestId);
      if (!params || !request.auth) {
        return;
      }

      const agent = await setAgentStatus(request.auth.orgId, params.id, 'active', requestId);
      return reply.send(toAgentResponse(agent));
    },
  );

  app.post(
    '/agents/:id/deactivate',
    { preHandler: [app.requireScopes('write:agents')] },
    async (request, reply) => {
      const requestId = String(request.id);
      const params = parseOrReply(AgentIdParamsSchema, request.params, reply, requestId);
      if (!params || !request.auth) {
        return;
      }

      const agent = await setAgentStatus(request.auth.orgId, params.id, 'inactive', requestId);
      return reply.send(toAgentResponse(agent));
    },
  );
};
